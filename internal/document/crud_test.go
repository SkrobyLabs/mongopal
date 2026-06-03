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
