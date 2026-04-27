# Permissions

Rookie Agent uses a rule-based permission system with three actions:

| Action | Behavior |
|--------|----------|
| `allow` | Execute without prompting |
| `deny` | Reject immediately |
| `ask` | Show TUI approval panel |

## Managing Rules

```bash
# Allow all file reads
rookie permission allow --tool file_read

# Deny dangerous operations
rookie permission deny --tool shell_execute --args "rm -rf"

# Ask for git pushes
rookie permission ask --tool git_push

# List current rules
rookie permission list

# Move rule between scopes
rookie permission move --index 0 --from local --to project
```

## Remember Scope

When prompted, choose:

- **once** — Just this time
- **session** — Until process exits
- **forever** — Persist to `settings.local.json`

## Rule Priority

1. Session rules (highest)
2. User settings
3. Default rules (lowest)
