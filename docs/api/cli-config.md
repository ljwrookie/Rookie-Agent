# CLI Configuration

## Global Flags

| Flag | Description |
|------|-------------|
| `-p, --prompt [text]` | Run single prompt |
| `-o, --output-format` | text / json / stream-json |
| `--model <model>` | Model override |
| `--agent <agent>` | Agent override |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `RUST_LOG` | Rust log level |
| `CI` | Non-interactive mode |

## Settings Files

```
~/.rookie/
  settings.json          # Global settings
  config.json            # Legacy config

<repo>/.rookie/
  settings.json          # Project settings
  settings.local.json    # Local overrides
  progress.md            # Session progress
  features.json          # Feature list
  skills/                # Skill definitions
  user-models/           # User models
  schedulers.json        # Scheduled tasks
```
