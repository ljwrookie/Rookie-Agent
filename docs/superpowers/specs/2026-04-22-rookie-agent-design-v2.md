# Rookie Agent 设计文档 v2

> 全能型 AI Agent —— TypeScript 编排层 + Rust 计算引擎，通过 JSON-RPC 解耦通信
> 融合 Harness 长任务连续性、Hermes Agent 自改进技能系统、Claude Code 生产力体验

**日期**: 2026-04-22
**版本**: v2.0（基于 Harness / Hermes / Claude Code 调研更新）
**状态**: 待审批

---

## 变更摘要（v1 → v2）

| 变更项 | 来源 | 说明 |
|--------|------|------|
| **新增 §6A: Session Harness** | Anthropic Harness | 跨 context window 连续性机制：progress 文件、feature list、双阶段提示 |
| **新增 §6B: Hooks 生命周期** | Claude Code | 工具调用前后拦截、session 生命周期、可扩展行为链 |
| **新增 §6C: 项目指令系统** | Claude Code | ROOKIE.md 分层指令 + Auto Memory |
| **新增 §6D: 权限与安全** | Claude Code | 工具权限、命令沙箱、危险操作检测 |
| **重写 §6.5: Skill 工坊** | Hermes + Claude Code | SKILL.md 文件格式、自改进学习循环、上下文注入、Subagent 执行 |
| **重写 §6.8: 记忆系统** | Hermes | Agent-curated memory + FTS5 + 用户建模 |
| **更新 §6.3: Agent 框架** | Claude Code Agent SDK | Function Calling 优先 + 文本解析回退；Streaming 支持 |
| **更新 §6.6: 多模型调度** | Hermes | 200+ 模型支持（OpenRouter）；Streaming 作为默认 |
| **更新 §7: 多 Agent 协作** | Claude Code Subagent | Subagent 委派模式、skill preload、context fork |
| **更新 §10: CLI 命令** | 三者综合 | 新增 /schedule、/hook、/doctor、管道支持 |
| **更新 §11: 分阶段计划** | - | 重排优先级，P0 打通 LLM 端到端 |

---

## 1. 概述

Rookie Agent 是一个面向开发者的全能型 AI Agent，集代码理解、编辑、执行、工具编排、多模型调度于一体。

**核心定位**: 像 Claude Code 一样理解代码库并执行操作，像 Hermes Agent 一样拥有自改进技能系统，像 Harness 一样可靠执行长时间复杂任务

**品牌理念**: "The agent that gets things done" —— 专注生产力，直接解决问题

**技术栈**: TypeScript（编排层）+ Rust（计算引擎），通过 JSON-RPC 2.0 解耦通信

**设计原则**:
- 传输层可插拔：Phase 1 用 Stdio JSON-RPC 快速跑通，后续可无痛切换到 NAPI-RS
- Rust 做计算密集型任务（AST、代码分析、知识图谱、全文索引），TS 做业务编排和交互
- 模块化设计，每个模块可独立使用和测试
- 兼容 agentskills.io 开放标准
- 工具优先：一切能力通过 Tool 暴露，Agent 通过选择和组合 Tool 完成任务
- **Hooks 优先（新增）**: 一切可扩展行为通过 Hooks 暴露，用户无需修改源码即可定制
- **进度可恢复（新增）**: 长任务通过 progress 文件 + git history 实现跨 session 恢复
- **闭环学习（新增）**: 完成任务后自动评估是否值得创建/改进 Skill

---

## 2. 架构

```
┌─────────────────────────────────────────────────────────┐
│              TypeScript 编排层 (rookie-sdk)               │
│  Session Harness | Hooks | Agents | Skills | Tools | MCP │
├─────────────────────────────────────────────────────────┤
│    项目指令 (ROOKIE.md)  |  权限控制 (Permissions)         │
├─────────────────────────────────────────────────────────┤
│           JSON-RPC 抽象传输层 (Transport)                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐              │
│  │ Stdio    │  │ InProc   │  │ NAPI-RS   │  ← 可插拔     │
│  │ (Phase 1)│  │ (Phase 2)│  │ (Phase 4) │              │
│  └──────────┘  └──────────┘  └───────────┘              │
├─────────────────────────────────────────────────────────┤
│              Rust 计算引擎 (rookie-core)                  │
│  AST解析 | 代码分析 | 知识图谱 | 文件索引 | 符号分析        │
└─────────────────────────────────────────────────────────┘
```

**通信协议**: JSON-RPC 2.0，方法命名采用 `模块.方法` 格式

**分阶段传输策略**:
- Phase 1: Stdio JSON-RPC（Rust 独立进程，TS 子进程管理）
- Phase 2: InProc 传输（同进程，用于测试和嵌入）
- Phase 4: NAPI-RS（同进程调用，零序列化开销）

