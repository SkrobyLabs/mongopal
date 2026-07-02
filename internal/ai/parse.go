package ai

import (
	"regexp"
	"strings"
)

// fencedBlock matches the first fenced code block, tolerating an optional
// language tag (```js, ```sql, ```javascript, or a bare ```).
var fencedBlock = regexp.MustCompile("(?s)```[a-zA-Z0-9_-]*\\r?\\n(.*?)```")

// ExtractQuery pulls the generated query out of the model response. It returns
// the contents of the first fenced code block as the query and everything
// outside that block (trimmed) as the explanation. When no fenced block is
// present, the whole trimmed response is treated as the query with an empty
// explanation.
func ExtractQuery(raw string) (query, explanation string) {
	loc := fencedBlock.FindStringSubmatchIndex(raw)
	if loc == nil {
		return strings.TrimSpace(raw), ""
	}

	// loc[2]:loc[3] is the captured inner content of the block.
	query = strings.TrimSpace(raw[loc[2]:loc[3]])

	// Explanation is whatever surrounds the full match (loc[0]:loc[1]).
	before := raw[:loc[0]]
	after := raw[loc[1]:]
	explanation = strings.TrimSpace(strings.TrimSpace(before) + " " + strings.TrimSpace(after))
	explanation = strings.TrimSpace(explanation)

	return query, explanation
}
