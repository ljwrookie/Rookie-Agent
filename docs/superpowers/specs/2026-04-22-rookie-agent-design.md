# Rookie Agent 设计文档

> 全能型 AI Agent —— TypeScript 编排层 + Rust 计算引擎，通过 JSON-RPC 解耦通信
> 融合 Hermes Agent (NousResearch) 技能系统、Harness 执行能力、Claude Code 生产力体验

**日期**: 2026-04-22
**状态**: 已批准

---

## 1. 概述

Rookie Agent 是一个面向开发者的全能型 AI Agent，集代码理解、编辑、执行、工具编排、多模型调度于一体。

**核心定位**: 像 Claude Code 一样理解代码库并执行操作，像 Hermes Agent 一样拥有自改进技能系统，像 Harness 一样可靠执行复杂任务

**品牌理念**: "The agent that gets things done" —— 专注生产力，直接解决问题

**技术栈**: TypeScript（编排层）+ Rust（计算引擎），通过 JSON-RPC 2.0 解耦通信

**设计原则**:
- 传输层可插拔：Phase 1 用 Stdio JSON-RPC 快速跑通，后续可无痛切换到 NAPI-RS
- Rust 做计算密集型任务（AST、代码分析、知识图谱、全文索引），TS 做业务编排和交互
- 模块化设计，每个模块可独立使用和测试
- 兼容 agentskills.io 开放标准
- 工具优先：一切能力通过 Tool 暴露，Agent 通过选择和组合 Tool 完成任务

---

## 2. 架构

```
┌─────────────────────────────────────────────┐
│           TypeScript 编排层 (rookie-sdk)      │
│  编码助手 | 工具编排 | MCP | 多模型 | 多Agent  │
├─────────────────────────────────────────────┤
│         JSON-RPC 抽象传输层 (Transport)       │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Stdio    │  │ InProc   │  │ NAPI-RS   │  │ ← 可插拔
│  │ (Phase 1)│  │ (Phase 2)│  │ (Phase 3) │  │
│  └──────────┘  └──────────┘  └───────────┘  │
├─────────────────────────────────────────────┤
│           Rust 计算引擎 (rookie-core)         │
│  AST解析 | 代码分析 | 知识图谱 | 文件索引      │
└─────────────────────────────────────────────┘
```

**通信协议**: JSON-RPC 2.0，方法命名采用 `模块.方法` 格式

**分阶段传输策略**:
- Phase 1: Stdio JSON-RPC（Rust 独立进程，TS 子进程管理）
- Phase 2: InProc 传输（同进程，用于测试和嵌入）
- Phase 3: NAPI-RS（同进程调用，零序列化开销）

---

## 3. 项目结构

