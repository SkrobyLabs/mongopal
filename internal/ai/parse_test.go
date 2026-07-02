package ai

import "testing"

func TestExtractQuery(t *testing.T) {
	tests := []struct {
		name        string
		raw         string
		wantQuery   string
		wantExplain string
	}{
		{
			name:        "bare fence",
			raw:         "Here is your query:\n```\ndb.users.find({})\n```",
			wantQuery:   "db.users.find({})",
			wantExplain: "Here is your query:",
		},
		{
			name:        "js fence",
			raw:         "```js\ndb.users.find({ age: { $gt: 21 } })\n```\nThat filters adults.",
			wantQuery:   "db.users.find({ age: { $gt: 21 } })",
			wantExplain: "That filters adults.",
		},
		{
			name:        "sql fence",
			raw:         "Try this.\n```sql\nSELECT * FROM users\n```",
			wantQuery:   "SELECT * FROM users",
			wantExplain: "Try this.",
		},
		{
			name:        "no fence falls back to whole text",
			raw:         "  db.users.find({})  ",
			wantQuery:   "db.users.find({})",
			wantExplain: "",
		},
		{
			name:        "explanation before and after",
			raw:         "Before.\n```\nq\n```\nAfter.",
			wantQuery:   "q",
			wantExplain: "Before. After.",
		},
		{
			name:        "only the first fenced block is captured",
			raw:         "```\nfirst\n```\nmiddle\n```\nsecond\n```",
			wantQuery:   "first",
			wantExplain: "middle\n```\nsecond\n```",
		},
		{
			name:        "single-line fence has no fallback (treated as prose)",
			raw:         "```db.users.find()```",
			wantQuery:   "```db.users.find()```",
			wantExplain: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotQuery, gotExplain := ExtractQuery(tt.raw)
			if gotQuery != tt.wantQuery {
				t.Errorf("query = %q, want %q", gotQuery, tt.wantQuery)
			}
			if gotExplain != tt.wantExplain {
				t.Errorf("explanation = %q, want %q", gotExplain, tt.wantExplain)
			}
		})
	}
}
