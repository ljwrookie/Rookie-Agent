# Settings

Rookie Agent uses a three-layer settings system:

## Layers

| Layer | Path | Git | Purpose |
|-------|------|-----|---------|
| Global | `~/.rookie/settings.json` | No | User defaults |
| Project | `<repo>/.rookie/settings.json` | Yes | Team shared |
| Local | `<repo>/.rookie/settings.local.json` | No | Personal overrides |

## Merge Strategy

Local > Project > Global. Arrays are deduplicated by identity.

## Example

```json
{
  "model": {
    "default": "gpt-4o",
    "fallback": "claude-sonnet-4"
  },
  "permissions": [
    { "tool": "file_read", "action": "allow" },
    { "tool": "shell_execute", "action": "ask" }
  ],
  "skills": {
    "enabled": ["typescript", "react"]
  }
}
```

## View Merged Settings

```bash
rookie config
rookie config --layer local
rookie config --format json
```
