// Integration tests that run against real MongoDB using testcontainers
//
// Run with: go test -v -tags=integration ./...
// Or: make test-integration-go
//
// These tests are slower but provide high confidence that the app
// works correctly with real MongoDB.

//go:build integration

package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/peternagy/mongopal/internal/connection"
	"github.com/peternagy/mongopal/internal/core"
	"github.com/peternagy/mongopal/internal/database"
	"github.com/peternagy/mongopal/internal/document"
	"github.com/peternagy/mongopal/internal/export"
	"github.com/peternagy/mongopal/internal/importer"
	"github.com/peternagy/mongopal/internal/schema"
	"github.com/peternagy/mongopal/internal/script"
	"github.com/peternagy/mongopal/internal/storage"
	"github.com/peternagy/mongopal/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go/modules/mongodb"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// testContext holds shared test resources
type testContext struct {
	container *mongodb.MongoDBContainer
	uri       string
	client    *mongo.Client
	app       *App
	connID    string
}

// setupTestContainer starts a MongoDB container and returns the connection details
func setupTestContainer(t *testing.T) *testContext {
	ctx := context.Background()

	// Start MongoDB container
	container, err := mongodb.Run(ctx, "mongo:7")
	require.NoError(t, err, "Failed to start MongoDB container")

	// Get connection string
	uri, err := container.ConnectionString(ctx)
	require.NoError(t, err, "Failed to get connection string")

	// Connect directly for test setup
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	require.NoError(t, err, "Failed to connect to MongoDB")

	// Create app instance
	app := NewApp()
	app.state.Ctx = ctx
	app.state.ConfigDir = t.TempDir()
	app.state.Emitter = &core.NoopEventEmitter{} // Disable Wails event emission in tests

	// Save a test connection
	connID := "test-conn-1"
	app.state.SavedConnections = []types.SavedConnection{
		{
			ID:        connID,
			Name:      "Test Connection",
			URI:       uri,
			CreatedAt: time.Now(),
		},
	}

	// Initialize services (normally done in startup)
	app.connStore = storage.NewConnectionService(app.state, app.storage, app.credential)
	app.folderSvc = storage.NewFolderService(app.state, app.storage)
	app.connection = connection.NewService(app.state, app.connStore)
	app.database = database.NewService(app.state)
	app.document = document.NewService(app.state)
	app.schema = schema.NewService(app.state)
	app.export = export.NewService(app.state, app.connStore)
	app.importer = importer.NewService(app.state, app.connStore)
	app.script = script.NewService(app.connStore)

	return &testContext{
		container: container,
		uri:       uri,
		client:    client,
		app:       app,
		connID:    connID,
	}
}

// teardown cleans up test resources
func (tc *testContext) teardown(t *testing.T) {
	ctx := context.Background()

	if tc.client != nil {
		tc.client.Disconnect(ctx)
	}

	if tc.app != nil {
		tc.app.shutdown(ctx)
	}

	if tc.container != nil {
		tc.container.Terminate(ctx)
	}
}

// seedTestData inserts test documents into a collection
func (tc *testContext) seedTestData(t *testing.T, dbName, collName string, docs []bson.M) {
	ctx := context.Background()
	coll := tc.client.Database(dbName).Collection(collName)

	var documents []interface{}
	for _, doc := range docs {
		documents = append(documents, doc)
	}

	_, err := coll.InsertMany(ctx, documents)
	require.NoError(t, err, "Failed to seed test data")
}

// =============================================================================
// Connection Tests
// =============================================================================

func TestIntegration_Connect(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Test connecting
	err := tc.app.Connect(tc.connID)
	assert.NoError(t, err, "Should connect successfully")

	// Verify connection status
	status := tc.app.GetConnectionStatus(tc.connID)
	assert.True(t, status.Connected, "Should be connected")

	// Test disconnecting
	err = tc.app.Disconnect(tc.connID)
	assert.NoError(t, err, "Should disconnect successfully")

	// Verify disconnected
	status = tc.app.GetConnectionStatus(tc.connID)
	assert.False(t, status.Connected, "Should be disconnected")
}

func TestIntegration_TestConnection(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Test with valid URI
	result, err := tc.app.TestConnection(tc.uri, "")
	assert.NoError(t, err, "Should not return go error")
	assert.True(t, result.Success, "Should succeed with valid URI")
	assert.NotEmpty(t, result.ServerVersion, "Should return server version")
	assert.NotEmpty(t, result.Topology, "Should return topology")
	assert.Greater(t, result.Latency, int64(0), "Should return latency")

	// Test with invalid URI
	result, err = tc.app.TestConnection("mongodb://invalid:27017", "")
	assert.NoError(t, err, "Should not return go error")
	assert.False(t, result.Success, "Should fail with invalid URI")
	assert.NotEmpty(t, result.Error, "Should return error message")
}

// =============================================================================
// Database & Collection Listing Tests
// =============================================================================

func TestIntegration_ListDatabases(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed some data to create a database
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{"name": "Alice"},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// List databases
	databases, err := tc.app.ListDatabases(tc.connID)
	require.NoError(t, err)

	// Should include our test database
	var found bool
	for _, db := range databases {
		if db.Name == "testdb" {
			found = true
			break
		}
	}
	assert.True(t, found, "Should find testdb in database list")
}

func TestIntegration_ListCollections(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed data in multiple collections
	tc.seedTestData(t, "testdb", "users", []bson.M{{"name": "Alice"}})
	tc.seedTestData(t, "testdb", "orders", []bson.M{{"item": "Widget"}})
	tc.seedTestData(t, "testdb", "products", []bson.M{{"sku": "ABC123"}})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// List collections
	collections, err := tc.app.ListCollections(tc.connID, "testdb")
	require.NoError(t, err)

	// Should have all three collections
	assert.Len(t, collections, 3, "Should have 3 collections")

	names := make(map[string]bool)
	for _, c := range collections {
		names[c.Name] = true
	}
	assert.True(t, names["users"], "Should have users collection")
	assert.True(t, names["orders"], "Should have orders collection")
	assert.True(t, names["products"], "Should have products collection")
}

