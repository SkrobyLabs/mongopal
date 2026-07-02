package ai

import (
	"fmt"
	"os"
	"strings"

	"github.com/zalando/go-keyring"
)

const (
	// keyringService matches encryptionKeyringService in internal/credential so
	// all MongoPal secrets live under a single OS keyring service entry.
	keyringService = "mongopal"
	keyringKey     = "anthropic-api-key"

	// envAPIKey, when set, always takes priority over the keyring.
	envAPIKey = "ANTHROPIC_API_KEY"
)

// lookupStoredKey reads the key from the OS keyring, distinguishing "not
// stored" from a genuine keyring failure. A missing key returns ("", nil); a
// transient/permission error returns ("", err) so callers don't misreport a
// stored key as absent.
func lookupStoredKey() (string, error) {
	key, err := keyring.Get(keyringService, keyringKey)
	if err == keyring.ErrNotFound {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(key), nil
}

// resolveAPIKey returns the Anthropic API key, preferring the environment
// variable over the OS keyring. There is intentionally NO plain-file fallback:
// the key is only ever persisted in the OS keyring.
func resolveAPIKey() string {
	if key := strings.TrimSpace(os.Getenv(envAPIKey)); key != "" {
		return key
	}
	key, _ := lookupStoredKey()
	return key
}

// SaveAPIKey stores the API key in the OS keyring. An empty key is rejected and
// any keyring error is returned to the caller (never swallowed) so the UI can
// surface it.
func SaveAPIKey(key string) error {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return fmt.Errorf("api key cannot be empty")
	}
	if err := keyring.Set(keyringService, keyringKey, trimmed); err != nil {
		return fmt.Errorf("failed to store API key in keyring: %w", err)
	}
	return nil
}

// ClearAPIKey removes the API key from the OS keyring. A missing key is not an
// error.
func ClearAPIKey() error {
	if err := keyring.Delete(keyringService, keyringKey); err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("failed to clear API key from keyring: %w", err)
	}
	return nil
}

// KeyStatus reports where the API key comes from: "env" (environment variable),
// "configured" (stored in keyring), "not_set", or "error" when the keyring
// itself could not be read (so a valid stored key is never misreported as
// absent).
func KeyStatus() string {
	if strings.TrimSpace(os.Getenv(envAPIKey)) != "" {
		return "env"
	}
	key, err := lookupStoredKey()
	if err != nil {
		return "error"
	}
	if key != "" {
		return "configured"
	}
	return "not_set"
}