---

## 3. 项目结构

```
rookie/
├── crates/
│   ├── rookie-core/              # Rust 核心引擎
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── server.rs         # JSON-RPC server（单一分发逻辑）
│   │   │   ├── ast/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── engine.rs
│   │   │   │   └── query.rs
│   │   │   ├── index/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── walker.rs
│   │   │   │   ├── tantivy.rs
│   │   │   │   └── watcher.rs
│   │   │   ├── knowledge/
│   │   │   │   ├── mod.rs
│   │   │   │   └── graph.rs
│   │   │   └── symbol/
│   │   │       ├── mod.rs
│   │   │       └── resolver.rs
│   │   └── Cargo.toml
│   └── rookie-cli/
│       ├── src/main.rs
│       └── Cargo.toml
├── packages/
│   ├── rookie-sdk/               # TS SDK（核心）
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── config.ts
│   │   │   ├── transport/
│   │   │   │   ├── types.ts
│   │   │   │   ├── stdio.ts
│   │   │   │   └── inproc.ts
│   │   │   ├── agent/
│   │   │   │   ├── types.ts
│   │   │   │   ├── coder.ts
│   │   │   │   ├── reviewer.ts
│   │   │   │   ├── explorer.ts
│   │   │   │   ├── architect.ts
│   │   │   │   ├── react.ts      # ReAct（Function Calling 优先）
│   │   │   │   └── orchestrator.ts
│   │   │   ├── harness/          # 🆕 Session Harness（来自 Harness）
│   │   │   │   ├── session.ts
│   │   │   │   ├── progress.ts
│   │   │   │   ├── features.ts
│   │   │   │   └── types.ts
│   │   │   ├── hooks/            # 🆕 Hooks 生命周期（来自 Claude Code）
│   │   │   │   ├── registry.ts
│   │   │   │   ├── executor.ts
│   │   │   │   └── types.ts
│   │   │   ├── instructions/     # 🆕 项目指令（来自 Claude Code）
│   │   │   │   ├── loader.ts
│   │   │   │   ├── auto-memory.ts
│   │   │   │   └── types.ts
│   │   │   ├── permissions/      # 🆕 权限控制（来自 Claude Code）
│   │   │   │   ├── manager.ts
│   │   │   │   ├── sandbox.ts
│   │   │   │   └── types.ts
│   │   │   ├── skills/           # Skill 工坊（重写）
│   │   │   │   ├── registry.ts
│   │   │   │   ├── loader.ts     # SKILL.md 解析器
│   │   │   │   ├── creator.ts
│   │   │   │   ├── learner.ts    # 🆕 自改进学习循环
│   │   │   │   ├── importer.ts
│   │   │   │   └── types.ts
│   │   │   ├── tools/
│   │   │   │   ├── registry.ts
│   │   │   │   └── builtin/
│   │   │   │       ├── file.ts
│   │   │   │       ├── edit.ts
│   │   │   │       ├── shell.ts
│   │   │   │       ├── git.ts
│   │   │   │       └── search.ts
│   │   │   ├── mcp/
│   │   │   │   ├── client.ts
│   │   │   │   ├── server.ts
│   │   │   │   └── types.ts
│   │   │   ├── models/
│   │   │   │   ├── types.ts
│   │   │   │   ├── router.ts
│   │   │   │   └── providers/
│   │   │   │       ├── openai.ts
│   │   │   │       ├── anthropic.ts   # 🆕
│   │   │   │       └── openrouter.ts  # 🆕
│   │   │   └── memory/           # 记忆系统（重写）
│   │   │       ├── store.ts      # SQLite 持久化
│   │   │       ├── curated.ts    # 🆕 Agent-curated memory
│   │   │       ├── search.ts     # FTS5 全文搜索
│   │   │       └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── rookie-cli/
│       ├── src/
│       │   ├── index.ts
│       │   ├── commands/
│       │   │   ├── code.ts
│       │   │   └── ...
│       │   ├── repl.ts
│       │   └── tui/
│       │       ├── app.tsx
│       │       └── components/
│       ├── package.json
│       └── tsconfig.json
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## 4. JSON-RPC 协议

（保持 v1 不变，参见原文 §4）

---

## 5. Rust 计算引擎

（保持 v1 不变，参见原文 §5）

**实现修正（v2 新增约束）**:

1. **server.rs 只保留一套分发逻辑**：要么使用 jsonrpsee 宏的 trait 分发，要么手写 `handle_request_line`，不能两者并存
2. **`symbol.outline` 应由 Rust 端自行读取文件**：接口参数改为 `{ path: string }`（不需要传 content）
3. **`FileInfo` 类型统一**：walker.rs 和 tantivy.rs 共享同一个 `FileInfo` 定义，移到 `index/mod.rs`

---

## 6. TypeScript 编排层

### 6.1 传输层

（保持 v1 不变）

### 6.2 Rookie Client

（保持 v1 不变）

### 6.3 Agent 框架（v2 更新）

```typescript
export interface Agent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: Tool[];
  // v2: 支持 streaming 输出
  run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent>;
}

