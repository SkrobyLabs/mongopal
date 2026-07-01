package document

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ParseDocumentID converts a document ID string to the appropriate BSON type.
// Accepts: Extended JSON, ObjectID hex string, or plain string.
func ParseDocumentID(docID string) interface{} {
	normalizedID := NormalizeShellConstructors(docID)
	// Try to parse as Extended JSON first (handles Binary, UUID, ObjectId, $numberLong, etc.)
	if strings.HasPrefix(normalizedID, "{") {
		// Wrap in a document to properly parse Extended JSON types like $numberLong
		// bson.UnmarshalExtJSON into interface{} doesn't convert EJSON types, but bson.M does
		wrapped := fmt.Sprintf(`{"_id": %s}`, normalizedID)
		var doc bson.M
		if err := bson.UnmarshalExtJSON([]byte(wrapped), false, &doc); err == nil {
			return doc["_id"]
		}
	}

	// Try to parse as ObjectID hex
	if oid, err := primitive.ObjectIDFromHex(docID); err == nil {
		return oid
	}

	// Fall back to plain string
	return docID
}

// NormalizeShellConstructors converts mongosh-style constructors in document text
// to canonical Extended JSON while preserving constructor-like text inside strings.
func NormalizeShellConstructors(input string) string {
	var out strings.Builder
	inString := false
	var stringChar byte

	for i := 0; i < len(input); i++ {
		ch := input[i]
		prev := byte(0)
		if i > 0 {
			prev = input[i-1]
		}

		if (ch == '"' || ch == '\'' || ch == '`') && prev != '\\' {
			if !inString {
				inString = true
				stringChar = ch
			} else if ch == stringChar {
				inString = false
				stringChar = 0
			}
			out.WriteByte(ch)
			continue
		}

		if inString {
			out.WriteByte(ch)
			continue
		}

		if strings.HasPrefix(input[i:], "new ") {
			if replacement, end, ok := convertShellConstructor(input, i+4, "Date"); ok {
				out.WriteString(replacement)
				i = end
				continue
			}
		}

		converted := false
		for _, name := range []string{"ObjectId", "ISODate", "NumberInt", "NumberLong", "NumberDouble", "NumberDecimal", "UUID", "Timestamp", "MinKey", "MaxKey"} {
			if replacement, end, ok := convertShellConstructor(input, i, name); ok {
				out.WriteString(replacement)
				i = end
				converted = true
				break
			}
		}
		if converted {
			continue
		}

		out.WriteByte(ch)
	}

	return out.String()
}

func convertShellConstructor(input string, start int, name string) (string, int, bool) {
	if !strings.HasPrefix(input[start:], name) {
		return "", 0, false
	}

	i := start + len(name)
	for i < len(input) && isSpace(input[i]) {
		i++
	}
	if i >= len(input) || input[i] != '(' {
		return "", 0, false
	}

	arg, end, ok := extractParenArg(input, i)
	if !ok {
		return "", 0, false
	}

	replacement, ok := shellConstructorToExtJSON(name, arg)
	return replacement, end, ok
}

func extractParenArg(input string, parenIndex int) (string, int, bool) {
	depth := 1
	inString := false
	var stringChar byte
	i := parenIndex + 1

	for i < len(input) && depth > 0 {
		ch := input[i]
		prev := byte(0)
		if i > 0 {
			prev = input[i-1]
		}

		if (ch == '"' || ch == '\'' || ch == '`') && prev != '\\' {
			if !inString {
				inString = true
				stringChar = ch
			} else if ch == stringChar {
				inString = false
				stringChar = 0
			}
			i++
			continue
		}

		if inString {
			i++
			continue
		}

		switch ch {
		case '(':
			depth++
		case ')':
			depth--
		}
		i++
	}

	if depth != 0 {
		return "", 0, false
	}

	return strings.TrimSpace(input[parenIndex+1 : i-1]), i - 1, true
}

func shellConstructorToExtJSON(name, rawArg string) (string, bool) {
	arg := stripMatchingQuotes(strings.TrimSpace(rawArg))

	switch name {
	case "ObjectId":
		return `{"$oid":` + strconv.Quote(arg) + `}`, true
	case "ISODate", "Date":
		return `{"$date":` + strconv.Quote(arg) + `}`, true
	case "NumberInt":
		return `{"$numberInt":` + strconv.Quote(arg) + `}`, true
	case "NumberLong":
		return `{"$numberLong":` + strconv.Quote(arg) + `}`, true
	case "NumberDouble":
		return `{"$numberDouble":` + strconv.Quote(arg) + `}`, true
	case "NumberDecimal":
		return `{"$numberDecimal":` + strconv.Quote(arg) + `}`, true
	case "UUID":
		return `{"$uuid":` + strconv.Quote(arg) + `}`, true
	case "Timestamp":
		parts := splitTopLevelArgs(rawArg)
		if len(parts) != 2 {
			return "", false
		}
		return `{"$timestamp":{"t":` + strings.TrimSpace(parts[0]) + `,"i":` + strings.TrimSpace(parts[1]) + `}}`, true
	case "MinKey":
		return `{"$minKey":1}`, true
	case "MaxKey":
		return `{"$maxKey":1}`, true
	default:
		return "", false
	}
}

func splitTopLevelArgs(input string) []string {
	var parts []string
	start := 0
	depth := 0
	inString := false
	var stringChar byte

	for i := 0; i < len(input); i++ {
		ch := input[i]
		prev := byte(0)
		if i > 0 {
			prev = input[i-1]
		}

		if (ch == '"' || ch == '\'' || ch == '`') && prev != '\\' {
			if !inString {
				inString = true
				stringChar = ch
			} else if ch == stringChar {
				inString = false
				stringChar = 0
			}
			continue
		}

		if inString {
			continue
		}

		switch ch {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, input[start:i])
				start = i + 1
			}
		}
	}
	parts = append(parts, input[start:])
	return parts
}

func stripMatchingQuotes(input string) string {
	if len(input) >= 2 {
		first := input[0]
		last := input[len(input)-1]
		if (first == '"' || first == '\'' || first == '`') && first == last {
			return input[1 : len(input)-1]
		}
	}
	return input
}

func isSpace(ch byte) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'
}

// ValidateJSON validates JSON/Extended JSON syntax.
func ValidateJSON(jsonStr string) error {
	normalized := NormalizeShellConstructors(jsonStr)
	var doc bson.M
	if err := bson.UnmarshalExtJSON([]byte(normalized), false, &doc); err != nil {
		// Try standard JSON
		if err2 := json.Unmarshal([]byte(normalized), &doc); err2 != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}
	}
	return nil
}