// =============================================================================
// Document CRUD Tests
// =============================================================================

func TestIntegration_FindDocuments(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed test data
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{"name": "Alice", "age": 30, "active": true},
		{"name": "Bob", "age": 25, "active": false},
		{"name": "Charlie", "age": 35, "active": true},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Find all documents
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "users", "{}", QueryOptions{Limit: 10})
	require.NoError(t, err)

	assert.Equal(t, int64(3), result.Total, "Should find 3 documents")
	assert.Len(t, result.Documents, 3, "Should return 3 documents")

	// Find with filter
	result, err = tc.app.FindDocuments(tc.connID, "testdb", "users", `{"active": true}`, QueryOptions{Limit: 10})
	require.NoError(t, err)

	assert.Equal(t, int64(2), result.Total, "Should find 2 active users")

	// Find with pagination
	result, err = tc.app.FindDocuments(tc.connID, "testdb", "users", "{}", QueryOptions{Skip: 1, Limit: 1})
	require.NoError(t, err)

	assert.Len(t, result.Documents, 1, "Should return 1 document")
	assert.True(t, result.HasMore, "Should have more documents")
}

func TestIntegration_FindDocumentsWithProjection(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed test data
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{"name": "Alice", "email": "alice@test.com", "password": "secret123"},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Find with projection (exclude password)
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "users", "{}", QueryOptions{
		Limit:      10,
		Projection: `{"password": 0}`,
	})
	require.NoError(t, err)

	// Parse the result document
	var doc map[string]interface{}
	err = json.Unmarshal([]byte(result.Documents[0]), &doc)
	require.NoError(t, err)

	assert.Contains(t, doc, "name", "Should have name field")
	assert.Contains(t, doc, "email", "Should have email field")
	assert.NotContains(t, doc, "password", "Should NOT have password field")
}

func TestIntegration_AggregateDocuments(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	tc.seedTestData(t, "testdb", "orders", []bson.M{
		{"status": "shipped", "amount": 10},
		{"status": "shipped", "amount": 20},
		{"status": "pending", "amount": 5},
	})

	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	pipeline := `[{"$group": {"_id": "$status", "count": {"$sum": 1}, "total": {"$sum": "$amount"}}}, {"$sort": {"_id": 1}}]`
	result, err := tc.app.AggregateDocuments(tc.connID, "testdb", "orders", pipeline, QueryOptions{Limit: 10})
	require.NoError(t, err)
	assert.Len(t, result.Documents, 2, "Should have 2 groups (shipped, pending)")

	var first map[string]interface{}
	err = json.Unmarshal([]byte(result.Documents[0]), &first)
	require.NoError(t, err)
	assert.Equal(t, "pending", first["_id"])

	// Invalid pipeline returns an error, not a panic.
	_, err = tc.app.AggregateDocuments(tc.connID, "testdb", "orders", "not json", QueryOptions{Limit: 10})
	assert.Error(t, err, "Invalid pipeline should return an error")

	// $out is rejected.
	_, err = tc.app.AggregateDocuments(tc.connID, "testdb", "orders", `[{"$out": "otherCollection"}]`, QueryOptions{Limit: 10})
	assert.Error(t, err, "$out should be rejected")
}

func TestIntegration_InsertDocument(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Insert a document
	docJSON := `{"name": "NewUser", "email": "new@test.com"}`
	insertedID, err := tc.app.InsertDocument(tc.connID, "testdb", "users", docJSON)
	require.NoError(t, err)

	assert.NotEmpty(t, insertedID, "Should return inserted ID")

	// Verify it was inserted
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "users", "{}", QueryOptions{Limit: 10})
	require.NoError(t, err)

	assert.Equal(t, int64(1), result.Total, "Should have 1 document")
}

func TestIntegration_UpdateDocument(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed test data
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{"name": "Alice", "age": 30},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Find the document to get its ID
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "users", "{}", QueryOptions{Limit: 1})
	require.NoError(t, err)

	var doc map[string]interface{}
	err = json.Unmarshal([]byte(result.Documents[0]), &doc)
	require.NoError(t, err)

	// Extract ObjectId
	idMap := doc["_id"].(map[string]interface{})
	docID := idMap["$oid"].(string)

	// Update the document
	updatedJSON := `{"name": "Alice Updated", "age": 31}`
	err = tc.app.UpdateDocument(tc.connID, "testdb", "users", docID, updatedJSON)
	require.NoError(t, err)

	// Verify the update
	docJSON, err := tc.app.GetDocument(tc.connID, "testdb", "users", docID)
	require.NoError(t, err)

	var updated map[string]interface{}
	err = json.Unmarshal([]byte(docJSON), &updated)
	require.NoError(t, err)

	assert.Equal(t, "Alice Updated", updated["name"], "Name should be updated")
	// Extended JSON represents integers as {"$numberInt": "31"} or {"$numberLong": "31"}
	ageVal := updated["age"]
	switch age := ageVal.(type) {
	case float64:
		assert.Equal(t, float64(31), age, "Age should be updated")
	case map[string]interface{}:
		// Check for Extended JSON format
		if numInt, ok := age["$numberInt"]; ok {
			assert.Equal(t, "31", numInt, "Age should be updated")
		} else if numLong, ok := age["$numberLong"]; ok {
			assert.Equal(t, "31", numLong, "Age should be updated")
		} else {
			t.Errorf("Unexpected age format: %v", age)
		}
	default:
		t.Errorf("Unexpected age type: %T", ageVal)
	}
}