export interface AgentContext {
  client: RookieClient;
  model: ModelProvider;
  memory: MemoryStore;
  tools: ToolRegistry;
  hooks: HookRegistry;        // 🆕 hooks 访问
  harness: SessionHarness;    // 🆕 session 连续性
  instructions: ProjectInstructions;  // 🆕 项目指令
  permissions: PermissionManager;     // 🆕 权限控制
}

// v2: 更细粒度的事件类型
export type AgentEvent =
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: unknown; duration: number }
  | { type: 'response'; content: string; done: boolean }  // done=false → streaming chunk
  | { type: 'error'; error: RookieError }
  | { type: 'checkpoint'; progress: ProgressState }        // 🆕 来自 Harness
  | { type: 'skill_invoked'; skill: string }               // 🆕
  | { type: 'hook_fired'; hook: string; event: HookEvent } // 🆕
```

**执行模型（v2 更新）**: Function Calling 优先 + 文本解析回退

```
用户输入
  → 加载 ROOKIE.md 指令
  → 加载 Session Harness 状态
  → Agent.think()
  → LLM 返回 function call（优先）或文本中的 Action（回退）
  → 触发 PreToolUse hook
  → 权限检查
  → 执行工具
  → 触发 PostToolUse hook
  → 观察结果
  → 继续/检查点/结束
```

### 6.4 内置 Agent 类型

（保持 v1 不变：CoderAgent、ReviewerAgent、ExplorerAgent、ArchitectAgent）

新增约束：
- 每个 Agent 的 `run()` 必须是 **AsyncGenerator**，支持 streaming
- 每个 Agent 必须通过 `context.permissions` 检查工具权限
- CoderAgent 的 `edit()` 必须在编辑后触发 `PostToolUse` hook

---

### 6A. Session Harness（🆕 来自 Anthropic Harness）

> **核心洞察**: 长时间 agent 任务（>30 分钟、跨多个 context window）需要专门的连续性机制。
> Agent 不是无状态的——它需要知道"我做到哪了"、"还剩什么没做"、"上次做的结果怎样"。

#### 6A.1 概念模型

```
┌────────────────────────────────────────────────────────┐
│                    Session Harness                      │
│                                                        │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Initializer │    │ Feature List │    │ Progress  │ │
│  │ Agent       │───▶│ (JSON)       │───▶│ File      │ │
│  │ (第一个CW)  │    │ 可验证特性列表 │    │ 当前状态   │ │
│  └─────────────┘    └──────────────┘    └───────────┘ │
│         │                  │                  │        │
│         ▼                  ▼                  ▼        │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ Coding      │    │ Verification │    │ Git       │ │
│  │ Agent       │◀──▶│ Loop         │◀──▶│ History   │ │
│  │ (后续CW)    │    │ 自动化测试    │    │ 恢复上下文 │ │
│  └─────────────┘    └──────────────┘    └───────────┘ │
└────────────────────────────────────────────────────────┘
```

**CW = Context Window（上下文窗口）**

#### 6A.2 接口设计

```typescript
export interface SessionHarness {
  /**
   * 第一个 context window：分解任务，创建 feature list，初始化环境
   * 对应 Harness 的 "Initializer Agent" 阶段
   */
  initialize(task: string, options: InitOptions): Promise<SessionState>;

  /**
   * 后续 context window：读取 progress + git log 恢复状态
   * 对应 Harness 的 "Coding Agent" 阶段
   */
  resume(sessionId: string): Promise<SessionState>;

  /**
   * 保存进度检查点（每个 feature 完成后调用）
   * git commit + 更新 progress 文件
   */
  checkpoint(state: CheckpointData): Promise<void>;

  /**
   * 验证 feature 是否通过（运行测试、lint、类型检查等）
   */
  verify(feature: Feature): Promise<VerificationResult>;
}

export interface InitOptions {
  projectRoot: string;
  progressFile?: string;    // 默认 .rookie/progress.md
  featureListFile?: string; // 默认 .rookie/features.json
  verifyCommand?: string;   // 验证命令，如 "npm test"
  maxFeaturesPerSession?: number; // 每个 session 最多完成多少特性
}

export interface SessionState {
  sessionId: string;
  phase: 'initializer' | 'coding';
  totalFeatures: number;
  completedFeatures: number;
  currentFeature: Feature | null;
  failedFeatures: Feature[];
  progressSummary: string;     // 从 progress 文件解析
  gitLogSummary: string;       // 最近的 git 提交摘要
}

