package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/peternagy/mongopal/internal/schema"
	"github.com/peternagy/mongopal/internal/types"
)

// generateTimeout bounds a single query-generation call end-to-end.
const generateTimeout = 60 * time.Second

// Service orchestrates AI query generation: it infers the collection schema,
// builds a prompt, and calls the configured provider. It holds no MongoDB or
// app state of its own beyond the schema service it delegates to.
type Service struct {
	schemaSvc   *schema.Service
	newProvider func() Provider
}

// NewService creates an AI service. newProvider is a factory so a fresh
// provider (and thus a fresh API-key resolution) is used per request; when nil,
// the Anthropic provider is used.
func NewService(schemaSvc *schema.Service, newProvider func() Provider) *Service {
	if newProvider == nil {
		newProvider = func() Provider { return NewAnthropicProvider() }
	}
	return &Service{schemaSvc: schemaSvc, newProvider: newProvider}
}

// GenerateQuery infers the collection schema and asks the provider to generate a
// query in the requested mode ("mongo" or "sql") for the user's prompt.
func (s *Service) GenerateQuery(connID, dbName, collName, mode, userPrompt, model string) (*types.AIQueryResult, error) {
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode != "mongo" && mode != "sql" {
		return nil, fmt.Errorf("invalid query mode %q: must be \"mongo\" or \"sql\"", mode)
	}
	if strings.TrimSpace(userPrompt) == "" {
		return nil, fmt.Errorf("prompt cannot be empty")
	}

	provider := s.newProvider()
	if ok, reason := provider.IsAvailable(); !ok {
		return nil, fmt.Errorf("AI provider unavailable: %s", reason)
	}

	// Schema inference requires an active connection; surface its error cleanly.
	schemaResult, err := s.schemaSvc.InferCollectionSchema(connID, dbName, collName, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to infer collection schema: %w", err)
	}

	systemPrompt := BuildSystemPrompt(schemaResult, collName, mode)

	ctx, cancel := context.WithTimeout(context.Background(), generateTimeout)
	defer cancel()

	resp, err := provider.Generate(ctx, Request{
		SystemPrompt: systemPrompt,
		UserPrompt:   userPrompt,
		Model:        model,
	})
	if err != nil {
		return nil, fmt.Errorf("query generation failed: %w", err)
	}

	query, explanation := ExtractQuery(resp.Text)

	return &types.AIQueryResult{
		Raw:          resp.Text,
		Query:        query,
		Explanation:  explanation,
		Model:        resp.Model,
		InputTokens:  resp.InputTokens,
		OutputTokens: resp.OutputTokens,
	}, nil
}