func TestIntegration_DeleteDocument(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed test data
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{"name": "ToDelete"},
		{"name": "ToKeep"},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Find documents
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "users", `{"name": "ToDelete"}`, QueryOptions{Limit: 1})
	require.NoError(t, err)

	var doc map[string]interface{}
	err = json.Unmarshal([]byte(result.Documents[0]), &doc)
	require.NoError(t, err)

	idMap := doc["_id"].(map[string]interface{})
	docID := idMap["$oid"].(string)

	// Delete the document
	err = tc.app.DeleteDocument(tc.connID, "testdb", "users", docID)
	require.NoError(t, err)

	// Verify deletion
	result, err = tc.app.FindDocuments(tc.connID, "testdb", "users", "{}", QueryOptions{Limit: 10})
	require.NoError(t, err)

	assert.Equal(t, int64(1), result.Total, "Should have 1 document remaining")
}

// =============================================================================
// Document ID Type Tests
// =============================================================================

func TestIntegration_DocumentWithStringID(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Insert document with string ID directly
	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("users")
	_, err := coll.InsertOne(ctx, bson.M{"_id": "custom-string-id", "name": "StringID User"})
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Get the document by string ID
	docJSON, err := tc.app.GetDocument(tc.connID, "testdb", "users", "custom-string-id")
	require.NoError(t, err)

	var doc map[string]interface{}
	err = json.Unmarshal([]byte(docJSON), &doc)
	require.NoError(t, err)

	assert.Equal(t, "custom-string-id", doc["_id"], "Should retrieve document with string ID")
}

func TestIntegration_DocumentWithNumericID(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Insert document with numeric ID
	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("users")
	_, err := coll.InsertOne(ctx, bson.M{"_id": int64(12345), "name": "NumericID User"})
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Get the document by numeric ID (passed as Extended JSON)
	// Note: parseDocumentID doesn't auto-convert "12345" to int64, so we use Extended JSON format
	docJSON, err := tc.app.GetDocument(tc.connID, "testdb", "users", `{"$numberLong": "12345"}`)
	require.NoError(t, err)

	assert.Contains(t, docJSON, "NumericID User", "Should retrieve document with numeric ID")
}

// =============================================================================
// Schema Inference Tests
// =============================================================================

func TestIntegration_InferCollectionSchema(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed diverse test data
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{
			"name":      "Alice",
			"age":       30,
			"active":    true,
			"email":     "alice@test.com",
			"createdAt": time.Now(),
			"address":   bson.M{"city": "NYC", "zip": "10001"},
			"tags":      []string{"admin", "verified"},
		},
		{
			"name":      "Bob",
			"age":       25,
			"active":    false,
			"email":     "bob@test.com",
			"createdAt": time.Now(),
			"address":   bson.M{"city": "LA", "zip": "90001"},
		},
		{
			"name":      "Charlie",
			"age":       35,
			"active":    true,
			"createdAt": time.Now(),
			// Missing email and address to test occurrence
		},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Infer schema
	schema, err := tc.app.InferCollectionSchema(tc.connID, "testdb", "users", 10)
	require.NoError(t, err)

	assert.Equal(t, "users", schema.Collection, "Should have correct collection name")
	assert.Equal(t, int64(3), schema.TotalDocs, "Should have correct total docs")

	// Check field types
	assert.Contains(t, schema.Fields, "_id", "Should have _id field")
	assert.Contains(t, schema.Fields, "name", "Should have name field")
	assert.Contains(t, schema.Fields, "age", "Should have age field")
	assert.Contains(t, schema.Fields, "active", "Should have active field")
	assert.Contains(t, schema.Fields, "address", "Should have address field")

	// Check nested object
	addressField := schema.Fields["address"]
	assert.Equal(t, "Object", addressField.Type, "Address should be Object type")
	assert.Contains(t, addressField.Fields, "city", "Address should have city field")
	assert.Contains(t, addressField.Fields, "zip", "Address should have zip field")

	// Check array field
	if tagsField, ok := schema.Fields["tags"]; ok {
		assert.Contains(t, tagsField.Type, "Array", "Tags should be Array type")
	}

	// Check occurrence (email is in 2/3 documents)
	emailField := schema.Fields["email"]
	assert.InDelta(t, 66.67, emailField.Occurrence, 1.0, "Email should have ~66.67% occurrence")
}

// =============================================================================
// Collection Operations Tests
// =============================================================================

func TestIntegration_DropCollection(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed data
	tc.seedTestData(t, "testdb", "todrop", []bson.M{{"x": 1}})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Verify collection exists
	collections, err := tc.app.ListCollections(tc.connID, "testdb")
	require.NoError(t, err)

	var found bool
	for _, c := range collections {
		if c.Name == "todrop" {
			found = true
			break
		}
	}
	assert.True(t, found, "Collection should exist before drop")

	// Drop collection
	err = tc.app.DropCollection(tc.connID, "testdb", "todrop")
	require.NoError(t, err)

	// Verify collection is gone
	collections, err = tc.app.ListCollections(tc.connID, "testdb")
	require.NoError(t, err)

	found = false
	for _, c := range collections {
		if c.Name == "todrop" {
			found = true
			break
		}
	}
	assert.False(t, found, "Collection should not exist after drop")
}

