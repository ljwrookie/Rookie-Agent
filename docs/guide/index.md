# Rookie Agent

AI-powered software engineering assistant that learns and improves over time.

## Features

- **Intelligent Code Assistance**: Powered by state-of-the-art LLMs with ReAct-based reasoning
- **Self-Improving Skills**: Automatically learns from successful task patterns
- **Multi-Platform**: Works in terminal, Feishu/Lark, and other platforms
- **Persistent Memory**: Three-layer memory system (episodic, semantic, user model)
- **Extensible Tools**: Rich set of built-in tools with easy extension mechanism
- **Evaluation Harness**: Built-in benchmarking for continuous improvement

## Quick Start

```bash
# Install globally
npm install -g @rookie-agent/cli

# Initialize a project
rookie init

# Start a session
rookie
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Rookie CLI                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Skills    │  │   Memory    │  │   Scheduler/Cron    │  │
│  │  (SKILL.md) │  │  (SQLite)   │  │   (node-cron)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                     SDK Core                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Agents    │  │    Tools    │  │   Orchestrator      │  │
│  │  (ReAct)    │  │  (Builtin)  │  │  (Planner/Gen/Eval) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                     Transport Layer                          │
│              (stdio / NAPI-RS / WebSocket)                   │
└─────────────────────────────────────────────────────────────┘
```

## Documentation Structure

- **Guide**: Learn how to use Rookie Agent effectively
- **API**: Reference documentation for SDK and CLI
- **Examples**: End-to-end examples for common workflows

## Contributing

See the [Contributing Guide](./contributing) for details on how to contribute to Rookie Agent.
