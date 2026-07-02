package document

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestDocumentIDsEqual(t *testing.T) {
	oid := primitive.NewObjectID()

	tests := []struct {
		name     string
		docID    string
		jsonID   string
		expected bool
	}{
		{
			name:     "matching string id",
			docID:    "doc123",
			jsonID:   `"doc123"`,
			expected: true,
		},
		{
			name:     "different string id",
			docID:    "doc123",
			jsonID:   `"doc456"`,
			expected: false,
		},
		{
			name:     "matching object id",
			docID:    oid.Hex(),
			jsonID:   `{"$oid":"` + oid.Hex() + `"}`,
			expected: true,
		},
		{
			name:     "different object id",
			docID:    oid.Hex(),
			jsonID:   `{"$oid":"` + primitive.NewObjectID().Hex() + `"}`,
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var doc bson.M
			if err := bson.UnmarshalExtJSON([]byte(`{"_id":`+tt.jsonID+`}`), true, &doc); err != nil {
				t.Fatalf("failed to unmarshal id: %v", err)
			}

			actual := documentIDsEqual(ParseDocumentID(tt.docID), doc["_id"])
			if actual != tt.expected {
				t.Fatalf("documentIDsEqual() = %v, want %v", actual, tt.expected)
			}
		})
	}
}

func TestParsePipeline(t *testing.T) {
	t.Run("valid pipeline", func(t *testing.T) {
		stages, err := parsePipeline(`[{"$match":{"active":true}},{"$group":{"_id":"$status","count":{"$sum":1}}}]`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(stages) != 2 {
			t.Fatalf("expected 2 stages, got %d", len(stages))
		}
	})

	t.Run("non-array is rejected", func(t *testing.T) {
		_, err := parsePipeline(`{"$match":{"active":true}}`)
		if err == nil {
			t.Fatal("expected error for non-array pipeline")
		}
	})

	t.Run("invalid JSON is rejected", func(t *testing.T) {
		_, err := parsePipeline(`not json`)
		if err == nil {
			t.Fatal("expected error for invalid JSON")
		}
	})

	t.Run("$out stage is rejected", func(t *testing.T) {
		_, err := parsePipeline(`[{"$match":{}},{"$out":"otherCollection"}]`)
		if err == nil {
			t.Fatal("expected error for $out stage")
		}
	})

	t.Run("$merge stage is rejected", func(t *testing.T) {
		_, err := parsePipeline(`[{"$merge":{"into":"otherCollection"}}]`)
		if err == nil {
			t.Fatal("expected error for $merge stage")
		}
	})

	t.Run("non-allowlisted stage is rejected", func(t *testing.T) {
		_, err := parsePipeline(`[{"$lookup":{"from":"other","localField":"a","foreignField":"b","as":"joined"}}]`)
		if err == nil {
			t.Fatal("expected error for $lookup stage (not on the allowlist)")
		}
	})

	t.Run("multi-key stage is rejected", func(t *testing.T) {
		_, err := parsePipeline(`[{"$match":{},"$out":"x"}]`)
		if err == nil {
			t.Fatal("expected error for a stage with more than one top-level operator")
		}
	})

	t.Run("accepts a bare ISO date string in $date (relaxed extended JSON)", func(t *testing.T) {
		// The SQL/mongosh ISODate('...') conversion emits {"$date": "<ISO string>"},
		// which canonical Extended JSON rejects (it requires {"$date": {"$numberLong": ...}}).
		// parsePipeline must accept it since FindDocuments/AggregateDocuments parse in relaxed mode.
		stages, err := parsePipeline(`[{"$match":{"CreatedAt":{"$gte":{"$date":"2024-01-01T00:00:00Z"}}}}]`)
		if err != nil {
			t.Fatalf("unexpected error for relaxed $date: %v", err)
		}
		if len(stages) != 1 {
			t.Fatalf("expected 1 stage, got %d", len(stages))
		}
	})
}