func TestIntegration_ClearCollection(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed data
	tc.seedTestData(t, "testdb", "toclear", []bson.M{
		{"x": 1},
		{"x": 2},
		{"x": 3},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Verify documents exist
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "toclear", "{}", QueryOptions{Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(3), result.Total, "Should have 3 documents before clear")

	// Clear collection
	err = tc.app.ClearCollection(tc.connID, "testdb", "toclear")
	require.NoError(t, err)

	// Verify documents are gone but collection exists
	result, err = tc.app.FindDocuments(tc.connID, "testdb", "toclear", "{}", QueryOptions{Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(0), result.Total, "Should have 0 documents after clear")

	// Collection should still exist
	collections, err := tc.app.ListCollections(tc.connID, "testdb")
	require.NoError(t, err)

	var found bool
	for _, c := range collections {
		if c.Name == "toclear" {
			found = true
			break
		}
	}
	assert.True(t, found, "Collection should still exist after clear")
}

// =============================================================================
// Index Tests
// =============================================================================

func TestIntegration_ListIndexes(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed data and create index
	tc.seedTestData(t, "testdb", "indexed", []bson.M{{"email": "test@test.com"}})

	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("indexed")
	_, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// List indexes
	indexes, err := tc.app.ListIndexes(tc.connID, "testdb", "indexed")
	require.NoError(t, err)

	// Should have _id index and email index
	assert.GreaterOrEqual(t, len(indexes), 2, "Should have at least 2 indexes")

	var emailIndexFound bool
	for _, idx := range indexes {
		if idx.Name == "email_1" {
			emailIndexFound = true
			assert.True(t, idx.Unique, "Email index should be unique")
		}
	}
	assert.True(t, emailIndexFound, "Should find email index")
}

// =============================================================================
// Complex Query Tests
// =============================================================================

func TestIntegration_FindWithComplexFilter(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed test data
	tc.seedTestData(t, "testdb", "products", []bson.M{
		{"name": "Widget A", "price": 10.00, "category": "widgets", "stock": 100},
		{"name": "Widget B", "price": 25.00, "category": "widgets", "stock": 50},
		{"name": "Gadget A", "price": 50.00, "category": "gadgets", "stock": 25},
		{"name": "Gadget B", "price": 75.00, "category": "gadgets", "stock": 10},
		{"name": "Gadget C", "price": 100.00, "category": "gadgets", "stock": 5},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Complex filter: gadgets with price > 50
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "products",
		`{"category": "gadgets", "price": {"$gt": 50}}`,
		QueryOptions{Limit: 10})
	require.NoError(t, err)

	assert.Equal(t, int64(2), result.Total, "Should find 2 gadgets with price > 50")

	// Filter with $or
	result, err = tc.app.FindDocuments(tc.connID, "testdb", "products",
		`{"$or": [{"price": {"$lt": 20}}, {"stock": {"$lt": 10}}]}`,
		QueryOptions{Limit: 10})
	require.NoError(t, err)

	assert.Equal(t, int64(2), result.Total, "Should find 2 products (cheap or low stock)")
}

func TestIntegration_FindWithSort(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed test data
	tc.seedTestData(t, "testdb", "users", []bson.M{
		{"name": "Charlie", "age": 35},
		{"name": "Alice", "age": 30},
		{"name": "Bob", "age": 25},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Sort by age ascending (simple format: "field" for ascending, "-field" for descending)
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "users", "{}",
		QueryOptions{Limit: 10, Sort: "age"})
	require.NoError(t, err)

	// First document should be Bob (youngest)
	var firstDoc map[string]interface{}
	err = json.Unmarshal([]byte(result.Documents[0]), &firstDoc)
	require.NoError(t, err)

	assert.Equal(t, "Bob", firstDoc["name"], "First document should be Bob (age 25)")

	// Sort by age descending
	result, err = tc.app.FindDocuments(tc.connID, "testdb", "users", "{}",
		QueryOptions{Limit: 10, Sort: "-age"})
	require.NoError(t, err)

	err = json.Unmarshal([]byte(result.Documents[0]), &firstDoc)
	require.NoError(t, err)

	assert.Equal(t, "Charlie", firstDoc["name"], "First document should be Charlie (age 35)")
}

// =============================================================================
// BSON Types Tests
// =============================================================================

func TestIntegration_BSONTypes(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Insert document with various BSON types
	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("bsontypes")

	oid := primitive.NewObjectID()
	now := time.Now().UTC().Truncate(time.Millisecond)

	_, err := coll.InsertOne(ctx, bson.M{
		"_id":       oid,
		"string":    "hello",
		"int32":     int32(42),
		"int64":     int64(9223372036854775807),
		"double":    3.14159,
		"bool":      true,
		"date":      now,
		"null":      nil,
		"objectId":  primitive.NewObjectID(),
		"array":     []string{"a", "b", "c"},
		"nestedDoc": bson.M{"x": 1, "y": 2},
		"binary":    primitive.Binary{Subtype: 0x00, Data: []byte("binary data")},
	})
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Get the document
	docJSON, err := tc.app.GetDocument(tc.connID, "testdb", "bsontypes", oid.Hex())
	require.NoError(t, err)

	var doc map[string]interface{}
	err = json.Unmarshal([]byte(docJSON), &doc)
	require.NoError(t, err)

	// Verify types are preserved in Extended JSON format
	assert.Equal(t, "hello", doc["string"])
	assert.Equal(t, true, doc["bool"])
	assert.Nil(t, doc["null"])

	// Check Extended JSON formats
	assert.Contains(t, doc["_id"], "$oid", "_id should be in Extended JSON ObjectId format")
	assert.Contains(t, doc["date"], "$date", "date should be in Extended JSON Date format")
	assert.Contains(t, doc["int64"], "$numberLong", "int64 should be in Extended JSON NumberLong format")
}

// =============================================================================
// Error Handling Tests
// =============================================================================

func TestIntegration_InvalidFilter(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed data
	tc.seedTestData(t, "testdb", "users", []bson.M{{"name": "Alice"}})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Invalid filter syntax
	_, err = tc.app.FindDocuments(tc.connID, "testdb", "users", "not valid json", QueryOptions{Limit: 10})
	assert.Error(t, err, "Should error on invalid filter JSON")

	// Invalid operator
	_, err = tc.app.FindDocuments(tc.connID, "testdb", "users", `{"$invalidOp": 1}`, QueryOptions{Limit: 10})
	assert.Error(t, err, "Should error on invalid MongoDB operator")
}

func TestIntegration_NotConnected(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Don't connect, try operations
	_, err := tc.app.ListDatabases(tc.connID)
	assert.Error(t, err, "Should error when not connected")
	assert.Contains(t, err.Error(), "not connected", "Error should mention not connected")
}

// =============================================================================
// Benchmark Tests
// =============================================================================

func BenchmarkIntegration_FindDocuments(b *testing.B) {
	ctx := context.Background()

	// Start MongoDB container
	container, err := mongodb.Run(ctx, "mongo:7")
	if err != nil {
		b.Fatalf("Failed to start MongoDB container: %v", err)
	}
	defer container.Terminate(ctx)

	uri, _ := container.ConnectionString(ctx)

	// Connect and seed data
	client, _ := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	defer client.Disconnect(ctx)

	coll := client.Database("benchdb").Collection("docs")
	var docs []interface{}
	for i := 0; i < 1000; i++ {
		docs = append(docs, bson.M{
			"index":  i,
			"name":   fmt.Sprintf("Document %d", i),
			"value":  i * 100,
			"active": i%2 == 0,
		})
	}
	coll.InsertMany(ctx, docs)

	// Create app
	app := NewApp()
	app.state.Ctx = ctx
	app.state.ConfigDir = b.TempDir()
	app.state.Emitter = &core.NoopEventEmitter{}
	app.state.SavedConnections = []types.SavedConnection{{ID: "bench", Name: "Bench", URI: uri}}

	// Initialize services
	app.connStore = storage.NewConnectionService(app.state, app.storage, app.credential)
	app.folderSvc = storage.NewFolderService(app.state, app.storage)
	app.connection = connection.NewService(app.state, app.connStore)
	app.database = database.NewService(app.state)
	app.document = document.NewService(app.state)
	app.schema = schema.NewService(app.state)
	app.export = export.NewService(app.state, app.connStore)
	app.importer = importer.NewService(app.state, app.connStore)
	app.script = script.NewService(app.connStore)

	app.Connect("bench")
	defer app.Disconnect("bench")

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		app.FindDocuments("bench", "benchdb", "docs", "{}", QueryOptions{Limit: 50})
	}
}

// =============================================================================
// Export/Import Integration Tests
// =============================================================================

func TestIntegration_ExportImport_RoundTrip(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect via app
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Seed test data
	tc.seedTestData(t, "exportdb", "users", []bson.M{
		{"_id": primitive.NewObjectID(), "name": "Alice", "age": 30},
		{"_id": primitive.NewObjectID(), "name": "Bob", "age": 25},
	})
	tc.seedTestData(t, "exportdb", "orders", []bson.M{
		{"_id": primitive.NewObjectID(), "item": "Widget", "qty": 10},
	})

	// Create temp file for export
	tmpDir := t.TempDir()
	exportPath := tmpDir + "/test_export.zip"

	// We can't fully test ExportDatabases because it opens a file dialog,
	// but we can test the internal export logic by creating the zip manually
	// For now, test PreviewImportFile and DryRunImport with a pre-created zip

	t.Run("GetDatabasesForExport returns databases", func(t *testing.T) {
		dbs, err := tc.app.GetDatabasesForExport(tc.connID)
		require.NoError(t, err)

		// Find our test database
		var found bool
		for _, db := range dbs {
			if db.Name == "exportdb" {
				found = true
				break
			}
		}
		assert.True(t, found, "Should find exportdb in list")
	})

	// Test creating an export manually (simulating what ExportDatabases does)
	t.Run("Manual export creates valid zip", func(t *testing.T) {
		ctx := context.Background()

		// Create zip file manually
		zipFile, err := os.Create(exportPath)
		require.NoError(t, err)

		zipWriter := zip.NewWriter(zipFile)

		// Create manifest
		manifest := ExportManifest{
			Version:    "1.0",
			ExportedAt: time.Now(),
			Databases: []ExportManifestDatabase{
				{
					Name: "exportdb",
					Collections: []ExportManifestCollection{
						{Name: "users", DocCount: 2, IndexCount: 0},
						{Name: "orders", DocCount: 1, IndexCount: 0},
					},
				},
			},
		}

		// Write manifest
		manifestWriter, err := zipWriter.Create("manifest.json")
		require.NoError(t, err)
		json.NewEncoder(manifestWriter).Encode(manifest)

		// Export users collection
		usersWriter, err := zipWriter.Create("exportdb/users/documents.ndjson")
		require.NoError(t, err)
		cursor, _ := tc.client.Database("exportdb").Collection("users").Find(ctx, bson.M{})
		for cursor.Next(ctx) {
			jsonBytes, _ := bson.MarshalExtJSON(cursor.Current, true, false)
			usersWriter.Write(jsonBytes)
			usersWriter.Write([]byte("\n"))
		}

		// Export orders collection
		ordersWriter, err := zipWriter.Create("exportdb/orders/documents.ndjson")
		require.NoError(t, err)
		cursor, _ = tc.client.Database("exportdb").Collection("orders").Find(ctx, bson.M{})
		for cursor.Next(ctx) {
			jsonBytes, _ := bson.MarshalExtJSON(cursor.Current, true, false)
			ordersWriter.Write(jsonBytes)
			ordersWriter.Write([]byte("\n"))
		}

		zipWriter.Close()
		zipFile.Close()

		// Verify file exists
		_, err = os.Stat(exportPath)
		assert.NoError(t, err, "Export file should exist")
	})

	t.Run("DryRunImport with skip mode shows correct counts and does NOT modify data", func(t *testing.T) {
		// Count docs before dry run
		usersBefore, _ := tc.client.Database("exportdb").Collection("users").CountDocuments(context.Background(), bson.M{})
		ordersBefore, _ := tc.client.Database("exportdb").Collection("orders").CountDocuments(context.Background(), bson.M{})

		result, err := tc.app.DryRunImport(tc.connID, ImportOptions{
			FilePath:  exportPath,
			Databases: []string{"exportdb"},
			Mode:      "skip",
		})
		require.NoError(t, err)

		// All documents already exist, so all should be skipped
		assert.Equal(t, int64(0), result.DocumentsInserted, "No new documents to insert")
		assert.Equal(t, int64(3), result.DocumentsSkipped, "All 3 docs should be skipped")

		// CRITICAL: Verify data was NOT modified
		usersAfter, _ := tc.client.Database("exportdb").Collection("users").CountDocuments(context.Background(), bson.M{})
		ordersAfter, _ := tc.client.Database("exportdb").Collection("orders").CountDocuments(context.Background(), bson.M{})
		assert.Equal(t, usersBefore, usersAfter, "DryRun should NOT modify users collection")
		assert.Equal(t, ordersBefore, ordersAfter, "DryRun should NOT modify orders collection")
	})

	t.Run("DryRunImport with override mode shows what will be dropped and does NOT modify data", func(t *testing.T) {
		// Count docs before dry run
		usersBefore, _ := tc.client.Database("exportdb").Collection("users").CountDocuments(context.Background(), bson.M{})
		ordersBefore, _ := tc.client.Database("exportdb").Collection("orders").CountDocuments(context.Background(), bson.M{})

		result, err := tc.app.DryRunImport(tc.connID, ImportOptions{
			FilePath:  exportPath,
			Databases: []string{"exportdb"},
			Mode:      "override",
		})
		require.NoError(t, err)

		// Override means all will be inserted (db dropped first)
		assert.Equal(t, int64(3), result.DocumentsInserted, "All 3 docs will be inserted")
		assert.Equal(t, int64(3), result.DocumentsDropped, "Current 3 docs will be dropped")

		// CRITICAL: Verify data was NOT modified (dry run should NOT drop anything)
		usersAfter, _ := tc.client.Database("exportdb").Collection("users").CountDocuments(context.Background(), bson.M{})
		ordersAfter, _ := tc.client.Database("exportdb").Collection("orders").CountDocuments(context.Background(), bson.M{})
		assert.Equal(t, usersBefore, usersAfter, "DryRun should NOT drop users collection")
		assert.Equal(t, ordersBefore, ordersAfter, "DryRun should NOT drop orders collection")
	})

	t.Run("ImportDatabases with skip mode skips existing", func(t *testing.T) {
		result, err := tc.app.ImportDatabases(tc.connID, ImportOptions{
			FilePath:  exportPath,
			Databases: []string{"exportdb"},
			Mode:      "skip",
		})
		require.NoError(t, err)

		// All docs exist, should be skipped
		assert.Equal(t, int64(0), result.DocumentsInserted)
		assert.Equal(t, int64(3), result.DocumentsSkipped)
	})

	t.Run("ImportDatabases with override mode replaces data", func(t *testing.T) {
		// First, add an extra document that should be removed
		tc.client.Database("exportdb").Collection("users").InsertOne(
			context.Background(),
			bson.M{"_id": primitive.NewObjectID(), "name": "Extra", "age": 99},
		)

		// Verify we now have 3 users
		count, _ := tc.client.Database("exportdb").Collection("users").CountDocuments(context.Background(), bson.M{})
		assert.Equal(t, int64(3), count, "Should have 3 users before override")

		result, err := tc.app.ImportDatabases(tc.connID, ImportOptions{
			FilePath:  exportPath,
			Databases: []string{"exportdb"},
			Mode:      "override",
		})
		require.NoError(t, err)

		// All docs should be inserted (db was dropped)
		assert.Equal(t, int64(3), result.DocumentsInserted)
		assert.Equal(t, int64(0), result.DocumentsSkipped)

		// Verify only 2 users remain (the extra one is gone)
		count, _ = tc.client.Database("exportdb").Collection("users").CountDocuments(context.Background(), bson.M{})
		assert.Equal(t, int64(2), count, "Should have 2 users after override")
	})
}

// =============================================================================
// Priority 3.1: Extended CRUD Tests - Large Documents & Special Characters
// =============================================================================

func TestIntegration_LargeDocument(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Create a document with a large string field (1MB of data)
	largeString := make([]byte, 1024*1024) // 1MB
	for i := range largeString {
		largeString[i] = byte('a' + (i % 26))
	}

	docJSON := fmt.Sprintf(`{"name": "LargeDoc", "data": "%s"}`, string(largeString))

	// Insert large document
	insertedID, err := tc.app.InsertDocument(tc.connID, "testdb", "largedocs", docJSON)
	require.NoError(t, err)
	assert.NotEmpty(t, insertedID)

	// Retrieve and verify
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "largedocs", "{}", types.QueryOptions{Limit: 1})
	require.NoError(t, err)
	assert.Equal(t, int64(1), result.Total)

	// Verify we can get the document by ID
	doc, err := tc.app.GetDocument(tc.connID, "testdb", "largedocs", insertedID)
	require.NoError(t, err)
	assert.Contains(t, doc, "LargeDoc")
}

func TestIntegration_SpecialCharactersInFieldNames(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Insert documents with special characters in field names
	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("specialchars")

	// MongoDB allows many special characters in field names (except . and $)
	_, err := coll.InsertOne(ctx, bson.M{
		"normal_field":             "value1",
		"field with space":         "value2",
		"field-with-dash":          "value3",
		"field_with_unicode_日本語":   "value4",
		"field@with#special!chars": "value5",
		"nested": bson.M{
			"inner field": "inner value",
		},
	})
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Find the document
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "specialchars", "{}", types.QueryOptions{Limit: 1})
	require.NoError(t, err)
	assert.Equal(t, int64(1), result.Total)

	// Verify the document contains all fields
	var doc map[string]interface{}
	err = json.Unmarshal([]byte(result.Documents[0]), &doc)
	require.NoError(t, err)

	assert.Equal(t, "value1", doc["normal_field"])
	assert.Equal(t, "value2", doc["field with space"])
	assert.Equal(t, "value3", doc["field-with-dash"])
	assert.Equal(t, "value4", doc["field_with_unicode_日本語"])
	assert.Equal(t, "value5", doc["field@with#special!chars"])
}

func TestIntegration_BinaryDataTypes(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Insert document with various binary subtypes
	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("binarydata")

	oid := primitive.NewObjectID()
	uuid := primitive.Binary{
		Subtype: 0x04, // UUID subtype
		Data:    []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10},
	}

	_, err := coll.InsertOne(ctx, bson.M{
		"_id":            oid,
		"generic_binary": primitive.Binary{Subtype: 0x00, Data: []byte("generic binary data")},
		"uuid_binary":    uuid,
		"md5_binary":     primitive.Binary{Subtype: 0x05, Data: []byte{0xd4, 0x1d, 0x8c, 0xd9, 0x8f, 0x00, 0xb2, 0x04, 0xe9, 0x80, 0x09, 0x98, 0xec, 0xf8, 0x42, 0x7e}},
	})
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Get the document
	docJSON, err := tc.app.GetDocument(tc.connID, "testdb", "binarydata", oid.Hex())
	require.NoError(t, err)

	var doc map[string]interface{}
	err = json.Unmarshal([]byte(docJSON), &doc)
	require.NoError(t, err)

	// Verify binary fields are in Extended JSON format
	assert.Contains(t, doc["generic_binary"], "$binary")
	assert.Contains(t, doc["uuid_binary"], "$binary")
	assert.Contains(t, doc["md5_binary"], "$binary")
}

func TestIntegration_DeepNesting(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Create a deeply nested document (10 levels)
	nested := bson.M{"value": "deepest"}
	for i := 0; i < 10; i++ {
		nested = bson.M{fmt.Sprintf("level%d", 10-i): nested}
	}

	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("nested")
	_, err := coll.InsertOne(ctx, nested)
	require.NoError(t, err)

	// Connect via app
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Find and verify
	result, err := tc.app.FindDocuments(tc.connID, "testdb", "nested", "{}", types.QueryOptions{Limit: 1})
	require.NoError(t, err)

	// Verify the deepest value is accessible
	assert.Contains(t, result.Documents[0], "deepest")
}

// =============================================================================
// Priority 3.2: Error Scenario Tests
// =============================================================================

func TestIntegration_AuthenticationFailure(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Try to connect with wrong credentials
	// Note: Default testcontainer doesn't have auth, so we test with a bad URI
	result, err := tc.app.TestConnection("mongodb://wronguser:wrongpass@localhost:99999", "")
	assert.NoError(t, err, "Should not return go error")
	assert.False(t, result.Success, "Should fail with bad credentials/host")
}

func TestIntegration_InvalidDatabaseName(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Try to list collections with invalid database names
	_, err = tc.app.ListCollections(tc.connID, "")
	assert.Error(t, err, "Should reject empty database name")

	_, err = tc.app.ListCollections(tc.connID, "db/with/slashes")
	assert.Error(t, err, "Should reject database name with slashes")

	_, err = tc.app.ListCollections(tc.connID, "db.with.dots")
	assert.Error(t, err, "Should reject database name with dots")
}

func TestIntegration_InvalidCollectionName(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Try operations with invalid collection names
	_, err = tc.app.ListIndexes(tc.connID, "testdb", "")
	assert.Error(t, err, "Should reject empty collection name")

	_, err = tc.app.ListIndexes(tc.connID, "testdb", "$invalid")
	assert.Error(t, err, "Should reject collection name starting with $")
}

func TestIntegration_DocumentNotFound(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed some data
	tc.seedTestData(t, "testdb", "users", []bson.M{{"name": "Alice"}})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Try to get a non-existent document
	_, err = tc.app.GetDocument(tc.connID, "testdb", "users", "000000000000000000000000")
	assert.Error(t, err, "Should error when document not found")
	assert.Contains(t, err.Error(), "not found")

	// Try to update a non-existent document
	err = tc.app.UpdateDocument(tc.connID, "testdb", "users", "000000000000000000000000", `{"name": "Updated"}`)
	assert.Error(t, err, "Should error when updating non-existent document")

	// Try to delete a non-existent document
	err = tc.app.DeleteDocument(tc.connID, "testdb", "users", "000000000000000000000000")
	assert.Error(t, err, "Should error when deleting non-existent document")
}

func TestIntegration_DuplicateKeyError(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Create unique index
	ctx := context.Background()
	coll := tc.client.Database("testdb").Collection("unique")
	_, err := coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	require.NoError(t, err)

	// Connect
	err = tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Insert first document
	_, err = tc.app.InsertDocument(tc.connID, "testdb", "unique", `{"email": "test@test.com", "name": "First"}`)
	require.NoError(t, err)

	// Try to insert duplicate
	_, err = tc.app.InsertDocument(tc.connID, "testdb", "unique", `{"email": "test@test.com", "name": "Second"}`)
	assert.Error(t, err, "Should error on duplicate key")
	assert.Contains(t, err.Error(), "duplicate", "Error should mention duplicate")
}

func TestIntegration_MalformedDocument(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Try to insert malformed JSON
	_, err = tc.app.InsertDocument(tc.connID, "testdb", "docs", `{not valid json}`)
	assert.Error(t, err, "Should error on malformed JSON")

	// Try to insert with invalid BSON types
	_, err = tc.app.InsertDocument(tc.connID, "testdb", "docs", `{"_id": {"$oid": "not-a-valid-oid"}}`)
	assert.Error(t, err, "Should error on invalid ObjectId format")
}

// =============================================================================
// Priority 3.3: Export/Import Error Handling Tests
// =============================================================================

func TestIntegration_ImportCorruptedZip(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Create a corrupted zip file
	tmpDir := t.TempDir()
	corruptedPath := tmpDir + "/corrupted.zip"
	err = os.WriteFile(corruptedPath, []byte("not a valid zip file"), 0644)
	require.NoError(t, err)

	// Try to import
	_, err = tc.app.DryRunImport(tc.connID, types.ImportOptions{
		FilePath:  corruptedPath,
		Databases: []string{"testdb"},
		Mode:      "skip",
	})
	assert.Error(t, err, "Should error on corrupted zip")
}

func TestIntegration_ImportMissingManifest(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Create a valid zip without manifest
	tmpDir := t.TempDir()
	noManifestPath := tmpDir + "/no_manifest.zip"
	zipFile, err := os.Create(noManifestPath)
	require.NoError(t, err)

	zipWriter := zip.NewWriter(zipFile)
	// Write some data but no manifest.json
	w, _ := zipWriter.Create("somedb/somecoll/documents.ndjson")
	w.Write([]byte(`{"name": "test"}`))
	zipWriter.Close()
	zipFile.Close()

	// Try to import
	_, err = tc.app.DryRunImport(tc.connID, types.ImportOptions{
		FilePath:  noManifestPath,
		Databases: []string{"somedb"},
		Mode:      "skip",
	})
	assert.Error(t, err, "Should error when manifest is missing")
}

func TestIntegration_ImportInvalidNDJSON(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Create a zip with invalid NDJSON
	tmpDir := t.TempDir()
	invalidNDJSONPath := tmpDir + "/invalid_ndjson.zip"
	zipFile, err := os.Create(invalidNDJSONPath)
	require.NoError(t, err)

	zipWriter := zip.NewWriter(zipFile)

	// Write manifest
	manifestWriter, _ := zipWriter.Create("manifest.json")
	manifest := types.ExportManifest{
		Version:    "1.0",
		ExportedAt: time.Now(),
		Databases: []types.ExportManifestDatabase{
			{
				Name: "testdb",
				Collections: []types.ExportManifestCollection{
					{Name: "baddata", DocCount: 3},
				},
			},
		},
	}
	json.NewEncoder(manifestWriter).Encode(manifest)

	// Write invalid NDJSON
	ndjsonWriter, _ := zipWriter.Create("testdb/baddata/documents.ndjson")
	ndjsonWriter.Write([]byte(`{"valid": "doc", "_id": {"$oid": "507f1f77bcf86cd799439011"}}` + "\n"))
	ndjsonWriter.Write([]byte(`{not valid json}` + "\n"))
	ndjsonWriter.Write([]byte(`{"another": "valid", "_id": {"$oid": "507f1f77bcf86cd799439012"}}` + "\n"))

	zipWriter.Close()
	zipFile.Close()

	// Import should succeed but track parse errors
	result, err := tc.app.ImportDatabases(tc.connID, types.ImportOptions{
		FilePath:  invalidNDJSONPath,
		Databases: []string{"testdb"},
		Mode:      "skip",
	})
	require.NoError(t, err, "Import should succeed overall")

	// Should have 2 successful inserts and 1 parse error
	assert.Equal(t, int64(2), result.DocumentsInserted, "Should insert 2 valid documents")
	assert.Equal(t, int64(1), result.DocumentsParseError, "Should have 1 parse error")
	assert.True(t, len(result.Errors) > 0, "Should report parse errors")
}

func TestIntegration_ImportEmptyArchive(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Create a zip with manifest but no databases selected
	tmpDir := t.TempDir()
	emptyPath := tmpDir + "/empty.zip"
	zipFile, err := os.Create(emptyPath)
	require.NoError(t, err)

	zipWriter := zip.NewWriter(zipFile)

	// Write manifest with empty databases
	manifestWriter, _ := zipWriter.Create("manifest.json")
	manifest := types.ExportManifest{
		Version:    "1.0",
		ExportedAt: time.Now(),
		Databases:  []types.ExportManifestDatabase{},
	}
	json.NewEncoder(manifestWriter).Encode(manifest)
	zipWriter.Close()
	zipFile.Close()

	// Import should fail with no databases
	_, err = tc.app.DryRunImport(tc.connID, types.ImportOptions{
		FilePath:  emptyPath,
		Databases: []string{},
		Mode:      "skip",
	})
	assert.Error(t, err, "Should error when no databases to import")
}

// =============================================================================
// Priority 3.3: Schema Inference Edge Cases
// =============================================================================

func TestIntegration_SchemaWithEmptyCollection(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Create empty collection
	ctx := context.Background()
	tc.client.Database("testdb").CreateCollection(ctx, "empty")

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Infer schema on empty collection
	schema, err := tc.app.InferCollectionSchema(tc.connID, "testdb", "empty", 100)
	require.NoError(t, err)

	assert.Equal(t, int64(0), schema.TotalDocs)
	assert.Empty(t, schema.Fields, "Should have no fields for empty collection")
}

func TestIntegration_SchemaWithPolymorphicField(t *testing.T) {
	tc := setupTestContainer(t)
	defer tc.teardown(t)

	// Seed documents with same field having different types
	tc.seedTestData(t, "testdb", "polymorphic", []bson.M{
		{"value": "string value"},
		{"value": 42},
		{"value": true},
		{"value": []string{"array", "value"}},
		{"value": bson.M{"nested": "object"}},
	})

	// Connect
	err := tc.app.Connect(tc.connID)
	require.NoError(t, err)

	// Infer schema
	schema, err := tc.app.InferCollectionSchema(tc.connID, "testdb", "polymorphic", 100)
	require.NoError(t, err)

	// The "value" field should show multiple types
	valueField := schema.Fields["value"]
	assert.NotEmpty(t, valueField.Type, "Should detect type for polymorphic field")
}
