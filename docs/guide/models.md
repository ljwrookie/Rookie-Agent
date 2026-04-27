# Models

Rookie Agent supports multiple LLM providers with automatic routing.

## Supported Providers

| Provider | Models | Features |
|----------|--------|----------|
| OpenAI | GPT-4o, GPT-4-turbo | Streaming, function calling |
| Anthropic | Claude 3.5 Sonnet, Opus | Streaming, function calling |
| OpenRouter | 100+ models | Unified API, cost optimization |

## Configuration

```json
{
  "model": {
    "default": "gpt-4o",
    "providers": {
      "openai": { "apiKey": "sk-..." },
      "anthropic": { "apiKey": "sk-ant-..." }
    }
  }
}
```

## Routing Strategies

- **Default**: Use configured default model
- **CostAware**: Route to cheapest capable model
- **Fallback**: Try primary, fallback on failure

## Environment Variables

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export OPENROUTER_API_KEY=sk-or-...
```