export interface Feature {
  id: string;
  description: string;
  verifyCommand?: string;
  status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'skipped';
  attempts: number;
  lastError?: string;
}

export interface CheckpointData {
  feature: Feature;
  commitMessage: string;
  progressUpdate: string;
}

export interface VerificationResult {
  passed: boolean;
  output: string;
  duration: number;
}
```

#### 6A.3 Progress 文件格式

```markdown
# Rookie Progress: <task-name>

## 任务描述
<原始任务描述>

## 环境
- 项目类型: TypeScript + Rust monorepo
- 包管理器: pnpm
- 构建命令: pnpm build
- 测试命令: pnpm test

## 已完成
- [x] Feature 1: 初始化项目结构 (session-001, 2026-04-22T10:00:00)
- [x] Feature 2: 实现 AST 解析引擎 (session-001, 2026-04-22T10:15:00)

## 进行中
- [ ] Feature 3: 实现文件索引

## 待完成
- [ ] Feature 4: 实现符号分析
- [ ] Feature 5: 集成测试

## 已知问题
- tantivy 0.22 在 ARM64 上编译慢，考虑升级到 0.23

## 上次会话摘要
Session session-002 (2026-04-22T14:00:00):
- 完成了 Feature 2
- 发现 tree-sitter 需要 language binding 预编译
- 下一步：开始 Feature 3
```

#### 6A.4 Feature List 格式

```json
{
  "task": "实现 Rookie Agent 核心功能",
  "created": "2026-04-22T10:00:00Z",
  "features": [
    {
      "id": "f001",
      "description": "初始化 Rust workspace + Cargo.toml",
      "verify": "cargo check",
      "status": "passed",
      "attempts": 1
    },
    {
      "id": "f002",
      "description": "实现 AST 引擎基础解析",
      "verify": "cargo test -p rookie-core -- ast",
      "status": "passed",
      "attempts": 2
    },
    {
      "id": "f003",
      "description": "实现文件索引",
      "verify": "cargo test -p rookie-core -- index",
      "status": "in_progress",
      "attempts": 0
    }
  ]
}
```

#### 6A.5 双阶段提示策略

**Initializer Agent 提示**（第一个 context window）:
```
你是任务初始化专家。你的工作是：
1. 理解任务需求
2. 分析项目结构和技术栈
3. 将任务分解为 50-200 个可独立验证的小特性
4. 为每个特性编写验证命令
5. 创建 progress 文件和 feature list
6. 提交初始化 commit

不要开始编码。只做规划和分解。
```

**Coding Agent 提示**（后续 context window）:
```
你是编码执行专家。会话开始时：
1. 读取 .rookie/progress.md 了解当前状态
2. 读取最近 20 条 git log 了解已完成的工作
3. 从 .rookie/features.json 中找到下一个 pending 特性
4. 实现该特性
5. 运行验证命令确认通过
6. 提交代码并更新 progress

每次只专注一个特性。完成后自动开始下一个。
如果某个特性连续失败 3 次，标记为 skipped 并继续。
```


---

### 6B. Hooks 生命周期系统（🆕 来自 Claude Code）

> **核心洞察**: 用户需要在不修改 agent 源码的情况下扩展行为。
> "每次编辑文件后自动格式化"、"commit 前自动 lint" —— 这些都是 Hooks。

#### 6B.1 Hook 事件类型

```typescript
export type HookEvent =
  | 'PreToolUse'        // 工具调用前（可阻止、修改参数）
  | 'PostToolUse'       // 工具调用后（可修改结果、触发后续动作）
  | 'SessionStart'      // session 开始
  | 'SessionEnd'        // session 结束
  | 'UserPromptSubmit'  // 用户输入提交后
  | 'Stop'              // agent 停止前
  | 'PreCheckpoint'     // 检查点保存前（与 Harness 联动）
  | 'PostCheckpoint';   // 检查点保存后
```

#### 6B.2 Hook 配置

```typescript
export interface HookConfig {
  event: HookEvent;
  matcher?: string;           // 工具名匹配 pattern（仅 *ToolUse 事件）
  command?: string;           // Shell 命令
  url?: string;               // HTTP webhook
  prompt?: string;            // LLM prompt
  timeout?: number;           // 超时（ms），默认 30000
  blocking?: boolean;         // 是否阻塞等待，默认 true
  canReject?: boolean;        // 是否可以阻止原操作（仅 Pre* 事件）
}
```

#### 6B.3 Hook 配置文件（settings.json）

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "file_write",
        "command": "prettier --write $ROOKIE_TOOL_INPUT_PATH"
      },
      {
        "matcher": "file_edit",
        "command": "eslint --fix $ROOKIE_TOOL_INPUT_PATH"
      }
    ],
    "PreToolUse": [
      {
        "matcher": "git_commit",
        "command": "npm run lint && npm test",
        "canReject": true
      }
    ],
    "SessionStart": [
      {
        "command": "echo Session started >> .rookie/sessions.log"
      }
    ]
  }
}
```

