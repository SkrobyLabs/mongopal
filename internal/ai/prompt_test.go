package ai

import (
	"fmt"
	"strings"
	"testing"

	"github.com/peternagy/mongopal/internal/types"
)

func TestBuildSystemPrompt_MongoMode(t *testing.T) {
	schema := &types.SchemaResult{
		Collection: "users",
		TotalDocs:  100,
		SampleSize: 10,
		Fields: map[string]types.SchemaField{
			"name": {Type: "String", Occurrence: 100},
			"address": {
				Type:       "Object",
				Occurrence: 98,
				Fields: map[string]types.SchemaField{
					"city": {Type: "String", Occurrence: 90},
				},
			},
		},
	}

	prompt := BuildSystemPrompt(schema, "users", "mongo")

	if !strings.Contains(prompt, "db.users.find(") {
		t.Errorf("mongo prompt should describe db.users.find, got:\n%s", prompt)
	}
	if !strings.Contains(prompt, "db.users.aggregate(") {
		t.Errorf("mongo prompt should describe db.users.aggregate")
	}
	if strings.Contains(prompt, "SELECT") {
		t.Errorf("mongo prompt should not mention SQL SELECT")
	}
	if !strings.Contains(prompt, "address.city: String (90%)") {
		t.Errorf("nested field should be flattened with occurrence, got:\n%s", prompt)
	}
	if !strings.Contains(prompt, "name: String (100%)") {
		t.Errorf("top-level field missing, got:\n%s", prompt)
	}
}

func TestBuildSystemPrompt_SQLMode(t *testing.T) {
	schema := &types.SchemaResult{
		Collection: "orders",
		TotalDocs:  50,
		SampleSize: 10,
		Fields: map[string]types.SchemaField{
			"total": {Type: "Double", Occurrence: 100},
		},
	}

	prompt := BuildSystemPrompt(schema, "orders", "sql")

	for _, want := range []string{"SELECT", "FROM orders", "GROUP BY", "LIMIT", "HAVING"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("sql prompt missing %q, got:\n%s", want, prompt)
		}
	}
	// The prompt must warn the model away from OFFSET and JOIN.
	if !strings.Contains(prompt, "OFFSET") || !strings.Contains(prompt, "JOIN") {
		t.Errorf("sql prompt should explicitly list OFFSET/JOIN as unsupported")
	}
	if strings.Contains(prompt, "db.orders.find") {
		t.Errorf("sql prompt should not contain mongo shell syntax")
	}
}

func TestBuildSystemPrompt_EmptyCollection(t *testing.T) {
	// TotalDocs == 0 with empty Fields must not divide by zero and should still
	// produce a sensible instruction.
	schema := &types.SchemaResult{
		Collection: "empty",
		TotalDocs:  0,
		SampleSize: 0,
		Fields:     map[string]types.SchemaField{},
	}

	prompt := BuildSystemPrompt(schema, "empty", "mongo")
	if !strings.Contains(prompt, "empty or has no sampled documents") {
		t.Errorf("empty-collection prompt missing guidance, got:\n%s", prompt)
	}

	// Also nil schema must be handled.
	nilPrompt := BuildSystemPrompt(nil, "empty", "mongo")
	if !strings.Contains(nilPrompt, "empty or has no sampled documents") {
		t.Errorf("nil-schema prompt missing guidance, got:\n%s", nilPrompt)
	}
}

func TestBuildSystemPrompt_FieldNameSanitization(t *testing.T) {
	schema := &types.SchemaResult{
		Collection: "c",
		TotalDocs:  10,
		SampleSize: 10,
		Fields: map[string]types.SchemaField{
			"ev`il\nfield": {Type: "String", Occurrence: 100},
		},
	}

	prompt := BuildSystemPrompt(schema, "c", "mongo")
	if strings.Contains(prompt, "`") {
		t.Errorf("prompt must not contain backticks from hostile field names, got:\n%s", prompt)
	}
	if strings.Contains(prompt, "ev`il") || strings.Contains(prompt, "il\nfield") {
		t.Errorf("hostile field name should be sanitized, got:\n%s", prompt)
	}
}

func TestBuildSystemPrompt_Truncation(t *testing.T) {
	fields := make(map[string]types.SchemaField)
	// Create more than maxSchemaFields fields with varying occurrence.
	for i := 0; i < maxSchemaFields+50; i++ {
		fields[fmt.Sprintf("f%03d", i)] = types.SchemaField{
			Type:       "String",
			Occurrence: float64(i % 100),
		}
	}
	// A guaranteed-high-occurrence field that must survive truncation.
	fields["keepme"] = types.SchemaField{Type: "String", Occurrence: 100}

	schema := &types.SchemaResult{
		Collection: "big",
		TotalDocs:  1000,
		SampleSize: 10,
		Fields:     fields,
	}

	prompt := BuildSystemPrompt(schema, "big", "mongo")
	if !strings.Contains(prompt, "schema truncated to the top") {
		t.Errorf("truncation note missing, got:\n%s", prompt)
	}
	if !strings.Contains(prompt, "keepme: String (100%)") {
		t.Errorf("highest-occurrence field should survive truncation, got:\n%s", prompt)
	}
	// Count emitted schema field lines (each ends with an occurrence "(NN%)").
	lines := strings.Count(prompt, "%)")
	if lines > maxSchemaFields {
		t.Errorf("emitted %d field lines, want <= %d", lines, maxSchemaFields)
	}
}
