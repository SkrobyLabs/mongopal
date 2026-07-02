// Package document handles MongoDB document CRUD operations.
package document

import (
	"fmt"
	"reflect"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/peternagy/mongopal/internal/core"
	"github.com/peternagy/mongopal/internal/debug"
	"github.com/peternagy/mongopal/internal/types"
)

// Service handles document CRUD operations.
type Service struct {
	state *core.AppState
}

// NewService creates a new document service.
func NewService(state *core.AppState) *Service {
	return &Service{state: state}
}

// FindDocuments executes a query and returns paginated results.
func (s *Service) FindDocuments(connID, dbName, collName, query string, opts types.QueryOptions) (*types.QueryResult, error) {
	debug.LogQuery("Executing find query", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"query":      query,
		"skip":       opts.Skip,
		"limit":      opts.Limit,
	})

	client, err := s.state.GetClient(connID)
	if err != nil {
		debug.LogQuery("Query failed - no connection", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"error":      err.Error(),
		})
		return nil, err
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	coll := client.Database(dbName).Collection(collName)

	// Parse query filter
	var filter bson.M
	if query == "" || query == "{}" {
		filter = bson.M{}
	} else {
		if err := bson.UnmarshalExtJSON([]byte(query), false, &filter); err != nil {
			debug.LogQuery("Query failed - invalid filter", map[string]interface{}{
				"database":   dbName,
				"collection": collName,
				"query":      query,
				"error":      err.Error(),
			})
			return nil, fmt.Errorf("invalid query: %w", err)
		}
	}

	// Set defaults
	if opts.Limit <= 0 || opts.Limit > 1000 {
		opts.Limit = 50
	}
	if opts.Skip < 0 {
		opts.Skip = 0
	}

	startTime := time.Now()

	// Get total count
	total, err := coll.CountDocuments(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("failed to count documents: %w", err)
	}

	// Build find options
	findOpts := options.Find().
		SetSkip(opts.Skip).
		SetLimit(opts.Limit)

	// Parse projection
	if opts.Projection != "" && opts.Projection != "{}" {
		var projection bson.M
		if err := bson.UnmarshalExtJSON([]byte(opts.Projection), false, &projection); err != nil {
			return nil, fmt.Errorf("invalid projection: %w", err)
		}
		findOpts.SetProjection(projection)
	}

	// Parse sort
	if opts.Sort != "" {
		if strings.HasPrefix(strings.TrimSpace(opts.Sort), "{") {
			var sortDoc bson.D
			if err := bson.UnmarshalExtJSON([]byte(opts.Sort), false, &sortDoc); err != nil {
				return nil, fmt.Errorf("invalid sort: %w", err)
			}
			findOpts.SetSort(sortDoc)
		} else {
			sortDoc := bson.D{}
			// Simple format: "-fieldName" for descending, "fieldName" for ascending
			for _, field := range strings.Split(opts.Sort, ",") {
				field = strings.TrimSpace(field)
				if strings.HasPrefix(field, "-") {
					sortDoc = append(sortDoc, bson.E{Key: field[1:], Value: -1})
				} else {
					sortDoc = append(sortDoc, bson.E{Key: field, Value: 1})
				}
			}
			findOpts.SetSort(sortDoc)
		}
	}

	// Execute query
	cursor, err := coll.Find(ctx, filter, findOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to find documents: %w", err)
	}
	defer cursor.Close(ctx)

	// Collect results as Extended JSON
	var documents []string
	var decodeErrors, marshalErrors int
	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			decodeErrors++
			continue
		}
		jsonBytes, err := bson.MarshalExtJSON(doc, true, false)
		if err != nil {
			marshalErrors++
			continue
		}
		documents = append(documents, string(jsonBytes))
	}

	queryTime := time.Since(startTime).Milliseconds()

	// Build warnings for any decode/marshal errors
	var warnings []string
	if decodeErrors > 0 {
		warnings = append(warnings, fmt.Sprintf("%d document(s) failed to decode", decodeErrors))
	}
	if marshalErrors > 0 {
		warnings = append(warnings, fmt.Sprintf("%d document(s) failed to marshal to JSON", marshalErrors))
	}

	debug.LogQuery("Query completed", map[string]interface{}{
		"database":    dbName,
		"collection":  collName,
		"docCount":    len(documents),
		"total":       total,
		"queryTimeMs": queryTime,
	})

	return &types.QueryResult{
		Documents:   documents,
		Total:       total,
		HasMore:     opts.Skip+int64(len(documents)) < total,
		QueryTimeMs: queryTime,
		Warnings:    warnings,
	}, nil
}