#### 6B.4 Hook 环境变量

| 变量 | 说明 |
|------|------|
| `ROOKIE_SESSION_ID` | 当前 session ID |
| `ROOKIE_TOOL_NAME` | 工具名称 |
| `ROOKIE_TOOL_INPUT_*` | 工具输入参数（大写 key） |
| `ROOKIE_TOOL_OUTPUT` | 工具输出（仅 PostToolUse） |
| `ROOKIE_PROJECT_ROOT` | 项目根目录 |
| `ROOKIE_HOOK_EVENT` | 事件类型 |

#### 6B.5 HookRegistry 接口

```typescript
export class HookRegistry {
  register(config: HookConfig): void;
  loadFromSettings(settingsPath: string): void;
  async fire(event: HookEvent, context: HookContext): Promise<HookResult[]>;
}

export interface HookResult {
  hook: HookConfig;
  success: boolean;
  output?: string;
  rejected?: boolean;
  duration: number;
}
```

---

### 6C. 项目指令系统（🆕 来自 Claude Code CLAUDE.md）

> **核心洞察**: Agent 需要理解项目的规范、偏好和上下文。

#### 6C.1 ROOKIE.md 分层加载

| 层级 | 路径 | 作用域 |
|------|------|--------|
| 全局 | `~/.rookie/ROOKIE.md` | 所有项目 |
| 项目 | `<project>/.rookie/ROOKIE.md` | 当前项目 |
| 子目录 | `<dir>/.rookie/ROOKIE.md` | 特定目录 |
| 会话 | 用户输入 | 当前会话 |

**合并规则**: 全局 → 项目 → 子目录 → 会话，后者覆盖前者的同名规则

#### 6C.2 Auto Memory

```typescript
export class AutoMemory {
  async evaluate(event: AgentEvent): Promise<MemoryCandidate | null>;
  async persist(candidate: MemoryCandidate): Promise<void>;
}

export interface MemoryCandidate {
  type: 'build_command' | 'debug_tip' | 'env_issue' | 'api_pattern' | 'convention';
  content: string;
  confidence: number;
  source: string;
}
```

---

### 6D. 权限与安全控制（🆕 来自 Claude Code）

#### 6D.1 权限模型

```typescript
export interface PermissionRule {
  tool: string;
  args?: string;
  action: 'allow' | 'deny' | 'ask';
}

export class PermissionManager {
  private rules: PermissionRule[];
  check(toolName: string, params: Record<string, unknown>): 'allow' | 'deny' | 'ask';
  loadFromSettings(settingsPath: string): void;
}
```

#### 6D.2 默认权限规则

- **allow**: file_read, search_code, search_ast, view_outline, git_status, git_diff
- **ask**: file_write, file_edit, git_commit, shell_execute(npm/pnpm/cargo)
- **deny**: shell_execute(rm -rf, sudo, 管道下载执行)

#### 6D.3 Shell 沙箱

```typescript
export interface SandboxConfig {
  timeout: number;            // 默认 30000ms
  maxOutputSize: number;      // 默认 1MB
  allowedCommands?: string[];
  deniedPatterns: RegExp[];
  cwd: string;
  env?: Record<string, string>;
}
```

---

### 6.5 Skill 工坊（v2 重写，融合 Hermes + Claude Code）

#### 6.5.1 SKILL.md 文件格式

```yaml
---
name: fix-issue
description: Fix a GitHub issue by number
disable-model-invocation: false
user-invocable: true
allowed-tools: shell_execute file_read file_write file_edit git_commit
context: inline       # inline | fork（fork = 在 subagent 中执行）
agent: Coder          # context=fork 时使用的 agent 类型
model: inherit
---

Fix GitHub issue $ARGUMENTS following our coding standards.

## 环境信息
- Git branch: !`git branch --show-current`
- Changed files: !`git diff --name-only`

## 步骤
1. Read the issue description
2. Implement the fix
3. Write tests
4. Run verification
5. Create a commit
```

#### 6.5.2 Skill 注册表

```typescript
export class SkillRegistry {
  private skills: Map<string, Skill>;
  private watcher: FSWatcher;

  loadFromDirectory(dir: string): void;
  watchForChanges(): void;
  register(skill: Skill): void;
  findByName(name: string): Skill | null;
  findByTrigger(userInput: string): Skill[];
  importFromUrl(url: string): Promise<Skill>;
  exportSkill(name: string): Promise<string>;
}
```

#### 6.5.3 Skill 存储层级

| 层级 | 路径 | 适用范围 |
|------|------|----------|
| 个人 | `~/.rookie/skills/<name>/SKILL.md` | 所有项目 |
| 项目 | `.rookie/skills/<name>/SKILL.md` | 当前项目 |
| 插件 | `<plugin>/skills/<name>/SKILL.md` | 插件启用时 |

