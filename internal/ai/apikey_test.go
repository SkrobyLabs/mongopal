package ai

import (
	"testing"

	"github.com/zalando/go-keyring"
)

func TestAPIKey_SaveStatusClearRoundTrip(t *testing.T) {
	t.Setenv(envAPIKey, "")
	_ = ClearAPIKey()

	if got := KeyStatus(); got != "not_set" {
		t.Fatalf("initial status = %q, want not_set", got)
	}

	if err := SaveAPIKey("  sk-test-123  "); err != nil {
		t.Fatalf("SaveAPIKey error: %v", err)
	}
	if got := KeyStatus(); got != "configured" {
		t.Fatalf("status after save = %q, want configured", got)
	}
	if got := resolveAPIKey(); got != "sk-test-123" {
		t.Fatalf("resolveAPIKey = %q, want trimmed sk-test-123", got)
	}

	if err := ClearAPIKey(); err != nil {
		t.Fatalf("ClearAPIKey error: %v", err)
	}
	if got := KeyStatus(); got != "not_set" {
		t.Fatalf("status after clear = %q, want not_set", got)
	}
}

func TestAPIKey_EmptyRejected(t *testing.T) {
	if err := SaveAPIKey("   "); err == nil {
		t.Fatal("expected error saving empty key")
	}
}

func TestAPIKey_EnvPriority(t *testing.T) {
	_ = ClearAPIKey()
	if err := keyring.Set(keyringService, keyringKey, "from-keyring"); err != nil {
		t.Fatalf("keyring set: %v", err)
	}
	defer func() { _ = ClearAPIKey() }()

	t.Setenv(envAPIKey, "from-env")
	if got := KeyStatus(); got != "env" {
		t.Fatalf("status = %q, want env", got)
	}
	if got := resolveAPIKey(); got != "from-env" {
		t.Fatalf("resolveAPIKey = %q, want from-env (env priority)", got)
	}
}

func TestAPIKey_ClearMissingNotError(t *testing.T) {
	_ = ClearAPIKey()
	if err := ClearAPIKey(); err != nil {
		t.Fatalf("clearing an absent key should not error, got: %v", err)
	}
}