// allowedPipelineStages is an explicit allowlist rather than a denylist: this
// binding is general-purpose (callable with any pipeline string, not just
// ones the SQL converter produces), and the SQL grammar can only ever emit
// $match/$group/$sort/$limit/$project. An allowlist stays safe even if a
// future write- or side-effect-capable stage is added to MongoDB.
var allowedPipelineStages = map[string]bool{
	"$match":   true,
	"$group":   true,
	"$sort":    true,
	"$limit":   true,
	"$skip":    true,
	"$project": true,
	"$count":   true,
}

// parsePipeline parses an EJSON aggregation pipeline string into stages,
// rejecting any stage not on allowedPipelineStages (this binding is
// general-purpose and must not become a write vector).
func parsePipeline(pipeline string) ([]bson.M, error) {
	var stages bson.A
	if err := bson.UnmarshalExtJSON([]byte(pipeline), false, &stages); err != nil {
		return nil, fmt.Errorf("invalid pipeline: %w", err)
	}

	result := make([]bson.M, 0, len(stages))
	for _, raw := range stages {
		var stage bson.M
		switch v := raw.(type) {
		case bson.M:
			stage = v
		case primitive.D:
			stage = v.Map()
		default:
			return nil, fmt.Errorf("invalid pipeline: each stage must be an object")
		}
		if len(stage) != 1 {
			return nil, fmt.Errorf("invalid pipeline: each stage must have exactly one operator")
		}
		for op := range stage {
			if !allowedPipelineStages[op] {
				return nil, fmt.Errorf("pipeline stage %q is not allowed", op)
			}
		}
		result = append(result, stage)
	}
	return result, nil
}

// AggregateDocuments executes an aggregation pipeline and returns the results.
// pipeline is an Extended JSON array string. Only opts.Limit is used (Skip/Sort/
// Projection would be pipeline stages, not find options, and SQL mode encodes
// them as $limit/$sort/$project stages already).
func (s *Service) AggregateDocuments(connID, dbName, collName, pipeline string, opts types.QueryOptions) (*types.QueryResult, error) {
	debug.LogQuery("Executing aggregate query", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"pipeline":   pipeline,
	})

	client, err := s.state.GetClient(connID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	coll := client.Database(dbName).Collection(collName)

	stages, err := parsePipeline(pipeline)
	if err != nil {
		return nil, err
	}

	// Mirror FindDocuments' limit reset-to-default (not a clamp) so HasMore
	// stays truthful about whether the guard was hit.
	if opts.Limit <= 0 || opts.Limit > 1000 {
		opts.Limit = 50
	}
	stages = append(stages, bson.M{"$limit": opts.Limit})

	startTime := time.Now()

	cursor, err := coll.Aggregate(ctx, stages, options.Aggregate().SetAllowDiskUse(true))
	if err != nil {
		return nil, fmt.Errorf("failed to execute aggregation: %w", err)
	}
	defer cursor.Close(ctx)

	var documents []string
	var decodeErrors, marshalErrors int
	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			decodeErrors++
			continue
		}
		jsonBytes, err := bson.MarshalExtJSON(doc, true, false)
		if err != nil {
			marshalErrors++
			continue
		}
		documents = append(documents, string(jsonBytes))
	}

	queryTime := time.Since(startTime).Milliseconds()

	var warnings []string
	if decodeErrors > 0 {
		warnings = append(warnings, fmt.Sprintf("%d document(s) failed to decode", decodeErrors))
	}
	if marshalErrors > 0 {
		warnings = append(warnings, fmt.Sprintf("%d document(s) failed to marshal to JSON", marshalErrors))
	}

	total := int64(len(documents))
	return &types.QueryResult{
		Documents:   documents,
		Total:       total,
		HasMore:     total >= int64(opts.Limit),
		QueryTimeMs: queryTime,
		Warnings:    warnings,
	}, nil
}

