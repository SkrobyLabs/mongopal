// Package ai provides a minimal, one-shot AI query-generation capability for
// MongoPal. It deliberately avoids streaming, chat history, and tool use: a
// single prompt in, a single response out. The Provider interface is the only
// abstraction so a second backend (e.g. a local model) can be added later
// without touching callers.
package ai

import "context"

// Request is a single, stateless generation request.
type Request struct {
	SystemPrompt string
	UserPrompt   string
	Model        string
}

// Response is the result of a single generation call.
type Response struct {
	Text         string
	InputTokens  int
	OutputTokens int
	Model        string
}

// Provider is a minimal one-shot text-generation backend.
type Provider interface {
	// Name returns a human-readable provider name.
	Name() string
	// IsAvailable reports whether the provider can be used and, if not, why.
	IsAvailable() (bool, string)
	// Generate performs a single, non-streaming generation.
	Generate(ctx context.Context, req Request) (*Response, error)
}