#### 6.5.4 自改进学习循环（来自 Hermes）

```typescript
export class SkillLearner {
  async evaluateForCreation(task: CompletedTask): Promise<SkillCandidate | null>;
  async createSkill(candidate: SkillCandidate): Promise<Skill>;
  async evaluatePerformance(skill: Skill, usage: SkillUsage): Promise<SkillImprovement | null>;
  scheduleNudge(intervalSteps: number): void;
}

export interface SkillCandidate {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  source: { taskId: string; steps: AgentEvent[] };
}

export interface SkillUsage {
  skillName: string;
  timestamp: number;
  success: boolean;
  userSatisfied?: boolean;
  userEdits?: string[];
  duration: number;
}

export interface SkillImprovement {
  type: 'prompt_update' | 'tool_update' | 'description_update';
  before: string;
  after: string;
  reason: string;
}
```

---

### 6.6 多模型调度（v2 更新）

```typescript
export interface ModelProvider {
  name: string;
  capabilities: ModelCapabilities;

  chat(params: ChatParams): AsyncGenerator<ChatChunk>;
  chatWithTools(params: ChatWithToolsParams): AsyncGenerator<ChatChunk>;
  embed?(texts: string[]): Promise<number[][]>;
}

export interface ModelCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  maxTokens: number;
  contextWindow: number;
}

export interface ChatWithToolsParams extends ChatParams {
  tools: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
}

export interface ChatChunk {
  type: 'text' | 'tool_call' | 'tool_call_delta' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; arguments: string };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class ModelRouter {
  private providers: Map<string, ModelProvider>;
  private strategy: RoutingStrategy;

  route(task: TaskType): ModelProvider;
  // 路由策略（v2 新增 OpenRouter 支持）：
  // - 代码补全 → 快速本地模型 / Codestral
  // - 复杂推理 → Claude Sonnet / GPT-5 / DeepSeek
  // - Embedding → OpenAI text-embedding / Jina
  // - 简单分类 → Haiku / GPT-4o-mini
  // - 通过 OpenRouter 接入 200+ 模型（来自 Hermes）
}
```

### 6.7 工具系统 & MCP

（保持 v1 不变）

**v2 新增约束**:
- `ToolRegistry.invoke()` 必须先调用 `PermissionManager.check()`
- `ToolRegistry.invoke()` 必须在调用前后触发 `PreToolUse` / `PostToolUse` hooks
- `shell_execute` 必须通过 `SandboxConfig` 执行

### 6.8 记忆系统（v2 重写，来自 Hermes）

```typescript
export class MemoryStore {
  private db: Database;         // better-sqlite3

  async saveSession(sessionId: string, messages: Message[]): Promise<void>;
  async loadSession(sessionId: string): Promise<Message[]>;

  // FTS5 全文搜索（来自 Hermes）
  async search(query: string, limit: number): Promise<MemoryEntry[]>;

  // Agent-curated Memory（来自 Hermes）
  async curate(session: Message[], context: CurationContext): Promise<CuratedMemory[]>;
  async saveCurated(memory: CuratedMemory): Promise<void>;
  async searchCurated(query: string, limit: number): Promise<CuratedMemory[]>;

  async buildProjectContext(projectRoot: string): Promise<ProjectContext>;
}

export interface CuratedMemory {
  id: string;
  type: 'fact' | 'preference' | 'decision' | 'pattern' | 'debug_tip';
  content: string;
  confidence: number;
  source: string;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}
```

---

## 7. 多 Agent 协作（v2 更新）

### 7.1 Agent 拓扑

（保持 v1 不变）

### 7.2 编排器

（保持 v1 不变）

### 7.3 Subagent 委派模式（🆕 来自 Claude Code）

```typescript
export interface SubagentConfig {
  name: string;
  agent: string;
  systemPrompt: string;
  preloadSkills?: string[];
  allowedTools?: string[];
  model?: string;
  contextMode: 'fork' | 'shared';
}

export class SubagentManager {
  async delegate(config: SubagentConfig, task: string): Promise<SubagentResult>;
  async delegateParallel(tasks: SubagentTask[]): Promise<SubagentResult[]>;
}
```

### 7.4 Agent 间通信

- **共享黑板**: 所有 Agent 读写同一个上下文黑板
- **消息传递**: Agent 之间通过消息队列异步通信
- **工具共享**: 所有 Agent 共享同一个 ToolRegistry
- **进度共享（新增）**: 所有 Agent 共享 SessionHarness 的 progress 状态

---

## 8. 错误处理 & 可观测性

（保持 v1 不变）

---

## 9. 技术选型（v2 更新）

