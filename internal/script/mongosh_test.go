package script

import (
	"strings"
	"testing"
)

func TestBuildWrappedScript(t *testing.T) {
	got := buildWrappedScript("db.Builds.aggregate([{ $count: \"n\" }])")

	// URI must be read from the environment, never embedded literally, so the
	// password stays out of argv.
	if !strings.Contains(got, "process.env."+scriptURIEnvVar) {
		t.Errorf("wrapped script does not read URI from env: %q", got)
	}
	// connect() must precede the user script so its result is not the final
	// (auto-printed) expression.
	connectIdx := strings.Index(got, "connect(")
	userIdx := strings.Index(got, "aggregate(")
	if connectIdx < 0 || userIdx < 0 || connectIdx > userIdx {
		t.Errorf("connect() must come before the user script: %q", got)
	}
	if strings.HasSuffix(strings.TrimSpace(got), ";") {
		// The final statement should be the user's expression, not a trailing
		// connect assignment.
		if strings.HasSuffix(strings.TrimSpace(got), "connect(process.env."+scriptURIEnvVar+");") {
			t.Errorf("user script missing from wrapped output: %q", got)
		}
	}
}

func TestSetURIDatabase(t *testing.T) {
	tests := []struct {
		name    string
		uri     string
		dbName  string
		want    string
		wantErr bool
	}{
		{
			name:   "auth db in path, no authSource - promotes to authSource",
			uri:    "mongodb://user:pass@host:27017/admin",
			dbName: "Builds",
			want:   "mongodb://user:pass@host:27017/Builds?authSource=admin",
		},
		{
			name:   "existing authSource preserved",
			uri:    "mongodb://user:pass@host:27017/admin?authSource=admin",
			dbName: "Builds",
			want:   "mongodb://user:pass@host:27017/Builds?authSource=admin",
		},
		{
			name:   "authSource differs from path db - not overwritten",
			uri:    "mongodb://user:pass@host:27017/somedb?authSource=admin",
			dbName: "Builds",
			want:   "mongodb://user:pass@host:27017/Builds?authSource=admin",
		},
		{
			name:   "no path db - no authSource added",
			uri:    "mongodb://user:pass@host:27017/",
			dbName: "Builds",
			want:   "mongodb://user:pass@host:27017/Builds",
		},
		{
			name:   "no path at all - no authSource added",
			uri:    "mongodb://user:pass@host:27017",
			dbName: "Builds",
			want:   "mongodb://user:pass@host:27017/Builds",
		},
		{
			name:   "preserves other query params",
			uri:    "mongodb://user:pass@host:27017/admin?ssl=true",
			dbName: "Builds",
			want:   "mongodb://user:pass@host:27017/Builds?authSource=admin&ssl=true",
		},
		{
			name:    "invalid URI errors",
			uri:     "://not a uri",
			dbName:  "Builds",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := setURIDatabase(tt.uri, tt.dbName)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (result: %q)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("setURIDatabase(%q, %q) = %q, want %q", tt.uri, tt.dbName, got, tt.want)
			}
		})
	}
}
