# Memory

Rookie Agent has a three-layer memory system.

## Layers

| Layer | Storage | Purpose |
|-------|---------|---------|
| Episodic | SQLite FTS5 | Searchable session history |
| Semantic | Vector DB | Similarity-based recall |
| User Model | JSON | Personalized preferences |

## User Model

Stores your preferences, tech stack, communication style, and goals.

```bash
rookie memory show
rookie memory show --format json
```

## Reflector

Every 20 sessions, a Reflector agent analyzes your conversations to update the user model automatically.

## Manual Updates

You can also provide feedback to shape the model:

```bash
rookie memory feedback "I prefer concise code examples"
```
