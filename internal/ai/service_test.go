package ai

import (
	"context"
	"strings"
	"testing"

	"github.com/peternagy/mongopal/internal/core"
	"github.com/peternagy/mongopal/internal/schema"
)

// fakeProvider is a test double for Provider.
type fakeProvider struct {
	available bool
	reason    string
	resp      *Response
	err       error
	called    bool
}

func (f *fakeProvider) Name() string { return "fake" }
func (f *fakeProvider) IsAvailable() (bool, string) {
	return f.available, f.reason
}
func (f *fakeProvider) Generate(_ context.Context, _ Request) (*Response, error) {
	f.called = true
	return f.resp, f.err
}

func newTestService(p Provider) *Service {
	// A schema service with no active connection: InferCollectionSchema fails,
	// which is exactly what we want to exercise the schema-error path. Validation
	// and provider-availability checks fire before schema inference is reached.
	return NewService(schema.NewService(core.NewAppState()), func() Provider { return p })
}

func TestGenerateQuery_InvalidMode(t *testing.T) {
	p := &fakeProvider{available: true}
	_, err := newTestService(p).GenerateQuery("c", "db", "coll", "graphql", "list users", "sonnet")
	if err == nil || !strings.Contains(err.Error(), "invalid query mode") {
		t.Fatalf("expected invalid-mode error, got %v", err)
	}
	if p.called {
		t.Error("provider should not be called for an invalid mode")
	}
}

func TestGenerateQuery_EmptyPrompt(t *testing.T) {
	p := &fakeProvider{available: true}
	_, err := newTestService(p).GenerateQuery("c", "db", "coll", "mongo", "   ", "sonnet")
	if err == nil || !strings.Contains(err.Error(), "prompt cannot be empty") {
		t.Fatalf("expected empty-prompt error, got %v", err)
	}
	if p.called {
		t.Error("provider should not be called for an empty prompt")
	}
}

func TestGenerateQuery_ProviderUnavailable(t *testing.T) {
	p := &fakeProvider{available: false, reason: "no key"}
	_, err := newTestService(p).GenerateQuery("c", "db", "coll", "mongo", "list users", "sonnet")
	if err == nil || !strings.Contains(err.Error(), "AI provider unavailable") {
		t.Fatalf("expected provider-unavailable error, got %v", err)
	}
	if p.called {
		t.Error("provider Generate should not be called when unavailable")
	}
}

func TestGenerateQuery_SchemaInferenceError(t *testing.T) {
	// Provider is available, mode/prompt valid → reaches schema inference, which
	// fails because there is no active connection.
	p := &fakeProvider{available: true}
	_, err := newTestService(p).GenerateQuery("no-such-conn", "db", "coll", "mongo", "list users", "sonnet")
	if err == nil || !strings.Contains(err.Error(), "failed to infer collection schema") {
		t.Fatalf("expected schema-inference error, got %v", err)
	}
	if p.called {
		t.Error("provider should not be called when schema inference fails")
	}
}

func TestGenerateQuery_ModeNormalized(t *testing.T) {
	// " SQL " should normalize and pass validation (failing later at schema
	// inference, not at mode validation).
	p := &fakeProvider{available: true}
	_, err := newTestService(p).GenerateQuery("c", "db", "coll", "  SQL  ", "list", "sonnet")
	if err == nil || strings.Contains(err.Error(), "invalid query mode") {
		t.Fatalf("mode should normalize; got %v", err)
	}
}
