# Agents

## Built-in Agents

| Agent | Purpose |
|-------|---------|
| `CoderAgent` | Read, write, edit, test code |
| `ExplorerAgent` | Search, navigate, analyze codebase |
| `ReviewerAgent` | Diff review, quality checks |
| `ArchitectAgent` | System design, planning |
| `PlannerAgent` | Task decomposition |
| `EvaluatorAgent` | Rubric-based evaluation |

## Usage

```typescript
import { CoderAgent, AgentOrchestrator } from "@rookie/agent-sdk";

const agent = new CoderAgent();
const orchestrator = new AgentOrchestrator();

orchestrator.register({
  name: "coder",
  agent,
  priority: 1,
  triggers: [{ type: "file_pattern", pattern: "*.ts" }],
});

for await (const event of orchestrator.runSingle("coder", input, context)) {
  console.log(event);
}
```

## GAN Mode

```typescript
const result = await orchestrator.runGAN(task, context, {
  maxRounds: 3,
});
```
