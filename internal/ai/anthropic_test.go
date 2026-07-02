package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

func TestMapModel(t *testing.T) {
	tests := []struct {
		input string
		want  anthropic.Model
	}{
		{"sonnet", anthropic.Model("claude-sonnet-5")},
		{"", anthropic.Model("claude-sonnet-5")},
		{"haiku", anthropic.ModelClaudeHaiku4_5},
		{"claude-opus-4-8", anthropic.Model("claude-opus-4-8")},
		{"custom-id", anthropic.Model("custom-id")},
	}
	for _, tt := range tests {
		if got := mapModel(tt.input); got != tt.want {
			t.Errorf("mapModel(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestAnthropicProvider_Generate(t *testing.T) {
	t.Setenv(envAPIKey, "sk-test")

	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_1",
			"type": "message",
			"role": "assistant",
			"model": "claude-sonnet-5",
			"content": [{"type":"text","text":"Here you go:\n` + "```" + `\ndb.users.find({})\n` + "```" + `"}],
			"stop_reason": "end_turn",
			"usage": {"input_tokens": 42, "output_tokens": 17}
		}`))
	}))
	defer server.Close()

	provider := NewAnthropicProvider(WithRequestOptions(option.WithBaseURL(server.URL)))
	resp, err := provider.Generate(context.Background(), Request{
		SystemPrompt: "SYS-PROMPT-MARKER",
		UserPrompt:   "find all users",
		Model:        "sonnet",
	})
	if err != nil {
		t.Fatalf("Generate error: %v", err)
	}

	if !strings.Contains(resp.Text, "db.users.find({})") {
		t.Errorf("response text = %q, missing query", resp.Text)
	}
	if resp.InputTokens != 42 || resp.OutputTokens != 17 {
		t.Errorf("usage = in %d/out %d, want 42/17", resp.InputTokens, resp.OutputTokens)
	}
	if resp.Model != "claude-sonnet-5" {
		t.Errorf("model = %q, want claude-sonnet-5", resp.Model)
	}

	// Assert request body carried the mapped model, max_tokens, and system prompt.
	if gotBody["model"] != "claude-sonnet-5" {
		t.Errorf("request model = %v, want claude-sonnet-5", gotBody["model"])
	}
	if mt, ok := gotBody["max_tokens"].(float64); !ok || int(mt) != maxTokens {
		t.Errorf("request max_tokens = %v, want %d", gotBody["max_tokens"], maxTokens)
	}
	sysRaw, _ := json.Marshal(gotBody["system"])
	if !strings.Contains(string(sysRaw), "SYS-PROMPT-MARKER") {
		t.Errorf("request system missing prompt marker, got %s", sysRaw)
	}
	// The user prompt must reach the messages array.
	msgRaw, _ := json.Marshal(gotBody["messages"])
	if !strings.Contains(string(msgRaw), "find all users") {
		t.Errorf("request messages missing user prompt, got %s", msgRaw)
	}
}

func TestAnthropicProvider_ErrorSurfaced(t *testing.T) {
	t.Setenv(envAPIKey, "sk-test")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid key"}}`))
	}))
	defer server.Close()

	provider := NewAnthropicProvider(WithRequestOptions(option.WithBaseURL(server.URL)))
	_, err := provider.Generate(context.Background(), Request{UserPrompt: "x", Model: "sonnet"})
	if err == nil {
		t.Fatal("expected error from 401 response")
	}
	// The error must carry the 401 signal so the frontend key-hint mapping fires.
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should surface the 401 status, got %q", err.Error())
	}
}

func TestAnthropicProvider_NoKey(t *testing.T) {
	t.Setenv(envAPIKey, "")
	_ = ClearAPIKey()

	provider := NewAnthropicProvider()
	if ok, _ := provider.IsAvailable(); ok {
		t.Error("provider should be unavailable with no key")
	}
	if _, err := provider.Generate(context.Background(), Request{UserPrompt: "x"}); err == nil {
		t.Error("expected error generating with no key")
	}
}