| 层 | 组件 | 技术 |
|----|------|------|
| Rust AST | 多语言解析 | tree-sitter + tree-sitter-languages |
| Rust 索引 | 全文检索 | tantivy |
| Rust 知识 | 图存储 | 自研内存图结构 |
| Rust 符号 | 符号分析 | tree-sitter + 自定义解析 |
| Rust 文件监听 | 文件变更 | notify |
| Rust JSON-RPC | 协议层 | jsonrpsee |
| Rust 并发 | 并发安全 | dashmap + crossbeam |
| TS 传输 | 进程通信 | node child_process |
| TS CLI | 命令行 | commander + ink 7 |
| TS 构建 | 打包 | tsup |
| TS 测试 | 单元测试 | vitest |
| 集成 | Monorepo | pnpm workspace + cargo workspace |
| **🆕 记忆存储** | **持久化** | **better-sqlite3 + FTS5** |
| **🆕 多模型** | **模型接入** | **OpenRouter API** |
| **🆕 Hooks** | **Shell 执行** | **node child_process + execa** |

---

## 10. CLI 命令设计（v2 更新）

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

# 管道支持（🆕 Claude Code Unix 哲学）
cat error.log | rookie -p "分析这个错误"
git diff main | rookie -p "review 这些变更"
rookie -p "翻译 README.md 为英文" > README.en.md

# Skill 管理（Hermes + Claude Code 风格）
rookie skill create             # 从最近任务创建 Skill
rookie skill list               # 列出已安装的 Skills
rookie skill import <url>       # 导入 Skill
rookie skill export <name>      # 导出 Skill
/fix-issue 123                  # 🆕 直接调用 skill

# Harness 命令（🆕）
rookie init <task>              # 初始化长任务（Harness Initializer）
rookie resume [session-id]      # 恢复长任务（Harness Coding Agent）
rookie progress                 # 查看当前进度
rookie verify                   # 运行所有 feature 验证

# 系统命令
rookie model                    # 切换模型
rookie config                   # 配置管理
rookie index                    # 构建项目索引
rookie search <query>           # 搜索代码
rookie doctor                   # 诊断问题
rookie update                   # 更新到最新版本
/schedule 5m /verify            # 🆕 定期执行
```

---

## 11. 分阶段交付计划（v2 重排）

### Phase 0: 基础骨架 + 端到端打通（最高优先级）

**目标**: LLM → Function Calling → 工具执行 → 结果返回 端到端可运行

- [ ] 修复: 消除 server.rs 重复分发逻辑
- [ ] 修复: 消除所有硬编码路径（环境变量 + PATH 查找）
- [ ] 实现: OpenAI Provider streaming + function calling
- [ ] 实现: Anthropic Provider streaming + function calling
- [ ] 改造: ReAct 循环支持原生 tool_calls（回退到文本解析）
- [ ] 实现: file_read / file_write / file_edit / shell_execute 真实工具
- [ ] 实现: search_code 接入 RookieClient.index.search
- [ ] 实现: shell_execute 基础沙箱（timeout + maxBuffer + 危险命令检测）
- [ ] 集成测试: 用户输入 → LLM → function call → 工具 → 返回结果

**交付物**: 可运行的 CLI，能接收用户指令、调用 LLM、执行工具、返回结果

### Phase 1: 生产力基础

**目标**: ROOKIE.md + Hooks + 权限 + 持久化记忆 + Token 追踪

- [ ] 实现: ROOKIE.md 加载器（全局 → 项目 → 子目录 合并）
- [ ] 实现: HookRegistry（PreToolUse / PostToolUse / SessionStart/End）
- [ ] 实现: PermissionManager（allow/deny/ask 三级权限）
- [ ] 实现: MemoryStore SQLite 持久化（better-sqlite3 + FTS5）
- [ ] 实现: Token 计数 + Cost 追踪（接入 TUI Sidebar）
- [ ] 实现: RookieError 统一错误处理
- [ ] 实现: Auto Memory（自动记录 build 命令、调试技巧）
- [ ] rookie-core: 符号分析基础版（同文件符号跳转）
- [ ] rookie-core: 增量索引更新

**交付物**: 可配置、有权限控制、有持久记忆的编码助手

### Phase 2: Session Harness + Skill 系统

**目标**: 长任务连续性 + 自改进 Skill

- [x] 实现: SessionHarness（initialize / resume / checkpoint / verify）
- [x] 实现: Progress 文件管理
- [x] 实现: Feature List 管理 + 验证循环
- [x] 实现: SKILL.md 解析器（frontmatter + shell 预处理）
- [x] 实现: SkillRegistry（加载/注册/查找/监听变更）
- [x] 实现: SkillLearner（自动创建 + 自改进循环）
- [x] 实现: Skill 导入/导出（agentskills.io 兼容）
- [x] rookie-core: 知识图谱引擎（build_from_project 实现）
- [x] rookie-core: 文件变更监听 + 增量索引

**交付物**: 支持长任务分解与恢复，Skill 可创建/分享/自改进

### Phase 3: 多 Agent + MCP + Subagent

**目标**: 多模型调度 + 多 Agent 协作 + MCP + Subagent 委派

- [x] 实现: ModelRouter（多模型路由策略 + OpenRouter 接入）
- [x] 实现: AgentOrchestrator（sequential / parallel / adaptive）
- [x] 实现: SubagentManager（context fork + 并行委派）
- [x] 实现: MCP Client + MCP Server + StdioMcpTransport
- [x] 实现: ReviewerAgent / ExplorerAgent / ArchitectAgent
- [x] 实现: Agent 间通信（SharedBlackboard + 消息传递）
- [x] CLI: Agent 管理命令（list/run/pipeline/parallel）
- [x] CLI: 管道支持（-p flag + stdin + JSON/text output）

**交付物**: 全能型 Agent 平台，支持多模型多 Agent 协作

### Phase 4: 性能优化 + 扩展

**目标**: NAPI 传输层 + 性能优化 + 多平台网关

- [ ] NAPI-RS binding（rookie-core → .node addon）
- [ ] NapiTransport 实现
- [ ] 性能基准测试
- [ ] AST 缓存优化
- [ ] 知识图谱持久化
- [ ] 大型代码库压力测试
- [ ] （可选）多平台网关：Telegram / Slack / Discord（来自 Hermes）
- [ ] （可选）Web UI + Remote Control（来自 Claude Code）

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
    "ink": "^7",
    "react": "^19",
    "openai": "^4",
    "@anthropic-ai/sdk": "^1",
    "better-sqlite3": "^11",
    "execa": "^9",
    "chokidar": "^4",
    "yaml": "^2",
    "gray-matter": "^4"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "tsup": "^8",
    "vitest": "^2",
    "@types/node": "^22",
    "@types/better-sqlite3": "^7"
  }
}
```