```
rookie/
├── crates/
│   ├── rookie-core/              # Rust 核心引擎
│   │   ├── src/
│   │   │   ├── lib.rs            # 库入口
│   │   │   ├── server.rs         # JSON-RPC server
│   │   │   ├── ast/              # AST 解析模块
│   │   │   │   ├── mod.rs
│   │   │   │   ├── engine.rs     # AstEngine
│   │   │   │   └── query.rs      # 查询模式匹配
│   │   │   ├── index/            # 文件索引模块
│   │   │   │   ├── mod.rs
│   │   │   │   ├── walker.rs     # 文件遍历
│   │   │   │   └── tantivy.rs    # 全文检索
│   │   │   ├── knowledge/        # 知识图谱模块
│   │   │   │   ├── mod.rs
│   │   │   │   └── graph.rs      # 图结构
│   │   │   └── symbol/           # 符号分析模块
│   │   │       ├── mod.rs
│   │   │       └── resolver.rs   # 符号解析
│   │   └── Cargo.toml
│   └── rookie-cli/               # Rust CLI 入口
│       ├── src/
│       │   └── main.rs           # 启动 JSON-RPC server
│       └── Cargo.toml
├── packages/
│   ├── rookie-sdk/               # TS SDK（核心）
│   │   ├── src/
│   │   │   ├── client.ts         # JSON-RPC client
│   │   │   ├── transport/        # 可插拔传输层
│   │   │   │   ├── types.ts      # Transport 接口
│   │   │   │   ├── stdio.ts      # Stdio 传输
│   │   │   │   ├── inproc.ts     # 进程内传输
│   │   │   │   └── napi.ts       # NAPI 传输（Phase 3）
│   │   │   ├── agent/            # Agent 框架
│   │   │   │   ├── types.ts      # Agent 接口定义
│   │   │   │   ├── coder.ts      # 编码助手 Agent
│   │   │   │   ├── reviewer.ts   # 代码审查 Agent
│   │   │   │   ├── explorer.ts   # 代码探索 Agent
│   │   │   │   ├── architect.ts  # 架构设计 Agent
│   │   │   │   ├── react.ts      # ReAct 循环
│   │   │   │   └── orchestrator.ts # 多Agent编排
│   │   │   ├── skills/           # Skill 工坊
│   │   │   │   ├── registry.ts   # Skill 注册表
│   │   │   │   ├── creator.ts    # Skill 创建
│   │   │   │   └── importer.ts   # Skill 导入/导出
│   │   │   ├── tools/            # 工具系统
│   │   │   │   ├── registry.ts   # 工具注册表
│   │   │   │   ├── builtin/      # 内置工具
│   │   │   │   │   ├── file.ts   # 文件读写
│   │   │   │   │   ├── shell.ts  # 终端执行
│   │   │   │   │   ├── git.ts    # Git 操作
│   │   │   │   │   ├── search.ts # 代码搜索
│   │   │   │   │   └── edit.ts   # 代码编辑
│   │   │   ├── mcp/              # MCP 协议
│   │   │   │   ├── client.ts     # MCP Client
│   │   │   │   └── server.ts     # MCP Server
│   │   │   ├── models/           # 多模型调度
│   │   │   │   ├── types.ts      # ModelProvider 接口
│   │   │   │   ├── router.ts     # 模型路由器
│   │   │   │   └── providers/    # 各模型实现
│   │   │   └── memory/           # 记忆系统
│   │   │       ├── store.ts      # 持久化存储
│   │   │       └── search.ts     # 记忆搜索
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── rookie-cli/               # TS CLI
│       ├── src/
│       │   ├── index.ts          # CLI 入口
│       │   ├── commands/         # CLI 命令
│       │   │   ├── chat.ts       # 交互式对话（默认）
│       │   │   ├── code.ts       # 编码助手模式
│       │   │   ├── review.ts     # 代码审查
│       │   │   ├── skill.ts      # Skill 管理
│       │   │   ├── index.ts      # 构建索引
│       │   │   ├── search.ts     # 搜索代码
│       │   │   └── repl.ts       # 交互式 REPL
│       │   └── repl.ts           # REPL 实现
│       ├── package.json
│       └── tsconfig.json
├── Cargo.toml                    # Rust workspace
├── package.json                  # PNPM workspace
├── pnpm-workspace.yaml
└── tsconfig.json                 # TS 基础配置
```

---

## 4. JSON-RPC 协议

### 4.1 基本格式

遵循 JSON-RPC 2.0 规范：

```typescript
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;        // 模块.方法 格式
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

### 4.2 Rust 引擎方法

#### AST 模块

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `ast.parse` | `{ path: string, content: string }` | `AstNode` | 解析文件 AST |
| `ast.search` | `{ path: string, pattern: string }` | `AstMatch[]` | S-expression 模式搜索 |
| `ast.dependencies` | `{ path: string }` | `Dependency[]` | 分析文件依赖 |

#### 索引模块

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `index.build` | `{ root: string }` | `{ fileCount: number }` | 构建项目文件索引 |
| `index.update` | `{ changes: FileChange[] }` | `void` | 增量更新索引 |
| `index.search` | `{ query: string, limit: number }` | `SearchResult[]` | 全文检索 |

#### 符号模块

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `symbol.resolve` | `{ path: string, line: number, column: number }` | `SymbolLocation \| null` | 符号定义跳转 |
| `symbol.references` | `{ path: string, line: number, column: number }` | `SymbolLocation[]` | 查找所有引用 |
| `symbol.outline` | `{ path: string }` | `SymbolOutline[]` | 文件符号大纲 |

#### 知识模块

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `knowledge.query` | `{ query: string, depth: number }` | `KnowledgeNode[]` | 知识图谱查询 |
| `knowledge.graph` | `{ root: string }` | `DependencyGraph` | 构建依赖图谱 |

### 4.3 通知（单向）

**TS → Rust**:

| 通知 | 参数 | 说明 |
|------|------|------|
| `file/change` | `{ path: string, content: string \| null }` | 文件变更 |
| `project/open` | `{ root: string }` | 项目打开 |

**Rust → TS**:

| 通知 | 参数 | 说明 |
|------|------|------|
| `index/progress` | `{ phase: string, current: number, total: number }` | 索引进度 |
| `analysis/diagnostic` | `{ path: string, diagnostics: Diagnostic[] }` | 实时诊断 |

---

## 5. Rust 计算引擎

### 5.1 AST 引擎

```rust
pub struct AstEngine {
    parsers: HashMap<Language, Parser>,     // 语言解析器池
    cache: LruCache<PathBuf, Tree>,         // AST 缓存
}

