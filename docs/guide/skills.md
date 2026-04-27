# Skills

Skills are reusable, domain-specific capabilities stored in `.rookie/skills/`.

## Structure

```
.rookie/skills/
  typescript/
    SKILL.md
  react/
    SKILL.md
```

## SKILL.md Format

```markdown
---
name: typescript
triggers:
  - file_pattern: "*.ts"
  - command: "/ts"
---

# TypeScript Skill

## Rules
- Prefer `interface` over `type` for object shapes
- Use strict null checks
- ...
```

## Commands

```bash
rookie skill list
rookie skill import <url>
rookie skill export <name>
```

## Auto-creation

After 5+ tool calls in a task, Rookie may propose a new skill. Confirm to save it.
