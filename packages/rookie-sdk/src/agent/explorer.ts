import { Agent, AgentInput, AgentContext, AgentEvent } from "./types.js";

export interface FileInfo {
  path: string;
  language: string;
  symbols: Array<{
    name: string;
    kind: string;
    line: number;
  }>;
  imports: string[];
  exports: string[];
}

export interface ModuleGraph {
  nodes: Map<string, FileInfo>;
  edges: Array<{ from: string; to: string; type: string }>;
}

export class ExplorerAgent implements Agent {
  name = "explorer";
  description = "Explores and understands codebase structure";
  systemPrompt = `You are an expert code explorer. Your job is to understand codebase structure, find relevant files, and analyze dependencies.

Use the available tools to:
1. List directory structure
2. Read key files
3. Search for symbols and patterns
4. Analyze imports and exports

Always provide concise, actionable insights.`;
  tools = ["file_read", "search_code", "shell_execute"];

  async *run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent> {
    const { message } = input;

    yield { type: "thinking", content: `Exploring codebase for: ${message}` };

    // Determine exploration strategy based on message
    if (message.includes("structure") || message.includes("overview")) {
      yield* this.exploreStructure(context);
    } else if (message.includes("dependency") || message.includes("import")) {
      yield* this.exploreDependencies(context);
    } else if (message.includes("symbol") || message.includes("function") || message.includes("class")) {
      yield* this.findSymbols(message, context);
    } else {
      yield* this.generalExplore(message, context);
    }
  }

  private async *exploreStructure(context: AgentContext): AsyncGenerator<AgentEvent> {
    const { client, tools } = context;

    yield { type: "thinking", content: "Reading project structure..." };

    try {
      // Use shell to get directory structure
      const result = await tools.invoke("shell_execute", {
        command: "find . -type f -name '*.ts' -o -name '*.js' -o -name '*.rs' -o -name '*.py' | head -50",
      }) as string;

      const files = result.split("\n").filter((f: string) => f.trim());

      yield { type: "response", content: `Found ${files.length} source files` };

      // Get outlines for key files
      const keyFiles = files.slice(0, 10);
      for (const file of keyFiles) {
        try {
          const content = await tools.invoke("file_read", { path: file }) as string;
          const outline = await client.symbol.outline(file, content);
          yield {
            type: "response",
            content: `${file}: ${outline.outlines.length} symbols`,
          };
        } catch {
          // Skip files that can't be parsed
        }
      }
    } catch (e) {
      yield { type: "error", error: `Failed to explore structure: ${e}` };
    }
  }

  private async *exploreDependencies(context: AgentContext): AsyncGenerator<AgentEvent> {
    const { tools } = context;

    yield { type: "thinking", content: "Analyzing dependencies..." };

    try {
      // Check package.json, Cargo.toml, etc.
      const packageFiles = ["package.json", "Cargo.toml", "pyproject.toml", "go.mod"];
      for (const pkg of packageFiles) {
        try {
          await tools.invoke("file_read", { path: pkg });
          yield { type: "response", content: `Found ${pkg}` };
        } catch {
          // File doesn't exist
        }
      }
    } catch (e) {
      yield { type: "error", error: `Failed to explore dependencies: ${e}` };
    }
  }

  private async *findSymbols(query: string, context: AgentContext): AsyncGenerator<AgentEvent> {
    const { tools } = context;

    yield { type: "thinking", content: `Searching for symbols matching: ${query}` };

    try {
      // Use AST search to find symbols
      const searchResult = await tools.invoke("search_code", { query, limit: 10 }) as string;
      yield { type: "response", content: searchResult };
    } catch (e) {
      yield { type: "error", error: `Search failed: ${e}` };
    }
  }

  private async *generalExplore(message: string, context: AgentContext): AsyncGenerator<AgentEvent> {
    const { tools } = context;

    yield { type: "thinking", content: `Exploring: ${message}` };

    try {
      // General file search
      const result = await tools.invoke("shell_execute", {
        command: `find . -type f | grep -i "${message.replace(/"/g, "")}" | head -20`,
      }) as string;

      if (result.trim()) {
        yield { type: "response", content: `Matching files:\n${result}` };
      } else {
        yield { type: "response", content: "No matching files found" };
      }
    } catch (e) {
      yield { type: "error", error: `Exploration failed: ${e}` };
    }
  }
}