impl AstEngine {
    pub fn parse(&self, path: &Path, content: &str) -> Result<AstNode>;
    pub fn search(&self, tree: &Tree, pattern: &QueryPattern) -> Vec<AstMatch>;
    pub fn dependencies(&self, tree: &Tree) -> Vec<Dependency>;
}
```

- 基于 **tree-sitter**，支持 TS/JS/Python/Go/Rust 等主流语言
- LRU 缓存避免重复解析，增量更新只解析变更文件
- 查询使用 tree-sitter S-expression 模式匹配

### 5.2 文件索引

```rust
pub struct FileIndex {
    root: PathBuf,
    files: DashMap<PathBuf, FileInfo>,       // 并发安全文件映射
    content_index: TantivyIndex,             // 全文检索索引
    watcher: RecommendedWatcher,             // 文件变更监听
}

impl FileIndex {
    pub fn build(&self, root: &Path) -> Result<()>;
    pub fn update(&self, changes: &[FileChange]) -> Result<()>;
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchResult>;
}
```

- 基于 **ignore**（ripgrep 核心）遍历文件，尊重 .gitignore
- **tantivy** 全文检索索引
- **notify** 监听文件变更，增量更新

### 5.3 知识图谱

```rust
pub struct KnowledgeGraph {
    nodes: DashMap<String, KnowledgeNode>,    // 代码实体节点
    edges: Vec<(String, String, Relation)>,    // 实体关系
}

impl KnowledgeGraph {
    pub fn add_node(&self, node: KnowledgeNode);
    pub fn add_edge(&self, from: &str, to: &str, relation: Relation);
    pub fn query(&self, query: &str, depth: usize) -> Vec<KnowledgeNode>;
    pub fn build_from_project(&self, root: &Path) -> Result<()>;
}
```

### 5.4 符号分析引擎

```rust
pub struct SymbolEngine {
    resolver: SymbolResolver,
}

impl SymbolEngine {
    pub fn resolve(&self, path: &Path, line: usize, column: usize) -> Option<SymbolLocation>;
    pub fn references(&self, path: &Path, line: usize, column: usize) -> Vec<SymbolLocation>;
    pub fn outline(&self, path: &Path) -> Vec<SymbolOutline>;
}
```

### 5.5 JSON-RPC Server

```rust
pub struct RookieServer {
    ast: AstEngine,
    index: FileIndex,
    knowledge: KnowledgeGraph,
    symbol: SymbolEngine,
}

impl RookieServer {
    pub async fn serve(transport: Box<dyn Transport>) -> Result<()>;
    async fn handle_request(&self, method: &str, params: Value) -> Result<Value>;
}
```

- 基于 **jsonrpsee** 实现 JSON-RPC 2.0 server
- 传输层抽象为 trait，Phase 1 用 Stdio，后续可扩展

---

## 6. TypeScript 编排层

### 6.1 传输层

```typescript
export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  onNotification(handler: (notification: JsonRpcNotification) => void): void;
}
```

实现：
- **StdioTransport**: 启动 rookie-core 子进程，通过 stdin/stdout 通信
- **NapiTransport**（Phase 3）: 直接调用 .node native addon

### 6.2 Rookie Client

```typescript
export class RookieClient {
  private transport: Transport;

