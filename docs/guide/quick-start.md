# Quick Start

Get Rookie Agent running in under 5 minutes.

## Prerequisites

- Node.js 20+ (22 recommended)
- Rust stable (optional, for native performance)
- Git

## Installation

```bash
npm install -g @rookie-agent/cli
```

Or use npx:

```bash
npx @rookie-agent/cli --help
```

## First Steps

### 1. Initialize a Session

```bash
rookie init --task "Add user authentication to the API"
```

This creates:
- `.rookie/progress.md` — tracked progress
- `.rookie/features.json` — feature checklist

### 2. Start Coding

```bash
rookie code
```

Opens the TUI coding assistant.

### 3. Verify Progress

```bash
rookie verify
```

Runs all feature verification commands.

## Next Steps

- Learn about [Skills](/guide/skills)
- Configure [Permissions](/guide/permissions)
- Set up [Hooks](/guide/hooks)
