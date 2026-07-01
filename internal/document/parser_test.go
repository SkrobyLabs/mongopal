package document

import (
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestNormalizeShellConstructors(t *testing.T) {
	input := `{
  "_id": ObjectId("507f1f77bcf86cd799439011"),
  "ClusterSize": NumberInt(3),
  "long": NumberLong("9223372036854775807"),
  "double": NumberDouble("3.14"),
  "decimal": NumberDecimal("1.23"),
  "createdAt": ISODate("2023-01-01T00:00:00Z"),
  "updatedAt": new Date("2023-01-02T00:00:00Z"),
  "uuid": UUID("550e8400-e29b-41d4-a716-446655440000"),
  "ts": Timestamp(1234, 1),
  "min": MinKey(),
  "max": MaxKey(),
  "literal": "NumberInt(3)"
}`

	normalized := NormalizeShellConstructors(input)
	var doc bson.M
	if err := bson.UnmarshalExtJSON([]byte(normalized), false, &doc); err != nil {
		t.Fatalf("normalized shell constructors should unmarshal as Extended JSON: %v\n%s", err, normalized)
	}

	if got := doc["ClusterSize"]; got != int32(3) {
		t.Fatalf("ClusterSize = %#v (%T), want int32(3)", got, got)
	}
	if got := doc["literal"]; got != "NumberInt(3)" {
		t.Fatalf("literal = %#v, want constructor text preserved", got)
	}
}

func TestValidateJSONAcceptsShellConstructors(t *testing.T) {
	jsonStr := `{"ClusterSize": NumberInt(3), "name": "NumberInt(3)"}`
	if err := ValidateJSON(jsonStr); err != nil {
		t.Fatalf("ValidateJSON should accept shell-style constructors: %v", err)
	}
}

func TestParseDocumentIDAcceptsShellConstructors(t *testing.T) {
	if got := ParseDocumentID(`NumberInt(42)`); got != int32(42) {
		t.Fatalf("ParseDocumentID(NumberInt) = %#v (%T), want int32(42)", got, got)
	}

	oid := primitive.NewObjectID()
	if got := ParseDocumentID(`ObjectId("` + oid.Hex() + `")`); !reflect.DeepEqual(got, oid) {
		t.Fatalf("ParseDocumentID(ObjectId) = %#v (%T), want %#v", got, got, oid)
	}
}