  get ast(): AstApi;
  get index(): IndexApi;
  get knowledge(): KnowledgeApi;
  get symbol(): SymbolApi;
}
```

### 6.3 Agent 框架

```typescript
export interface Agent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: Tool[];
  run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent>;
}

export interface AgentContext {
  client: RookieClient;       // Rust 引擎访问
  model: ModelProvider;       // LLM 调用
  memory: MemoryStore;        // 对话记忆
  tools: ToolRegistry;        // 工具注册表
}

export interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error';
  content: unknown;
}
```

执行模型: **ReAct 循环**（Reason-Action-Observation）

```
用户输入 → Agent.think() → 选择工具 → 执行 → 观察结果 → 继续/结束
```

### 6.4 内置 Agent 类型

#### CoderAgent —— 编码助手

```typescript
export class CoderAgent implements Agent {
  name = 'coder';
  description = 'A productive coding assistant that edits, explains, and refactors code';

  // 代码编辑（类似 Claude Code 的文件操作）
  async edit(request: EditRequest): Promise<EditResult>;

  // 代码解释
  async explain(target: string): Promise<Explanation>;

  // 代码重构
  async refactor(request: RefactorRequest): Promise<RefactorResult>;

  // 终端命令执行
  async execute(command: string): Promise<ExecutionResult>;
}
```

#### ReviewerAgent —— 代码审查

```typescript
export class ReviewerAgent implements Agent {
  name = 'reviewer';
  description = 'Reviews code for quality, security, and best practices';

  async review(diff: string): Promise<ReviewResult>;
  async reviewFile(path: string): Promise<ReviewResult>;
}
```

#### ExplorerAgent —— 代码探索

```typescript
export class ExplorerAgent implements Agent {
  name = 'explorer';
  description = 'Explores and understands large codebases';

  async findDefinition(symbol: string): Promise<Location[]>;
  async findUsage(symbol: string): Promise<Location[]>;
  async summarizeModule(path: string): Promise<ModuleSummary>;
}
```

#### ArchitectAgent —— 架构设计

```typescript
export class ArchitectAgent implements Agent {
  name = 'architect';
  description = 'Designs system architecture and plans implementations';

  async design(requirements: string): Promise<DesignDoc>;
  async plan(feature: string): Promise<ImplementationPlan>;
}
```

### 6.5 Skill 工坊

```typescript
export class SkillRegistry {
  private skills: Map<string, Skill>;

  register(skill: Skill): void;
  importFromUrl(url: string): Promise<Skill>;     // 兼容 agentskills.io
  exportSkill(name: string): Promise<string>;
  createFromTask(task: CompletedTask): Promise<Skill>;
}

export interface Skill {
  name: string;
  version: string;
  description: string;
  triggers: Trigger[];          // 触发条件
  tools: Tool[];                // Skill 使用的工具
  prompt: string;               // Skill 的系统提示
  examples: Example[];          // 示例
}
```

### 6.6 多模型调度

```typescript
export interface ModelProvider {
  name: string;
  chat(params: ChatParams): AsyncGenerator<ChatChunk>;
  embed(texts: string[]): Promise<number[][]>;
}

export class ModelRouter {
  private providers: Map<string, ModelProvider>;
  private strategy: RoutingStrategy;

  route(task: TaskType): ModelProvider;
  // 路由策略：
  // - 代码补全 → 快速本地模型
  // - 复杂推理 → 高能力云端模型
  // - Embedding → 专用 embedding 模型
  // - 简单分类 → 轻量模型
}
```

### 6.7 工具系统 & MCP

```typescript
export class ToolRegistry {
  private tools: Map<string, Tool>;

