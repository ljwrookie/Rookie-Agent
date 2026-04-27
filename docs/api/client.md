# RookieClient

Core client for communicating with the Rust engine.

## Constructor

```typescript
import { RookieClient, StdioTransport } from "@rookie/agent-sdk";

const transport = new StdioTransport({ command: "rookie-core" });
const client = new RookieClient(transport);
```

## APIs

### AST

```typescript
const ast = await client.ast.parse("code", "typescript");
```

### Index

```typescript
await client.index.build("./src");
const results = await client.index.search("query", 10);
```

### Symbol

```typescript
const outline = await client.symbol.outline("file.ts");
```

### Knowledge

```typescript
const graph = await client.knowledge.query("entity");
```

## Events

```typescript
client.onLog((record) => {
  console.log(record.level, record.msg);
});
```
