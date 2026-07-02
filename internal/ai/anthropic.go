package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// maxTokens bounds the response size for a single query-generation call.
const maxTokens = 2048

// AnthropicProvider implements Provider using the Anthropic Messages API with a
// single non-streaming request.
type AnthropicProvider struct {
	// extraOpts are additional SDK request options (e.g. a base URL override for
	// tests). The API key option is prepended at call time.
	extraOpts []option.RequestOption
}

// AnthropicOption configures an AnthropicProvider.
type AnthropicOption func(*AnthropicProvider)

// WithRequestOptions injects additional SDK request options. Tests use this to
// point the client at an httptest server via option.WithBaseURL.
func WithRequestOptions(opts ...option.RequestOption) AnthropicOption {
	return func(p *AnthropicProvider) {
		p.extraOpts = append(p.extraOpts, opts...)
	}
}

// NewAnthropicProvider constructs an Anthropic provider.
func NewAnthropicProvider(opts ...AnthropicOption) *AnthropicProvider {
	p := &AnthropicProvider{}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

func (p *AnthropicProvider) Name() string { return "Anthropic" }

// IsAvailable reports whether an API key resolves and describes its source.
func (p *AnthropicProvider) IsAvailable() (bool, string) {
	switch KeyStatus() {
	case "env":
		return true, "API key set via ANTHROPIC_API_KEY environment variable"
	case "configured":
		return true, "API key configured"
	case "error":
		return false, "Could not read the API key from the OS keyring. Check keyring access and try again."
	default:
		return false, "API key not configured. Set ANTHROPIC_API_KEY or configure one in Settings → AI."
	}
}

// Generate performs a single non-streaming Messages request.
func (p *AnthropicProvider) Generate(ctx context.Context, req Request) (*Response, error) {
	apiKey := resolveAPIKey()
	if apiKey == "" {
		return nil, fmt.Errorf("anthropic API key not configured")
	}

	opts := append([]option.RequestOption{option.WithAPIKey(apiKey)}, p.extraOpts...)
	client := anthropic.NewClient(opts...)

	resolvedModel := mapModel(req.Model)
	params := anthropic.MessageNewParams{
		Model:     resolvedModel,
		MaxTokens: maxTokens,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(req.UserPrompt)),
		},
	}
	if strings.TrimSpace(req.SystemPrompt) != "" {
		params.System = []anthropic.TextBlockParam{{Text: req.SystemPrompt}}
	}

	msg, err := client.Messages.New(ctx, params, opts...)
	if err != nil {
		return nil, fmt.Errorf("anthropic request failed: %w", err)
	}

	var sb strings.Builder
	for _, block := range msg.Content {
		if block.Type == "text" {
			sb.WriteString(block.Text)
		}
	}

	return &Response{
		Text:         sb.String(),
		InputTokens:  int(msg.Usage.InputTokens),
		OutputTokens: int(msg.Usage.OutputTokens),
		Model:        string(msg.Model),
	}, nil
}

// mapModel maps short model aliases to full Anthropic model IDs. Unknown names
// pass through unchanged so callers can pin a specific model ID.
func mapModel(name string) anthropic.Model {
	switch name {
	case "sonnet", "":
		// No SDK constant for Sonnet 5; anthropic.Model is a plain string.
		return anthropic.Model("claude-sonnet-5")
	case "haiku":
		return anthropic.ModelClaudeHaiku4_5
	default:
		return anthropic.Model(name)
	}
}