  register(tool: Tool): void;
  registerMcpServer(server: McpServerConfig): Promise<void>;
  invoke(name: string, params: Record<string, unknown>): Promise<ToolResult>;
}
```

内置工具（Claude Code 风格生产力工具）：

| 工具 | 功能 |
|------|------|
| `file_read` | 读取文件内容 |
| `file_write` | 写入/覆盖文件 |
| `file_edit` | 精准编辑文件（行级/块级） |
| `shell_execute` | 执行终端命令 |
| `git_status` | 查看 git 状态 |
| `git_diff` | 查看 diff |
| `git_commit` | 提交代码 |
| `search_code` | 代码搜索（全文 + 语义） |
| `search_ast` | AST 模式搜索 |
| `view_outline` | 查看文件符号大纲 |

MCP 集成:
- 作为 **MCP Client**: 连接外部 MCP 服务器（文件系统、数据库、浏览器等）
- 作为 **MCP Server**: 暴露 Rookie 自身能力给其他工具调用
- 工具发现: 自动发现 MCP 服务器提供的工具，注册到 ToolRegistry

### 6.8 记忆系统

```typescript
export class MemoryStore {
  // 持久化存储对话历史
  async save(sessionId: string, messages: Message[]): Promise<void>;

  // FTS5 全文搜索历史对话
  async search(query: string, limit: number): Promise<Message[]>;

  // 构建项目上下文记忆
  async buildProjectContext(projectRoot: string): Promise<ProjectContext>;
}
```

---

## 7. 多 Agent 协作

### 7.1 Agent 拓扑

```
                    ┌─────────────┐
                    │ Orchestrator│  ← 主控 Agent
                    │  (协调者)    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
     │  Coder    │  │  Reviewer │  │ Explorer  │  ← 专家 Agent
     │  (编码)   │  │  (审查)   │  │  (探索)   │
     └───────────┘  └───────────┘  └───────────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                     ┌─────▼─────┐
                     │ Architect │  ← 设计 Agent
                     │  (架构)   │
                     └───────────┘
```

### 7.2 编排器

```typescript
export class AgentOrchestrator {
  private agents: Map<string, Agent>;
  private client: RookieClient;

  async run(task: string, options: OrchestratorOptions): AsyncGenerator<OrchestrationEvent>;
}

export interface OrchestratorOptions {
  mode: 'sequential' | 'parallel' | 'adaptive';
  maxIterations: number;
  parallelism: number;
  onProgress?: (event: OrchestrationEvent) => void;
}
```

### 7.3 Agent 间通信

- **共享黑板**: 所有 Agent 读写同一个上下文黑板
- **消息传递**: Agent 之间通过消息队列异步通信
- **工具共享**: 所有 Agent 共享同一个 ToolRegistry

---

## 8. 错误处理 & 可观测性

```typescript
export class RookieError extends Error {
  constructor(
    public code: ErrorCode,           // ENGINE | NETWORK | MODEL | TOOL | AGENT
    public message: string,
    public recoverable: boolean,
    public retryable: boolean,
  ) {}
}

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  traceId: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}
```

---

## 9. 技术选型

| 层 | 组件 | 技术 |
|----|------|------|
| Rust AST | 多语言解析 | tree-sitter + tree-sitter-languages |
| Rust 索引 | 全文检索 | tantivy |
| Rust 知识 | 图存储 | 自研内存图结构（后续可接图数据库） |
| Rust 符号 | 符号分析 | tree-sitter + 自定义解析 |
| Rust 文件监听 | 文件变更 | notify |
| Rust JSON-RPC | 协议层 | jsonrpsee |
| Rust 并发 | 并发安全 | dashmap + crossbeam |
| TS 传输 | 进程通信 | node child_process |
| TS CLI | 命令行 | commander + ink (交互式) |
| TS 构建 | 打包 | tsup |
| TS 测试 | 单元测试 | vitest |
| Rust 测试 | 单元测试 | cargo test + proptest |
| 集成 | Monorepo | pnpm workspace + cargo workspace |

---

## 10. CLI 命令设计

```bash
# 基础命令
rookie                          # 启动交互式对话（默认模式）
rookie chat                     # 显式启动对话
rookie repl                     # 启动 REPL

# 编码助手（Claude Code 风格）
rookie code                     # 编码助手模式
rookie review <file>            # 代码审查
rookie explain <file>           # 解释代码
rookie edit <file>              # 编辑文件

# Skill 管理（Hermes 风格）
rookie skill create             # 从最近任务创建 Skill
rookie skill list               # 列出已安装的 Skills
rookie skill import <url>       # 导入 Skill（兼容 agentskills.io）
rookie skill export <name>      # 导出 Skill

