# Tools

## Built-in Tools

| Tool | Description |
|------|-------------|
| `fileReadTool` | Read file contents |
| `fileWriteTool` | Write file contents |
| `fileEditTool` | Edit with unified diff |
| `shellExecuteTool` | Execute shell commands |
| `searchCodeTool` | Search codebase |
| `gitStatusTool` | Git status |
| `gitDiffTool` | Git diff |
| `gitCommitTool` | Git commit |
| `gitBranchTool` | Git branch |
| `gitLogTool` | Git log |
| `globFilesTool` | Glob file search |
| `grepFilesTool` | Grep file search |
| `webFetchTool` | Fetch web pages |
| `webSearchTool` | Web search |
| `todoWriteTool` | Manage todos |
| `notebookReadTool` | Read Jupyter notebooks |
| `notebookEditTool` | Edit Jupyter notebooks |

## Registry

```typescript
import { ToolRegistry } from "@rookie/agent-sdk";

const registry = new ToolRegistry();
registry.register(fileReadTool);

const result = await registry.invoke("file_read", { path: "README.md" });
```

## Custom Tools

```typescript
const myTool = {
  name: "my_tool",
  description: "Does something",
  parameters: [...],
  execute: async (params) => "result",
};
```