---

## 附录 A: 与三大标杆框架的对齐映射

| Rookie Agent 模块 | Harness 对应 | Hermes 对应 | Claude Code 对应 |
|-------------------|-------------|-------------|-----------------|
| SessionHarness | Initializer/Coding Agent 双阶段 | - | Session resume |
| Progress 文件 | claude-progress.txt | - | Auto Memory |
| Feature List | feature_list.json | - | - |
| HookRegistry | - | - | Hooks lifecycle |
| ROOKIE.md | - | - | CLAUDE.md |
| Auto Memory | - | Agent-curated memory | Auto Memory |
| PermissionManager | - | - | Permission rules |
| SandboxConfig | - | - | Tool permissions |
| SKILL.md | - | agentskills.io | SKILL.md + frontmatter |
| SkillLearner | - | 闭环学习循环 | - |
| SubagentManager | - | - | Subagent / context:fork |
| ModelRouter + OpenRouter | - | 200+ 模型 | Bedrock/Vertex/Foundry |
| MemoryStore (SQLite+FTS5) | - | FTS5 + Honcho | - |
| ReAct + Function Calling | - | Agent loop | Agent SDK query API |
| 管道支持 (stdin/stdout) | - | - | Unix 哲学 CLI |
| TUI (Ink) | - | TUI (textual) | Terminal CLI |

---

## 附录 B: 设计决策记录 (ADR)

### ADR-001: 为什么选择 TS + Rust 而不是纯 Python

**上下文**: Harness 和 Hermes 都是 Python 项目
**决策**: TS 编排 + Rust 计算
**原因**:
1. Rust 在 AST 解析、全文检索上比 Python 快 10-100x
2. TS 生态更适合 CLI/TUI 交互（Ink、React）
3. 为后续 NAPI-RS 零开销集成铺路
4. pnpm + cargo workspace 双 monorepo 管理成熟

### ADR-002: 为什么 Function Calling 优先于文本解析

**上下文**: Hermes 使用文本解析 action，Claude Code 使用 function calling
**决策**: Function Calling 优先 + 文本解析回退
**原因**:
1. Function Calling 解析可靠性 > 99%，文本解析 < 90%
2. 主流 LLM（GPT-4o、Claude、Gemini）都支持 function calling
3. 保留文本解析作为不支持 FC 的模型的回退方案

### ADR-003: 为什么需要 Session Harness

**上下文**: 现有 Agent 框架都假设任务能在单个 context window 内完成
**决策**: 引入 Harness 的双阶段策略
**原因**:
1. 真实开发任务通常需要 30min+
2. LLM context window 有限，长任务必然跨多个 session
3. 没有进度恢复机制，Agent 每次都要从头理解项目
4. Feature list + 验证循环防止 Agent "虚报完成"
