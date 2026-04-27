# Memory

## MemoryStore

```typescript
import { MemoryStore } from "@rookie/agent-sdk";

const store = new MemoryStore();
await store.save({ content: "Important decision", type: "decision" });
const results = await store.search("decision");
```

## UserModelManager

```typescript
import { UserModelManager, SimpleReflector } from "@rookie/agent-sdk";

const manager = new UserModelManager({
  storageDir: ".rookie/user-models",
  reflectionInterval: 20,
});

const model = await manager.getModel("user-1");
const { shouldReflect } = await manager.recordSession("user-1", messages);

if (shouldReflect) {
  const reflector = new SimpleReflector();
  const output = await reflector.run({ recentSessions, sessionCount });
  await manager.applyReflectorOutput("user-1", output);
}
```

## Context Integration

```typescript
const prompt = manager.mergeIntoSystemPrompt(
  "You are a helpful assistant.",
  model
);
```