# 系统命令
rookie model                    # 切换模型
rookie config                   # 配置管理
rookie index                    # 构建项目索引
rookie search <query>           # 搜索代码
rookie doctor                   # 诊断问题
rookie update                   # 更新到最新版本
```

---

## 11. 分阶段交付计划

### Phase 0: 基础骨架

**目标**: Rust JSON-RPC server + AST 解析 + Stdio 传输 + TS Client 可运行

- [ ] 初始化 Rust workspace + Cargo.toml
- [ ] 初始化 PNPM workspace + package.json
- [ ] 实现 rookie-core: JSON-RPC server（jsonrpsee + stdio）
- [ ] 实现 rookie-core: AST 引擎（tree-sitter 基础解析）
- [ ] 实现 rookie-cli (Rust): 启动 JSON-RPC server 的入口
- [ ] 实现 rookie-sdk: Transport 接口 + StdioTransport
- [ ] 实现 rookie-sdk: RookieClient + AstApi
- [ ] 实现 rookie-cli (TS): 基础 REPL
- [ ] 集成测试：TS 调用 Rust AST 解析

**交付物**: 可运行的 CLI，能解析代码文件 AST 并返回结果

### Phase 1: 编码助手核心

**目标**: 文件索引 + Agent 框架 + 内置工具 + 单模型集成

- [ ] rookie-core: 文件索引引擎（tantivy）
- [ ] rookie-core: 符号分析引擎
- [ ] rookie-sdk: IndexApi + SymbolApi
- [ ] rookie-sdk: Agent 框架（ReAct 循环）
- [ ] rookie-sdk: CoderAgent（编码助手模式）
- [ ] rookie-sdk: 内置工具（file_read, file_write, shell_execute, search_code）
- [ ] rookie-sdk: ModelProvider 接口 + OpenAI 实现
- [ ] rookie-sdk: MemoryStore（对话记忆）
- [ ] rookie-cli: code / review / explain 命令

**交付物**: 可进行代码编辑、解释、搜索的编码助手

### Phase 2: Skill 系统 + 知识图谱

**目标**: Skill 管理 + 知识图谱 + 代码理解增强

- [ ] rookie-core: 知识图谱引擎
- [ ] rookie-sdk: SkillRegistry（创建/导入/导出）
- [ ] rookie-sdk: ExplorerAgent（代码探索）
- [ ] 兼容 agentskills.io 标准
- [ ] 文件变更监听 + 增量索引更新
- [ ] 项目级代码理解（模块关系、依赖分析）

**交付物**: 支持 Skill 创建和分享，具备项目级代码理解能力

### Phase 3: 多 Agent 平台

**目标**: 多模型调度 + 多 Agent 协作 + MCP

- [ ] rookie-sdk: ModelRouter（多模型路由策略）
- [ ] rookie-sdk: AgentOrchestrator（多Agent编排）
- [ ] rookie-sdk: MCP Client + MCP Server
- [ ] 内置专家 Agent: Coder、Reviewer、Explorer、Architect
- [ ] Agent 间通信机制（共享黑板 + 消息传递）
- [ ] rookie-cli: Agent 管理命令

**交付物**: 全能型 Agent 平台，支持多模型多 Agent 协作

### Phase 4: 性能优化

**目标**: NAPI 传输层 + 性能优化

- [ ] NAPI-RS binding（rookie-core → .node addon）
- [ ] NapiTransport 实现
- [ ] 性能基准测试
- [ ] AST 缓存优化
- [ ] 知识图谱持久化
- [ ] 大型代码库压力测试

**交付物**: 生产级性能的 Agent 框架

---

## 12. 关键依赖版本

### Rust (Cargo.toml)

```toml
[dependencies]
tree-sitter = "0.24"
tree-sitter-typescript = "0.23"
tree-sitter-python = "0.23"
tree-sitter-go = "0.23"
tree-sitter-rust = "0.23"
tantivy = "0.22"
notify = "7"
ignore = "0.4"
jsonrpsee = { version = "0.24", features = ["server", "client"] }
dashmap = "6"
lru = "0.12"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
```

### TypeScript (package.json)

```json
{
  "dependencies": {
    "commander": "^12",
    "ink": "^5",
    "react": "^18",
    "openai": "^4"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "tsup": "^8",
    "vitest": "^2",
    "@types/node": "^22"
  }
}
```