// GetDocument returns a single document by ID.
// docID can be: Extended JSON, ObjectID hex, or plain string.
func (s *Service) GetDocument(connID, dbName, collName, docID string) (string, error) {
	client, err := s.state.GetClient(connID)
	if err != nil {
		return "", err
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	coll := client.Database(dbName).Collection(collName)
	filter := bson.M{"_id": ParseDocumentID(docID)}

	var doc bson.M
	if err := coll.FindOne(ctx, filter).Decode(&doc); err != nil {
		if err == mongo.ErrNoDocuments {
			return "", fmt.Errorf("document not found")
		}
		return "", fmt.Errorf("failed to get document: %w", err)
	}

	jsonBytes, err := bson.MarshalExtJSON(doc, true, false)
	if err != nil {
		return "", fmt.Errorf("failed to marshal document: %w", err)
	}

	return string(jsonBytes), nil
}

// UpdateDocument replaces a document.
// docID can be: Extended JSON, ObjectID hex, or plain string.
func (s *Service) UpdateDocument(connID, dbName, collName, docID, jsonDoc string) error {
	debug.LogDocument("Updating document", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"documentId": docID,
	})

	client, err := s.state.GetClient(connID)
	if err != nil {
		return err
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	// Parse the JSON document
	var doc bson.M
	normalizedDoc := NormalizeShellConstructors(jsonDoc)
	if err := bson.UnmarshalExtJSON([]byte(normalizedDoc), false, &doc); err != nil {
		debug.LogDocument("Update failed - invalid JSON", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"documentId": docID,
			"error":      err.Error(),
		})
		return fmt.Errorf("invalid JSON: %w", err)
	}

	coll := client.Database(dbName).Collection(collName)

	// Existing-document updates must target the original document id. A replacement
	// document may include _id, but it cannot change it.
	originalID := ParseDocumentID(docID)
	if id, ok := doc["_id"]; ok {
		if !documentIDsEqual(originalID, id) {
			debug.LogDocument("Update failed - _id changed", map[string]interface{}{
				"database":   dbName,
				"collection": collName,
				"documentId": docID,
			})
			return fmt.Errorf("document _id cannot be changed with UpdateDocument")
		}
	}

	filter := bson.M{"_id": originalID}
	result, err := coll.ReplaceOne(ctx, filter, doc)
	if err != nil {
		debug.LogDocument("Update failed", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"documentId": docID,
			"error":      err.Error(),
		})
		return fmt.Errorf("failed to update document: %w", err)
	}

	if result.MatchedCount == 0 {
		debug.LogDocument("Update failed - document not found", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"documentId": docID,
		})
		return fmt.Errorf("document not found")
	}

	debug.LogDocument("Document updated", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"documentId": docID,
	})

	return nil
}

func documentIDsEqual(expected, actual interface{}) bool {
	return reflect.DeepEqual(expected, actual)
}

// InsertDocument creates a new document.
func (s *Service) InsertDocument(connID, dbName, collName, jsonDoc string) (string, error) {
	debug.LogDocument("Inserting document", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
	})

	client, err := s.state.GetClient(connID)
	if err != nil {
		return "", err
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	// Parse the JSON document
	var doc bson.M
	normalizedDoc := NormalizeShellConstructors(jsonDoc)
	if err := bson.UnmarshalExtJSON([]byte(normalizedDoc), false, &doc); err != nil {
		debug.LogDocument("Insert failed - invalid JSON", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"error":      err.Error(),
		})
		return "", fmt.Errorf("invalid JSON: %w", err)
	}

	coll := client.Database(dbName).Collection(collName)

	result, err := coll.InsertOne(ctx, doc)
	if err != nil {
		debug.LogDocument("Insert failed", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"error":      err.Error(),
		})
		return "", fmt.Errorf("failed to insert document: %w", err)
	}

	// Return the inserted ID as string
	var insertedID string
	switch id := result.InsertedID.(type) {
	case primitive.ObjectID:
		insertedID = id.Hex()
	default:
		insertedID = fmt.Sprintf("%v", id)
	}

	debug.LogDocument("Document inserted", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"documentId": insertedID,
	})

	return insertedID, nil
}

// DeleteDocument removes a document.
// docID can be: Extended JSON (e.g., {"$oid":"..."} or {"$binary":...}), plain ObjectID hex, or string.
func (s *Service) DeleteDocument(connID, dbName, collName, docID string) error {
	debug.LogDocument("Deleting document", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"documentId": docID,
	})

	client, err := s.state.GetClient(connID)
	if err != nil {
		return err
	}

	ctx, cancel := core.ContextWithTimeout()
	defer cancel()

	coll := client.Database(dbName).Collection(collName)

	// Build filter based on docID format
	filter := bson.M{"_id": ParseDocumentID(docID)}

	result, err := coll.DeleteOne(ctx, filter)
	if err != nil {
		debug.LogDocument("Delete failed", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"documentId": docID,
			"error":      err.Error(),
		})
		return fmt.Errorf("failed to delete document: %w", err)
	}

	if result.DeletedCount == 0 {
		debug.LogDocument("Delete failed - document not found", map[string]interface{}{
			"database":   dbName,
			"collection": collName,
			"documentId": docID,
		})
		return fmt.Errorf("document not found")
	}

	debug.LogDocument("Document deleted", map[string]interface{}{
		"database":   dbName,
		"collection": collName,
		"documentId": docID,
	})

	return nil
}
