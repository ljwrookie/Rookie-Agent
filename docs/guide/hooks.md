# Hooks

Hooks let you extend Rookie Agent's lifecycle with custom scripts.

## Event Types

| Event | When | Can Reject |
|-------|------|------------|
| `PreToolUse` | Before tool execution | Yes |
| `PostToolUse` | After tool execution | No |
| `PreCheckpoint` | Before git commit | Yes |
| `PostCheckpoint` | After git commit | No |
| `SessionStart` | Session begins | No |
| `SessionEnd` | Session ends | No |
| `OnPermissionAsk` | Permission prompt shown | No |
| `OnSkillProposed` | Skill suggestion shown | No |

## Hook Types

### Shell Hook

```bash
rookie hook add --event PreToolUse --command "echo 'Running $TOOL'"
```

### HTTP Hook

```bash
rookie hook add --event PostToolUse --url "https://hooks.slack.com/..."
```

### LLM Hook

```bash
rookie hook add --event PreToolUse --prompt "Review this tool call for safety"
```

## Testing

```bash
rookie hook test --event PreToolUse --tool file_read
```
