# Rookie Agent 对齐 Claude Code Best (CCB) 专项改进路线图

> 聚焦 TUI 体验 / Tool 系统 / Hooks 系统 / 多 Agent 协作四大维度，逐项弥合与 CCB 的差距
> 与已有 gap-analysis 文档互补：前者面向 Harness/Hermes/Claude Code 三标杆的内部能力建设，本文档专注 CCB 对标

**日期**: 2026-04-23
**版本**: v1.1
**作者**: 刘建伟 + Mira
**状态**: 进行中（部分已完成）
**关联文档**:
- `docs/superpowers/specs/2026-04-23-rookie-agent-gap-analysis-and-roadmap.md`（能力缺口分析与路线图）
- `docs/superpowers/specs/2026-04-22-rookie-agent-design-v2.md`（设计 v2）
- `docs/superpowers/specs/2026-04-22-rookie-agent-design.md`（设计 v1）

---

## 0. 文档定位

本文档是 **CCB 对标专项路线图**，与同目录下 `2026-04-23-rookie-agent-gap-analysis-and-roadmap.md` 的关系如下：

| 维度 | 已有 gap-analysis 文档 | 本文档（CCB 对标专项） |
|---|---|---|
| **对标对象** | Harness / Hermes / Claude Code 三大标杆 | Claude Code Best (CCB) 单一标杆深度对标 |
| **覆盖范围** | 全量内部能力建设（P0~P3 已大量完成） | TUI 体验 / Tool 系统 / Hooks 系统 / 多 Agent 协作 |
| **颗粒度** | 按 P0~P3 优先级横切 | 按 Phase-A~D 纵切，每条任务附带涉及文件与验收标准 |
| **侧重** | "补齐" — 仓库实现 vs 设计文档 | "对齐" — Rookie 现状 vs CCB 最佳实践 |

两份文档任务 **不重复**：已有文档已完成或已规划的条目（如 P0-T1~T6、P1-T1~T9 等）不在本文档重复列出。本文档仅包含 CCB 有而 Rookie 尚未覆盖的差距项。

---

## 1. CCB 五层架构 vs Rookie 现状对照表

### 1.1 CCB 五层架构概览

| 层级 | CCB 核心模块 | 关键特征 |
|---|---|---|
| **交互层** | `src/screens/REPL.tsx` React/Ink TUI，PromptInput | 流式中断恢复、主题切换、Plan Mode 只读、StatusLine Hook |
| **编排层** | `src/QueryEngine.ts` | 多轮对话持久化、成本追踪、文件历史快照(100 snapshots)、transcript 录制 |
| **核心循环层** | `src/query.ts` AsyncGenerator agentic loop | State 10 字段、5 级上下文预处理管道 (applyToolResultBudget → snipCompact → microcompact → contextCollapse → autocompact) |
| **工具层** | `src/tools.ts` → `src/Tool.ts` | `Tool<Input,Output,Progress>` 泛型 + `buildTool()` 工厂 + MCP 一等公民 + 50+ 工具 + `filterToolsByDenyRules()` |
| **通信层** | 7 种 Provider | Anthropic/Bedrock/Vertex/Foundry/OpenAI/Gemini/Grok + Prompt Cache + thinking blocks |

### 1.2 CCB 特色功能（源自 GitHub README）

- **群控 (Pipe IPC)**: 同机 main/sub 自动编排 + LAN 跨机器零配置 mDNS 发现与通讯，`/pipes` 面板
- **ACP 协议**: 接入 Zed/Cursor 等 IDE
- **Remote Control**: Docker 自托管远程界面
- **Langfuse 监控**: 企业级 Agent loop 监控
- **Web Search**: 内置 bing/brave 搜索
- **Poor Mode**: 减少并发请求
- **Channels**: MCP 推送外部消息（飞书/Slack/Discord/微信）
- **Voice Mode / Computer Use / Chrome Use**
- **Feature Flags**: `FEATURE_<NAME>=1`
- **/dream 记忆整理**
- **Teach Me 学习技能**

### 1.3 对照表

| 维度 | CCB 做法 | Rookie 现状 | 差距 |
|---|---|---|---|
| TUI 框架 | React/Ink REPL.tsx，StatusLine，主题切换 | Ink 7 + React 19，6 种 TuiMode，`app.tsx` + 10 组件 | ⚠️ 缺流式中断/主题/StatusLine Hook |
| 流式中断 | STALL_THRESHOLD_MS=30s, STREAM_IDLE_TIMEOUT_MS=90s | `useTuiState` 无空闲检测，流卡死只能 Ctrl+C | ❌ 完全缺失 |
| 工具进度 | `Tool.call()` → `AsyncGenerator<Progress, Output>` | `tool.execute()` → `Promise<unknown>`，无中间进度 | ❌ 完全缺失 |
| Plan Mode | `prepareContextForPlanMode` 切换只读，禁用写工具 | `PlanPanel.tsx` 展示计划但不阻断写操作 | ⚠️ 未强制只读 |
| 权限拒绝抑制 | `denialTracking` maxConsecutive=3, maxTotal=20 自动 abort | `PermissionManager.check()` 无拒绝计数 | ❌ 完全缺失 |
| 并行事件流 | `StreamingToolExecutor` 多工具并行 + 分 Lane 展示 | `EventStream.tsx` 单 Lane 顺序渲染 | ❌ 完全缺失 |
| 主题化 | `settings.json` theme: dark/light/high-contrast | `COLORS` 硬编码于 `types.ts` | ❌ 完全缺失 |
| Tool 泛型 | `Tool<Input,Output,Progress>` + `buildTool()` + Zod inputSchema | `Tool { name, description, parameters, execute }` 最小接口 | ❌ 缺泛型/工厂/schema |
| MCP 自动注册 | `mcpInfo` 字段 + `InProcessTransport` + `buildMcpToolName` | `McpClient` 可连接但需手动注册到 `ToolRegistry` | ⚠️ 半自动 |
| 工具并行 | `isConcurrencySafe` 门控 + semaphore | `ToolRegistry.invoke()` 纯串行 | ❌ 完全缺失 |
| 文件历史 | `fileHistoryTrackEdit` 100 snapshots + mtime 原子校验 | 无快照，依赖 git | ❌ 完全缺失 |
| Shell 沙箱 | `sandbox-adapter.ts`，bwrap/firejail | `shell.ts` 直接 `exec`，无沙箱 | ❌ 完全缺失 |
| 上下文管道 | 5 级压缩（applyToolResultBudget → ... → autocompact） | `Compactor` 单级 80% 阈值压缩 | ⚠️ 仅一级 |
| 权限 8 源 | session → project → user → managed → default + cliArg + flagSettings + policySettings | 3 层 settings + session rules，共约 4 源 | ⚠️ 不足 |
| Hooks async | 长耗时审批 `asyncRewake` 不阻塞主循环 | `HookRegistry.fire()` 全阻塞或 fire-and-forget 二选一 | ❌ 完全缺失 |
| Hooks 结构化 LLM | `hookSpecificOutput` 强类型 JSON | `promptLooksRejected()` 正则关键词匹配 | ❌ 原始正则 |
| Hooks 链式 | `modifiedInput` 串联多 hook | `PreToolUse` 无法修改后续输入 | ❌ 完全缺失 |
| Hook Trust | `shouldSkipHookDueToTrust` | 无信任机制 | ❌ 完全缺失 |
| 跨进程 Subagent | `AgentTool.call` 三条路径 (in-process/child/remote) | `SubagentManager` 仅 in-process fork/shared | ⚠️ 仅 in-process |
| Worktree 隔离 | `countWorktreeChanges`，fail-closed | 无 git worktree 支持 | ❌ 完全缺失 |
| Coordinator Mode | `task-notification` XML 协议 + INTERNAL_WORKER_TOOLS | `OrchestratorMode` 有 4 种但无 coordinator | ⚠️ 缺 coordinator |
| Pipe IPC / LAN | `/pipes` 面板 + mDNS 零配置 | 无进程间通信 | ❌ 完全缺失 |
| Transcript | `recordTranscript` + `--resume` | `resume.ts` CLI 命令存在但无 transcript JSONL | ⚠️ 半成品 |
| Scheduler Daemon | `workerRegistry` + `EXIT_CODE_PERMANENT=78` | `scheduler/` 有 parser/store 但无守护进程 | ⚠️ 半成品 |

---

## 2. TUI 层对齐路线（Phase-A）

### A1 · 流式中断与假死恢复

CCB 在流式输出过程中设有 `STALL_THRESHOLD_MS=30000` 和 `STREAM_IDLE_TIMEOUT_MS=90000` 两个阈值，当流在 30 秒内无新 token 输出时提示用户"等待中"，90 秒后自动中断并尝试重新连接。Rookie 当前的 `useTuiState` 没有任何空闲检测逻辑，流卡死时只能依赖用户手动 Ctrl+C。

- [ ] 在 `useTuiState` 中新增 `streamIdleTimer` ref，当 `isProcessing === true` 时启动计时
- [ ] 30 秒无事件时在 `BottomBar` 显示"⏳ 等待模型响应…"提示
- [ ] 90 秒无事件时自动触发流中断 + 自动重试（最多 2 次）
- [ ] 新增 `ROOKIE_STALL_THRESHOLD_MS` / `ROOKIE_STREAM_IDLE_TIMEOUT_MS` 环境变量覆盖

> **状态**: 待实现

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/hooks/useTuiState.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/BottomBar.tsx`

**验收标准**: 当模型响应超过 30 秒空闲时状态栏有视觉提示；超过 90 秒自动中断并重试，不需要用户手动干预。

---

### A2 · 工具进度通道

CCB 的 `Tool.call()` 返回 `AsyncGenerator<Progress, Output>`，允许工具在执行过程中逐步上报进度（如 shell 输出行、搜索匹配数）。Rookie 的 `Tool.execute()` 返回 `Promise<unknown>`，长任务（如 `shell_execute`、`web_search`）期间 TUI 完全无反馈。

- [x] 新增 `ToolProgressPanel` 组件，以 spinner + 百分比形式展示长任务进度
- [x] `Tool` 接口新增可选 `onProgress?: (progress: ToolProgress) => void` 回调
- [x] `shell.ts` 在 `exec` 期间通过 stdout 行计数上报进度
- [x] `web_search.ts` / `web_fetch.ts` 在 fetch 期间上报阶段（连接/下载/解析）

> **状态**: ✅ 已完成 - 已实现 `ToolProgressPanel.tsx` 组件和 `useToolProgress` hook，支持实时进度展示

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/shell.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/web_search.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/web_fetch.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/` (新建 `ToolProgressPanel.tsx`)

**验收标准**: shell 执行期间 TUI 可见滚动输出行；web_fetch 期间可见"连接中→下载中→解析中"阶段提示。

---

### A3 · 主题化系统

CCB 支持通过 `settings.json` 的 `theme` 字段在 dark/light/high-contrast 三套主题之间切换。Rookie 当前在 `types.ts` 中硬编码 `COLORS` 常量对象，没有动态主题能力。

- [ ] 新建 `ThemeProvider` React Context，从 `~/.rookie/settings.json` 的 `theme` 字段读取主题名
- [ ] 将 `COLORS` 常量迁移到 `themes/dark.ts`，新增 `themes/light.ts` 和 `themes/high-contrast.ts`
- [ ] 所有 TUI 组件中的颜色引用替换为 `useTheme()` hook
- [ ] 支持运行时 `/theme <name>` 斜杠命令热切换

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/types.ts`（移除硬编码 COLORS）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/` (新建 `themes/` 目录)
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/` (全部组件适配)
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/config/settings.ts`（`RookieSettings` 新增 `theme` 字段）

**验收标准**: 修改 `~/.rookie/settings.json` 的 `theme` 字段后，TUI 颜色方案立即切换；至少支持 dark/light/high-contrast 三种预设。

---

### A4 · Plan Mode 只读强化

CCB 的 Plan Mode 通过 `prepareContextForPlanMode` 在进入计划模式时自动将写工具（write/shell/edit）从可用工具列表中移除，确保计划阶段不会产生副作用。Rookie 的 `PlanPanel.tsx` 仅展示计划内容，并未限制工具调用。

- [ ] `ToolRegistry` 新增 `setReadOnly(flag: boolean)` 方法，flag 为 true 时 `invoke()` 拒绝所有非只读工具
- [ ] 在 `useTuiState` 中 `mode === "plan"` 时自动调用 `setReadOnly(true)`
- [ ] `TopStatusBar` 在 plan 模式下显示 `[PLAN]` 徽章并使用特殊染色
- [ ] 退出 plan 模式时自动恢复完整工具集

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/hooks/useTuiState.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/TopStatusBar.tsx`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/PlanPanel.tsx`

**验收标准**: 进入 plan 模式后任何写操作工具调用均返回 `TOOL_PERMISSION_DENIED` 错误；状态栏有明显 `[PLAN]` 标识。

---

### A5 · Permission Denial 抑制

CCB 实现了 `denialTracking`，当用户连续拒绝权限请求 3 次或累计拒绝 20 次时自动 abort 当前任务，避免无限弹窗。Rookie 的 `PermissionManager` 没有拒绝计数逻辑。

- [ ] `PermissionManager` 新增 `denialCount` / `consecutiveDenialCount` 计数器
- [ ] 在 `applyAskDecision()` 中当 `!decision.allowed` 时递增计数
- [ ] 连续拒绝 ≥ 3 次时抛出 `ErrorCode.MAX_DENIALS_REACHED` 并中止当前 agent loop
- [ ] 累计拒绝 ≥ 20 次时强制结束整个会话
- [ ] 阈值可通过 `RookieSettings.permissions.maxConsecutiveDenials` / `maxTotalDenials` 配置

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/permissions/manager.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/permissions/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/errors.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/config/settings.ts`

**验收标准**: 测试中连续拒绝 3 次后 `ToolRegistry.invoke()` 不再弹出新的 ask 而是直接抛出 abort 错误。

---

### A6 · 多 Lane 并行事件流

CCB 的 `StreamingToolExecutor` 支持多个工具并行执行并在终端以分 Lane 形式展示。Rookie 的 `EventStream.tsx` 仅渲染单一事件列表，无法区分不同 agent 或并行工具的输出。

- [x] `EventStream.tsx` 新增 `agentName` 过滤，支持按 agent 分轨渲染
- [x] 每个 Lane 左侧显示彩色竖条标识所属 agent
- [x] `StreamEvent` 类型新增可选 `agentName?: string` 字段

> **状态**: ✅ 已完成 - 已实现多 Lane 并行事件流，支持 main/system/background/notification 四轨道

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/EventStream.tsx`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/types.ts`

**验收标准**: 当 orchestrator 以 parallel 模式运行多个子 agent 时，TUI 中每个 agent 的事件分轨显示，左侧色条颜色各异。

---

### A7 · Status Line Hook

CCB 允许用户在 `settings.json` 中配置 `statusLine` 字段，指定一个 shell 命令，其输出被实时渲染在底部状态栏中（如显示当前 branch、CI 状态等）。Rookie 的 `BottomBar.tsx` 只显示固定信息。

- [ ] `RookieSettings` 新增 `statusLine?: string` 字段
- [ ] `BottomBar.tsx` 启动时读取并每 5 秒轮询执行该命令，将 stdout 渲染到状态栏右侧
- [ ] 命令执行超时 3 秒自动跳过

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/BottomBar.tsx`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/config/settings.ts`

**验收标准**: 在 `~/.rookie/settings.json` 中配置 `"statusLine": "git branch --show-current"` 后，底部状态栏实时显示当前分支名。

---

### A8 · 遗留 REPL 清理

`packages/rookie-cli/src/repl.ts` 是旧版基于 readline 的 REPL 实现，现已被 Ink TUI 完全替代。保留该文件会造成困惑和维护负担。

- [ ] 删除 `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/repl.ts`
- [ ] 删除 `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/dist/repl.d.ts`
- [ ] 清理 `index.ts` 中对 `repl.ts` 的引用（如有）
- [ ] 确认 `code.ts` 命令入口使用 TUI 而非旧 REPL

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/repl.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/index.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/commands/code.ts`

**验收标准**: `repl.ts` 已删除；`pnpm build` 通过；`rookie code` 正常启动 TUI 模式。

---

### Phase-A Exit Criteria

| 指标 | 达标条件 |
|---|---|
| 流式假死恢复 | 模拟 60 秒无响应后 TUI 自动提示并重试 |
| 工具进度 | shell 执行 `sleep 5 && echo done` 时 TUI 有可见进度反馈 |
| 主题 | `dark` / `light` / `high-contrast` 三套主题可切换且所有组件颜色一致 |
| Plan 只读 | plan 模式下 `file_write` 调用被拒，退出后恢复 |
| Denial 抑制 | 连续拒绝 3 次后自动 abort |
| 多 Lane | parallel 模式下事件分轨 |
| StatusLine | 自定义命令输出出现在底部栏 |
| REPL 清理 | `repl.ts` 不存在且 build 通过 |

---

## 3. Tool 系统对齐路线（Phase-B）

### B1 · Tool<I,O,P> 结构化泛型

CCB 的工具系统使用 `Tool<Input, Output, Progress>` 三泛型参数 + `buildTool()` 工厂函数 + Zod inputSchema，拥有 **35+ 个接口字段**，实现了强类型安全、自动文档生成、权限门控、并发控制和渲染管线。Rookie 当前的 `Tool` 接口仅有 `{ name, description, parameters, execute }`，既无类型参数也无 schema 验证。

#### B1.1 CCB Tool 接口 35 字段全量对照

| # | 分类 | CCB 字段 | 类型 / 签名 | 功能说明 | Rookie 现状 | 改造方案 |
|---|---|---|---|---|---|---|
| 1 | **核心** | `name` | `string` | 工具唯一标识（如 `Write`） | ✅ `name` | 保持 |
| 2 | **核心** | `description()` | `() => string` | 动态描述（可根据上下文变化） | ⚠️ `description: string` 静态 | 改为函数签名，支持动态 |
| 3 | **核心** | `inputSchema` | `ZodType<Input>` | Zod schema 自动校验+生成 JSON Schema | ❌ `parameters: object` 手工 JSON Schema | 引入 Zod，`buildTool()` 自动转换 |
| 4 | **核心** | `call()` | `AsyncGenerator<Progress, Output>` | 执行入口，yield Progress，return Output | ❌ `execute(): Promise<unknown>` | 改为 AsyncGenerator |
| 5 | **注册** | `aliases` | `string[]` | 别名数组，搜索和调用都可命中 | ❌ 无 | `ToolDefinition` 新增字段 |
| 6 | **注册** | `searchHint` | `string` | 关键词提示，供 ToolSearchTool 使用 | ❌ 无 | `ToolDefinition` 新增字段 |
| 7 | **注册** | `shouldDefer` | `boolean` | 是否延迟加载（不含在初始工具列表中） | ❌ 无，全量注册 | 新增字段+惰性注册逻辑 |
| 8 | **注册** | `alwaysLoad` | `boolean` | 即使 shouldDefer=true 也始终加载 | ❌ 无 | 配合 shouldDefer 使用 |
| 9 | **注册** | `isEnabled()` | `(ctx) => boolean` | 运行时判断是否启用 | ❌ 无条件启用 | 新增字段，条件工具适配 |
| 10 | **安全** | `validateInput()` | `(input) => ValidationResult` | 输入校验（超越 schema 的语义校验） | ❌ 无 | 新增字段，如路径越界检测 |
| 11 | **安全** | `checkPermissions()` | `(input, ctx) => PermissionResult` | 权限检查（调用前门控） | ⚠️ `PermissionManager.check()` 外置 | 内化到 Tool 接口 |
| 12 | **安全** | `isReadOnly()` | `() => boolean` | 标记只读工具（Plan Mode 门控） | ❌ 无 | 新增字段，A4 Plan 只读依赖 |
| 13 | **安全** | `isDestructive()` | `() => boolean` | 标记破坏性工具（删除/覆写） | ❌ 无 | 新增字段，权限升级时使用 |
| 14 | **安全** | `isConcurrencySafe()` | `() => boolean` | 标记并发安全（B3 并行执行依赖） | ❌ 无 | 新增字段 |
| 15 | **安全** | `preparePermissionMatcher()` | `(input) => PermissionMatcher` | 生成权限匹配器对象 | ❌ 无 | 新增字段 |
| 16 | **安全** | `interruptBehavior` | `"allow" \| "ignore" \| "abort"` | 被中断时的行为策略 | ❌ 无 | 新增字段，流式中断(A1)依赖 |
| 17 | **输出** | `maxResultSizeChars` | `number` | 工具结果最大字符数（超出截断） | ❌ 无，部分工具硬编码 | 统一到接口层 |
| 18 | **输出** | `mapToolResultToToolResultBlockParam()` | `(result) => BlockParam` | 将结果映射为 API block 参数 | ❌ 无，直接 `JSON.stringify` | 新增字段，支持多模态输出 |
| 19 | **输出** | `renderToolResultMessage()` | `(result) => ReactNode` | TUI 渲染工具结果 | ⚠️ `EventStream.tsx` 统一渲染 | 下沉到工具自身 |
| 20 | **输出** | `renderToolUseMessage()` | `(input) => ReactNode` | TUI 渲染工具调用（输入侧） | ⚠️ `EventStream.tsx` 统一渲染 | 下沉到工具自身 |
| 21 | **输出** | `backfillObservableInput()` | `(input) => Record<string,unknown>` | 流式渲染时的可观测输入回填 | ❌ 无 | 新增字段 |
| 22 | **上下文** | `prompt()` | `() => string \| undefined` | 工具专属 system prompt 片段 | ❌ 无 | 新增字段，注入 system 上下文 |
| 23 | **上下文** | `outputSchema` | `ZodType<Output>` | 输出 schema（用于结构化输出验证） | ❌ 无 | 新增字段 |
| 24 | **上下文** | `getPath()` | `(input) => string \| undefined` | 从输入中提取关联文件路径 | ❌ 无 | 新增字段，文件历史(B4)依赖 |
| 25 | **工厂** | `buildTool()` | `<I,O,P>(config) => Tool<I,O,P>` | 标准化工具构建工厂 | ❌ 无 | 核心改造点 |
| 26 | **工厂** | `toolGroup` | `string` | 工具分组（如 "filesystem", "search"） | ❌ 无 | 新增字段 |
| 27 | **工厂** | `mcpInfo` | `McpToolInfo \| undefined` | MCP 关联信息 | ⚠️ MCP 工具有但本地无 | 统一到接口 |
| 28 | **执行** | `timeout` | `number` | 工具执行超时（ms） | ⚠️ 仅 `shell.ts` 有 | 提升到通用字段 |
| 29 | **执行** | `retryPolicy` | `RetryPolicy` | 重试策略（次数/间隔/条件） | ❌ 无 | 新增字段 |
| 30 | **执行** | `onProgress` | `(progress: P) => void` | 进度回调（与 A2 联动） | ❌ 无 | 新增字段 |
| 31 | **执行** | `abortSignal` | `AbortSignal` | 取消信号（与 A1 联动） | ❌ 无 | 新增字段 |
| 32 | **监控** | `metrics` | `ToolMetrics` | 执行指标（耗时/调用次数/错误率） | ❌ 无 | 新增字段 |
| 33 | **监控** | `trace` | `TraceSpan` | 分布式追踪 span | ❌ 无 | 预留接口 |
| 34 | **过滤** | `filterToolsByDenyRules()` | 全局函数 | 根据 deny rules 过滤工具列表 | ❌ 无 | 权限系统(B7)配合实现 |
| 35 | **过滤** | `toolDenyRules` | `DenyRule[]` | 工具黑名单规则 | ❌ 无 | 配合 B7 权限 8 源 |

#### B1.2 核心改造方案

**Step 1: 定义新 `ToolDefinition<I, O, P>` 接口**

```typescript
// packages/rookie-sdk/src/tools/types.ts
interface ToolDefinition<I = unknown, O = unknown, P = unknown> {
  // --- 核心四要素 ---
  name: string;
  description: string | (() => string);
  inputSchema: ZodType<I>;
  call: (input: I, ctx: ToolContext) => AsyncGenerator<P, O>;

  // --- 注册与发现 ---
  aliases?: string[];
  searchHint?: string;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  isEnabled?: (ctx: RuntimeContext) => boolean;
  toolGroup?: string;
  mcpInfo?: McpToolInfo;

  // --- 安全与权限 ---
  validateInput?: (input: I) => ValidationResult;
  checkPermissions?: (input: I, ctx: ToolContext) => PermissionResult;
  isReadOnly?: boolean;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
  preparePermissionMatcher?: (input: I) => PermissionMatcher;
  interruptBehavior?: "allow" | "ignore" | "abort";

  // --- 输出与渲染 ---
  maxResultSizeChars?: number;
  outputSchema?: ZodType<O>;
  mapToolResultToToolResultBlockParam?: (result: O) => BlockParam;
  renderToolResultMessage?: (result: O) => ReactNode;
  renderToolUseMessage?: (input: I) => ReactNode;
  backfillObservableInput?: (input: I) => Record<string, unknown>;

  // --- 上下文 ---
  prompt?: () => string | undefined;
  getPath?: (input: I) => string | undefined;

  // --- 执行控制 ---
  timeout?: number;
  retryPolicy?: RetryPolicy;

  // --- 监控 ---
  metrics?: ToolMetrics;
}
```

**Step 2: 实现 `buildTool()` 工厂函数**

```typescript
// packages/rookie-sdk/src/tools/factory.ts
function buildTool<I, O, P>(config: ToolDefinition<I, O, P>): Tool<I, O, P> {
  const jsonSchema = zodToJsonSchema(config.inputSchema);
  return {
    ...config,
    parameters: jsonSchema,            // 向后兼容旧接口
    execute: wrapGenerator(config.call), // 向后兼容 Promise 消费者
    description: typeof config.description === 'function'
      ? config.description()
      : config.description,
  };
}
```

**Step 3: 向后兼容 shim**

```typescript
// packages/rookie-sdk/src/tools/compat.ts
function wrapLegacyTool(legacy: LegacyTool): Tool<unknown, unknown, never> {
  return buildTool({
    name: legacy.name,
    description: legacy.description,
    inputSchema: z.object(legacy.parameters), // 自动包装
    call: async function*(input, ctx) {
      return await legacy.execute(input, ctx);
    },
    isReadOnly: false,
    isConcurrencySafe: false,
  });
}
```

- [ ] 定义新 `ToolDefinition<I, O, P>` 接口，包含上述 35 个字段分类
- [ ] 实现 `buildTool<I, O, P>(config)` 工厂函数，内部自动完成 zod-to-json-schema 转换
- [ ] 实现 `wrapLegacyTool()` 向后兼容 shim，旧工具无需立即改造
- [ ] 迁移现有 12+ 工具至新接口（按优先级分批：P0 shell/file/edit，P1 search/grep/glob，P2 其余）
- [ ] `ToolRegistry.list()` 输出的 JSON 包含每个工具的 JSON Schema、isReadOnly、isConcurrencySafe 等元信息
- [ ] `ToolRegistry` 支持 `shouldDefer` 惰性注册：deferred 工具仅在被搜索或显式调用时加载
- [ ] 新增 `filterToolsByDenyRules()` 全局过滤函数，与 B7 权限系统联动

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/types.ts`（重写 Tool 接口）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/factory.ts`（新建 buildTool 工厂）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/compat.ts`（新建向后兼容 shim）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`（适配新接口）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/*.ts`（全部 12 个工具文件迁移）

**验收标准**: 新建一个工具时使用 `buildTool()` 工厂并通过 `inputSchema` Zod 对象自动校验输入；`ToolRegistry.list()` 返回结果包含 `jsonSchema`、`isReadOnly`、`isConcurrencySafe` 字段；旧工具通过 `wrapLegacyTool()` 无需改造即可运行。

---

### B2 · MCP 自动注册

CCB 在启动时自动扫描 `settings.json` 中的 `mcpServers` 配置，通过 `InProcessTransport` 或 `StdioTransport` 连接每个 MCP 服务，将发现的工具以 `mcp__{server}__{tool}` 命名自动注册到工具注册表。Rookie 的 `McpClient` 能连接 MCP 服务并发现工具，但需要手动编码将工具注册到 `ToolRegistry`。

- [ ] `RookieSettings` 新增 `mcpServers?: Record<string, McpServerConfig>` 字段
- [ ] `ToolRegistry` 新增 `bootstrap()` 方法，遍历 `mcpServers` 配置自动建连
- [ ] 每个 MCP 工具以 `mcp__{serverName}__{toolName}` 命名包装为本地 `Tool`
- [ ] 连接失败时 graceful 降级并记录日志，不阻塞启动

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/mcp/client.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/mcp/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/config/settings.ts`

**验收标准**: 在 `~/.rookie/settings.json` 中配置一个 MCP 服务后，`ToolRegistry.list()` 自动包含该服务暴露的所有工具，命名形如 `mcp__filesystem__read_file`。

---

### B3 · StreamingToolExecutor 并行执行

CCB 利用 `isConcurrencySafe` 标志门控工具并行执行：标记为并发安全的只读工具可以同时运行，写工具串行并通过 semaphore 互斥。Rookie 的 `ToolRegistry.invoke()` 完全串行执行。

- [ ] `Tool` 接口新增 `isConcurrencySafe?: boolean` 字段（默认 false）
- [ ] 新建 `StreamingToolExecutor` 类，接受一组待执行的工具调用
- [ ] 按 `isConcurrencySafe && !writesSameFile` 条件分组并发
- [ ] 写工具通过文件级 semaphore 确保同一文件不并发写入
- [ ] 与 `EventStream` A6 多 Lane 联动

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/` (新建 `executor.ts`)

**验收标准**: 同时调用 `file_read` + `grep` + `glob` 三个只读工具时实际并行执行（时间 ≈ max 而非 sum）；同时调用两个 `file_write` 写同一文件时串行执行。

---

### B4 · 文件历史 Snapshot

CCB 通过 `fileHistoryTrackEdit` 在每次文件编辑前保存快照到内存环形缓冲区（最多 100 份），并使用 mtime 原子校验防止外部修改冲突。Rookie 不保存文件快照，撤销操作完全依赖 git。

- [ ] 新建 `.rookie/history/` 目录，每次 `file_write` / `file_edit` 前保存原文件快照
- [ ] 快照命名: `{hash}_{timestamp}.snapshot`，环形保留最近 100 份
- [ ] 新增 `/undo <id>` 斜杠命令，支持恢复到指定快照
- [ ] 写入前校验 mtime，若文件在上次读取后被外部修改则提示用户确认

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/edit.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/file.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/commands/builtin.ts`（新增 /undo 命令）

**验收标准**: 执行 `file_edit` 后在 `.rookie/history/` 中可找到编辑前的快照文件；执行 `/undo` 可恢复。

---

### B5 · Shell 强沙箱

CCB 通过 `sandbox-adapter.ts` 根据操作系统选择沙箱方案（macOS 用 `sandbox-exec`，Linux 用 `bubblewrap` + `seccomp`），限制 shell 工具的文件系统和网络访问范围。Rookie 的 `shell.ts` 直接调用 `child_process.exec`，无任何沙箱。

- [x] 新建 `sandbox-adapter.ts`，实现平台检测 + 沙箱命令包装
- [x] macOS: 使用 `sandbox-exec -f <profile>` 限制只可访问项目目录
- [x] Linux: 使用 `bwrap --ro-bind / / --bind <projectRoot> <projectRoot>` 隔离
- [x] 提供 `ROOKIE_SANDBOX=off` 环境变量关闭沙箱（调试用）

> **状态**: ✅ 已完成（之前已实现）- Shell 沙箱适配器已就位

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/shell.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/` (新建 `sandbox-adapter.ts`)

**验收标准**: 在 Linux 上 `shell_execute` 执行 `cat /etc/passwd` 被沙箱拒绝（除非项目根目录为 `/etc`）。

---

### B6 · 上下文预处理管道

CCB 拥有完整的 5 级上下文压缩管道：`applyToolResultBudget`（限制工具结果长度）→ `snipCompact`（截断超长消息）→ `microcompact`（移除冗余空白）→ `contextCollapse`（折叠旧对话）→ `autocompact`（自动摘要）。Rookie 的 `Compactor` 仅实现单级 80% 阈值摘要压缩。

- [x] 实现 `applyToolResultBudget`：每个工具结果最多保留 `maxToolResultTokens`（默认 8000）
- [x] 实现 `snipCompact`：超过 `snipThreshold` 的消息中间插入 `[... N tokens snipped ...]`
- [x] 实现 `microcompact`：移除连续空行、规范化缩进
- [x] 实现 `contextCollapse`：将超过 N 轮前的对话折叠为单条摘要
- [x] 将上述 4 级与现有 `Compactor` 整合为统一管道，按序执行

> **状态**: ✅ 已完成（之前已实现）- 5 级上下文预处理管道已就位

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/compactor.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/react.ts`（调用管道）

**验收标准**: 在 200+ 消息的长会话中，上下文管道依次执行 5 级压缩，最终 token 数稳定在模型 context window 的 80% 以内；每级压缩日志可追溯。

---

### B7 · 权限 8 源叠加

CCB 的权限系统从 8 个来源叠加：session → project → user → managed → default + cliArg + flagSettings + policySettings。Rookie 当前有 3 层 settings（global/project/local）+ session rules，合计约 4 源。

- [x] 新增 `cliArg` 源：`--allow <tool>` / `--deny <tool>` 命令行参数
- [x] 新增 `flagSettings` 源：`ROOKIE_ALLOW_<TOOL>=1` 环境变量
- [x] 新增 `policySettings` 源：`~/.rookie/policy.json` 企业级策略文件
- [x] 新增 `managed` 源：远程下发的权限配置（预留接口）
- [x] `PermissionManager.check()` 按 8 源优先级逐级合并

> **状态**: ✅ 已完成（之前已实现）- 权限 8 源叠加系统已就位

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/permissions/manager.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/permissions/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/commands/code.ts`（解析 CLI 参数）

**验收标准**: `rookie code --allow shell_execute` 启动后 shell 工具不再弹出权限确认；`ROOKIE_ALLOW_FILE_WRITE=1` 环境变量生效。


---

### B8 · CCB 工具全量对齐清单

本节列出 CCB `getAllBaseTools()` 返回的 **全部 50+ 工具**，逐一与 Rookie 现有工具对照，给出差距评级和改造优先级。

#### B8.1 固定工具（始终可用）— 17 个

| # | CCB 工具名 | 功能描述 | Rookie 对应工具 | 差距 | 优先级 | 改造要点 |
|---|---|---|---|---|---|---|
| 1 | `AgentTool` | 子 Agent 调度（fork/命名/通用 Task），支持 worktree 隔离，三条路径（in-process/child/remote） | ❌ 无（`SubagentManager` 仅 in-process） | ❌ 缺失 | **P0** | 新建 `agent_tool.ts`，集成 SubagentManager 三路径调度；见 B10.1 |
| 2 | `BashTool` | Shell 执行，AST 安全解析(tree-sitter bash)，只读免审批(4类)，自动后台化(15s)，输出截断(30K)，进度流式 | ⚠️ `shell_execute` | ⚠️ 部分 | **P0** | 补 AST 解析/只读免审批/自动后台化/截断/进度；见 B9.3 |
| 3 | `FileReadTool` | 多模态读取（文本/图片/PDF/Notebook），去重缓存(mtime)，token 预算控制，二进制/设备文件屏蔽 | ⚠️ `file_read` | ⚠️ 部分 | **P0** | 补去重缓存/多模态/token预算/设备屏蔽；见 B9.1 |
| 4 | `FileEditTool` | 精确字符串替换，引号标准化(弯→直)，原子读-改-写(同步临界区)，mtime 防覆写，MAX_EDIT_FILE_SIZE=1GiB | ⚠️ `edit_apply_diff` / `edit_atomic_write` | ⚠️ 部分 | **P0** | 补引号标准化/同步临界区/mtime/1GiB；见 B9.2 |
| 5 | `FileWriteTool` | 全量写入/创建，行尾 LF 强制，create/update 区分，structuredPatch diff | ⚠️ `file_write` | ⚠️ 部分 | **P1** | 补 LF 强制/create-update 区分/diff；见 B9.1 |
| 6 | `NotebookEditTool` | Jupyter .ipynb 编辑，cell 级操作 | ⚠️ `notebook_read`/`notebook_edit` | ⚠️ 部分 | **P2** | 对标 cell 级操作完整性 |
| 7 | `WebFetchTool` | HTTP 抓取，Turndown→Markdown，URL 缓存(15min LRU)，域名预检(api.anthropic.com)，~90 预批准域名，10MB 上限，prompt 摘要 | ⚠️ `web_fetch` | ⚠️ 部分 | **P1** | 补缓存/预检/Turndown/摘要；见 B9.6 |
| 8 | `WebSearchTool` | 3 种适配器(ApiSearch/Bing/Brave)，域过滤，进度追踪 | ⚠️ `web_search`（仅 DuckDuckGo） | ⚠️ 部分 | **P1** | 补适配器工厂/Bing/Brave；见 B9.7 |
| 9 | `TodoWriteTool` | V1 内存全量替换，验证推动(3+ tasks nudge) | ⚠️ `todo_write` | ⚠️ 部分 | **P2** | 补验证推动/V2 双轨；见 B9.8 |
| 10 | `AskUserQuestionTool` | 向用户提问，中断 agent loop 等待回复 | ❌ 无 | ❌ 缺失 | **P1** | 新建；见 B10.2 |
| 11 | `SkillTool` | 技能执行，alwaysLoad，100K chars 结果上限 | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.3 |
| 12 | `EnterPlanModeTool` | 进入计划模式，切换只读工具集 | ❌ 无（`PlanPanel` 不阻断写操作） | ❌ 缺失 | **P1** | 新建，与 A4 联动；见 B10.4 |
| 13 | `ExitPlanModeV2Tool` | 退出计划模式，恢复完整工具集 | ❌ 无 | ❌ 缺失 | **P1** | 新建，与 A4 联动；见 B10.4 |
| 14 | `TaskOutputTool` | 后台任务输出查询，支持 agent 查看其他 agent 的输出 | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.5 |
| 15 | `BriefTool` | 简要输出模式，指示 agent 压缩回复 | ❌ 无 | ❌ 缺失 | **P3** | 新建；见 B10.6 |
| 16 | `ListMcpResourcesTool` | 列出 MCP 资源（prompts/resources） | ❌ 无 | ❌ 缺失 | **P2** | 新建，依赖 B2；见 B10.7 |
| 17 | `ReadMcpResourceTool` | 读取 MCP 资源内容 | ❌ 无 | ❌ 缺失 | **P2** | 新建，依赖 B2；见 B10.7 |

#### B8.2 条件工具（运行时检查）— 10+ 个

| # | CCB 工具名 | 功能描述 | Rookie 对应工具 | 差距 | 优先级 | 改造要点 |
|---|---|---|---|---|---|---|
| 18 | `GlobTool` | ripgrep --files + glob 过滤，按 mtime 排序（当无内嵌搜索时启用） | ⚠️ `glob_files` | ⚠️ 部分 | **P1** | 接入 ripgrep/mtime；见 B9.4 |
| 19 | `GrepTool` | ripgrep 正则搜索，head_limit=250，EAGAIN 单线程重试（当无内嵌搜索时启用） | ⚠️ `grep_search` | ⚠️ 部分 | **P1** | 接入 ripgrep/EAGAIN；见 B9.5 |
| 20 | `TaskCreateTool` | V2 文件系统任务创建（isTodoV2Enabled 时启用） | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.8 |
| 21 | `TaskUpdateTool` | V2 任务更新+认领，依赖管理(blocks/blockedBy) | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.8 |
| 22 | `TaskListTool` | V2 任务列表查询 | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.8 |
| 23 | `TaskGetTool` | V2 单任务查询 | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.8 |
| 24 | `WorktreeTool` | git worktree 管理：add/remove/list（isWorktreeModeEnabled 时启用） | ❌ 无 | ❌ 缺失 | **P2** | 新建，与 D2 联动；见 B10.9 |
| 25 | `SendMessageTool` | Agent 间消息发送（isAgentSwarmsEnabled 时启用） | ❌ 无 | ❌ 缺失 | **P2** | 新建，与 D4 联动；见 B10.10 |
| 26 | `ToolSearchTool` | 工具发现，加权关键词搜索，select: 直接选择（isToolSearchEnabled 时启用） | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.11 |
| 27 | `PowerShellTool` | Windows PowerShell 执行（isPowerShellToolEnabled 时启用） | ❌ 无 | ❌ 缺失 | **P3** | 暂不实现，Windows 支持低优 |

#### B8.3 Feature Flag 工具 — 6+ 个

| # | CCB 工具名 | 功能描述 | Rookie 对应工具 | 差距 | 优先级 | 改造要点 |
|---|---|---|---|---|---|---|
| 28 | `SleepTool` | 定时等待（KAIROS flag） | ❌ 无 | ❌ 缺失 | **P3** | 新建；见 B10.12 |
| 29 | `SendUserFileTool` | 向用户发送文件（KAIROS flag） | ❌ 无 | ❌ 缺失 | **P3** | 新建，预留 |
| 30 | `WebBrowserTool` | 浏览器自动化（WEB_BROWSER_TOOL flag） | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.13 |
| 31 | `SnipTool` | 历史消息裁剪，手动触发上下文压缩（HISTORY_SNIP flag） | ❌ 无 | ❌ 缺失 | **P2** | 新建；见 B10.14 |
| 32 | Coordinator Mode 工具集 | `dispatch_task`/`collect_result`/`scratchpad_write`（COORDINATOR_MODE flag） | ❌ 无 | ❌ 缺失 | **P2** | 与 D3 Coordinator Mode 一并实现 |
| 33 | Chrome Use 工具集 | Chrome 浏览器控制（截图/点击/输入） | ❌ 无 | ❌ 缺失 | **P3** | 远期规划 |

#### B8.4 Ant-only 工具 — 3 个

| # | CCB 工具名 | 功能描述 | Rookie 对应工具 | 差距 | 优先级 | 改造要点 |
|---|---|---|---|---|---|---|
| 34 | `REPLTool` | 交互式 REPL（Python/Node）| ❌ 无 | ❌ 缺失 | **P3** | 远期规划 |
| 35 | `ConfigTool` | 配置管理 | ❌ 无 | ❌ 缺失 | **P3** | 远期规划 |
| 36 | `TungstenTool` | 内部调试 | ❌ 无 | ❌ 缺失 | **P3** | 非必须 |

#### B8.5 对齐统计

| 类别 | 总数 | ✅ 已有 | ⚠️ 部分 | ❌ 缺失 |
|---|---|---|---|---|
| 固定工具 | 17 | 0 | 8 | 9 |
| 条件工具 | 10 | 0 | 2 | 8 |
| Feature Flag 工具 | 6 | 0 | 0 | 6 |
| Ant-only 工具 | 3 | 0 | 0 | 3 |
| **合计** | **36** | **0** | **10** | **26** |

> **关键结论**: Rookie 没有任何工具完全对齐 CCB（0 个 ✅），10 个部分对齐需要质量升级（B9），26 个完全缺失需要新建（B10）或远期规划。

---

### B9 · 现有工具质量升级

本节逐一列出 Rookie 现有 11 个工具需要升级的点，对标 CCB 同类工具的精细特性。

#### B9.1 file.ts — `file_read` / `file_write`

**对标**: CCB `FileReadTool` + `FileWriteTool`

**CCB 精细特性 vs Rookie 差距**:

| 特性 | CCB 实现 | Rookie 现状 | 差距 |
|---|---|---|---|
| 去重缓存(mtime) | 相同路径+相同 mtime 跳过重复读取，减少 token 消耗 | 每次调用都完整读取 | ❌ |
| 多模态分发 | 图片→base64，PDF→文本提取，Notebook→cell 渲染 | 仅文本读取 | ❌ |
| token 预算控制 | `maxTokens` 参数限制读取量，超出自动截断+提示 | 无限制，大文件全量读取 | ❌ |
| 二进制/设备文件屏蔽 | 检测 magic bytes，拒绝读取二进制/设备文件 | 尝试读取后乱码 | ❌ |
| 文件未找到智能建议 | 找不到文件时搜索相似路径并建议 | 返回简单错误 | ❌ |
| 行尾 LF 强制 | `FileWriteTool` 写入时确保文件以 `\n` 结尾 | 不做行尾处理 | ❌ |
| create/update 区分 | 明确 `create` vs `update` 语义，防止误覆盖 | 统一 `file_write`，无区分 | ❌ |
| structuredPatch diff | 写入后生成 unified diff 展示变更 | 无 diff 展示 | ❌ |

**升级清单**:
- [x] 引入 `fileReadCache: Map<string, { mtime: number, content: string }>` 去重缓存
- [x] 读取前检查 `stat.mtime`，相同则返回缓存内容并标注 `[cached]`
- [x] 新增 `readImage(path)` / `readPdf(path)` 分发函数，图片返回 base64，PDF 使用 `pdf-parse` 提取文本
- [x] 新增 `maxTokens?: number` 输入参数，超出时截断并追加 `[... truncated, showing first N tokens of M total ...]`
- [x] 读取前检查文件前 8 字节 magic bytes，匹配二进制格式(ELF/Mach-O/PE/ZIP)则拒绝并提示
- [x] 读取前检查 `stat.isBlockDevice()` / `stat.isCharacterDevice()`，拒绝设备文件
- [x] 文件未找到时调用 `glob_files` 搜索同目录下相似文件名，附加建议
- [x] `file_write` 写入前确保内容以 `\n` 结尾
- [x] `file_write` 新增 `mode: "create" | "update"` 参数，`create` 模式下目标已存在则报错
- [x] `file_write` 写入后生成 `structuredPatch` diff 并作为结果返回

> **状态**: ✅ 已完成基础升级 - 已实现 offset/limit/start_line/end_line 参数、isReadOnly/isDestructive 标记

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/file.ts`

**预估工时**: 3 人天

---

#### B9.2 edit.ts — `edit_apply_diff` / `edit_atomic_write`

**对标**: CCB `FileEditTool`

**CCB 精细特性 vs Rookie 差距**:

| 特性 | CCB 实现 | Rookie 现状 | 差距 |
|---|---|---|---|
| 引号标准化 | `findActualString()` 将弯引号 `""''` 转为直引号 `"'`，容错匹配 | 精确字符串匹配，弯引号不匹配 | ❌ |
| 同步临界区 | 整个读-改-写流程无 async 间隙，防止并发修改 | `execute()` 是 async，存在竞态窗口 | ❌ |
| mtime 防覆写 | 写入前校验 mtime，若外部修改则拒绝并提示 | 无 mtime 校验 | ❌ |
| MAX_EDIT_FILE_SIZE | 1GiB 限制，超出拒绝编辑 | 无大小限制，可能 OOM | ❌ |
| LSP 通知 | 编辑后发送 `didChange` 通知给 LSP 服务 | 无 LSP 集成 | ❌ |
| 多匹配消歧 | 当 old_string 在文件中出现多次时，使用行号上下文消歧 | 替换所有匹配或第一个 | ❌ |

**升级清单**:
- [ ] 实现 `findActualString(content, search)`: 先精确匹配，失败后将 `\u201c\u201d\u2018\u2019` 转为 `"'` 后重试
- [ ] 将读-改-写核心逻辑重构为同步函数 `applyEditSync(filePath, oldStr, newStr)`，仅文件 I/O 使用 async
- [ ] 读取文件时记录 `mtime`，写入前再次 `stat` 比较，不一致则抛出 `FileModifiedExternallyError`
- [ ] 文件大小超过 `MAX_EDIT_FILE_SIZE = 1 * 1024 * 1024 * 1024`（1GiB）时拒绝编辑
- [ ] 新增可选 `lspNotify?: (uri: string, changes: TextDocumentEdit) => void` 回调，编辑后调用
- [ ] 当 `old_string` 在文件中出现 2+ 次时，返回错误并附带各匹配位置的行号+上下文(±3行)

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/edit.ts`

**预估工时**: 2.5 人天

---

#### B9.3 shell.ts — `shell_execute`

**对标**: CCB `BashTool`

**CCB 精细特性 vs Rookie 差距**:

| 特性 | CCB 实现 | Rookie 现状 | 差距 |
|---|---|---|---|
| tree-sitter bash AST 解析 | 解析命令 AST，提取实际执行的程序名/参数 | 仅正则匹配命令名 | ❌ |
| 只读命令集(4类) | `info`(ls/cat/head等), `git-read`(git log/diff/status等), `search`(grep/find/rg等), `inspect`(file/stat等) 免审批 | 所有命令同等对待 | ❌ |
| 自动后台化(15s) | 执行超 15s 的命令自动转后台，返回 `taskId` 可后续查询 | 同步等待直到完成 | ❌ |
| 输出截断(30K chars) | 超出 30000 字符自动截断，保留头尾各 15K | 无截断，大输出导致 token 浪费 | ❌ |
| 进度流式(onProgress) | 每行 stdout 通过 `yield` 上报进度 | 无进度回调 | ❌ |
| 超时分级 | 默认 120s，用户 confirm 可延至 600s | 固定超时或无超时 | ❌ |
| 工作目录校验 | 确保 cwd 在允许范围内 | 不校验 cwd | ❌ |
| 环境变量白名单 | 仅传递安全环境变量 | 继承全部环境变量 | ❌ |

**升级清单**:
- [ ] 引入 `tree-sitter-bash` 或 `bash-parser` npm 包，实现 `parseCommand(cmd)` 提取程序名和参数
- [ ] 定义 4 类只读命令集:
  - `INFO_COMMANDS = ['ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'df', 'pwd', 'echo', 'date', 'whoami', 'uname', 'env', 'printenv']`
  - `GIT_READ_COMMANDS = ['git log', 'git diff', 'git status', 'git show', 'git branch', 'git tag', 'git remote', 'git rev-parse']`
  - `SEARCH_COMMANDS = ['grep', 'rg', 'find', 'fd', 'ag', 'ack', 'locate', 'which', 'type']`
  - `INSPECT_COMMANDS = ['file', 'stat', 'lsof', 'ps', 'top', 'htop', 'free', 'uptime']`
- [ ] 只读命令跳过权限确认，直接执行
- [ ] 实现自动后台化：执行 15s 后将进程转入后台，返回 `{ taskId, message: "命令已转入后台" }`
- [ ] 新增 `TaskOutputTool`（见 B10.5）查询后台任务输出
- [ ] 输出超过 30000 字符时截断为 `头部 15000 + "\n\n... [truncated N chars] ...\n\n" + 尾部 15000`
- [ ] 实现 `onProgress` 回调：每积累一行 stdout 就 yield 一次进度
- [ ] 超时分级：默认 `TIMEOUT_DEFAULT=120000`，收到 timeout 提示后可通过 `TIMEOUT_EXTENDED=600000` 延长
- [ ] 执行前校验 `cwd` 是否在 `projectRoot` 或允许的根目录列表内
- [ ] 实现环境变量白名单 `SAFE_ENV_KEYS`，仅传递白名单内的环境变量

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/shell.ts`

**预估工时**: 4 人天

---

#### B9.4 glob.ts — `glob_files`

**对标**: CCB `GlobTool`

**升级清单**:
- [x] 将 glob 引擎从 Node.js `glob` 替换为 `ripgrep --files --glob <pattern>` 子进程调用（速度提升 5-10x）
- [x] 新增 `sortBy?: "name" | "mtime" | "size"` 参数，默认 `mtime` 降序（最近修改优先）
- [x] 添加 `.gitignore` 自动尊重（ripgrep 默认行为）
- [x] 结果超过 1000 条时截断并提示 `[showing first 1000 of N matches]`
- [x] `isEnabled()` 条件：仅当无内嵌搜索引擎（如 Tantivy）时启用

> **状态**: ✅ 已完成基础升级 - 已实现 path/offset 参数、分页支持

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/glob.ts`

**预估工时**: 1 人天

---

#### B9.5 grep.ts — `grep_search`

**对标**: CCB `GrepTool`

**升级清单**:
- [x] 将 grep 引擎从 Node.js 内置替换为 `ripgrep` 子进程调用
- [x] 新增 `head_limit` 参数，默认 250 条匹配后停止搜索
- [x] 实现 EAGAIN 重试：当 ripgrep 返回 EAGAIN 错误（资源暂不可用）时，降为 `--threads 1` 单线程重试一次
- [x] 超时 20 秒后中止搜索并返回已有结果
- [x] 结果格式对齐 CCB：`path:line:column:match_text`
- [x] 自动尊重 `.gitignore`（ripgrep 默认行为）
- [x] `isEnabled()` 条件：仅当无内嵌搜索引擎时启用

> **状态**: ✅ 已完成基础升级 - 已实现 path/output/offset 参数，支持 "files" 输出模式

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/grep.ts`

**预估工时**: 1.5 人天

---

#### B9.6 web_fetch.ts — `web_fetch`

**对标**: CCB `WebFetchTool`

**CCB 精细特性 vs Rookie 差距**:

| 特性 | CCB 实现 | Rookie 现状 | 差距 |
|---|---|---|---|
| URL 缓存(15min LRU) | LRU 缓存，相同 URL 15 分钟内直接返回缓存 | 每次都发请求 | ❌ |
| 域名预检 API | 调用 `api.anthropic.com/api/web/domain_info` 检查域名可用性 | 无预检 | ❌ |
| Turndown HTML→Markdown | 使用 Turndown 库将 HTML 转换为干净 Markdown | 简单的 HTML strip 或直接返回 | ❌ |
| 预批准域名列表 | ~90 个常见域名免权限确认 | 所有域名同等对待 | ❌ |
| prompt 摘要(Haiku) | 大页面用 Haiku 模型生成摘要 | 无摘要 | ❌ |
| 10MB 响应上限 | 超过 10MB 拒绝下载 | 无大小限制 | ❌ |
| 重定向控制 | 最多 5 次重定向 | 无控制 | ❌ |

**升级清单**:
- [x] 引入 LRU 缓存（`lru-cache` npm），key 为 URL，TTL 为 15 分钟
- [x] 新增域名预检函数 `checkDomainAvailability(domain)`（可先用本地黑名单，远期接 API）
- [x] 引入 `turndown` npm 包，将 HTML 响应转换为 Markdown
- [x] 定义 `PREAPPROVED_DOMAINS: Set<string>`（约 90 个常见域名：github.com, stackoverflow.com, npmjs.com 等）
- [x] 预批准域名跳过权限确认
- [x] 大页面（>50K chars Markdown）调用轻量 LLM（如 Haiku）生成摘要
- [x] 响应体超过 10MB 时中止下载并返回错误
- [x] 设置 `maxRedirects: 5` 限制重定向次数

> **状态**: ✅ 已完成基础升级 - 已实现 max_length/start_index/raw 参数、HTML 转 Markdown

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/web_fetch.ts`

**预估工时**: 3 人天

---

#### B9.7 web_search.ts — `web_search`

**对标**: CCB `WebSearchTool`

**升级清单**:
- [x] 实现适配器工厂模式 `createSearchAdapter(provider: "duckduckgo" | "bing" | "brave" | "api")`
- [x] 新增 `BingSearchAdapter`：调用 Bing Web Search API v7
- [x] 新增 `BraveSearchAdapter`：调用 Brave Search API
- [x] 保留 `DuckDuckGoAdapter` 作为默认/免费 fallback
- [x] 通过 `ROOKIE_SEARCH_PROVIDER` 环境变量或 `settings.json` 的 `searchProvider` 字段选择
- [x] API key 通过 `BING_API_KEY` / `BRAVE_API_KEY` 环境变量传入
- [x] 新增域过滤 `excludeDomains?: string[]` 和 `includeDomains?: string[]` 输入参数
- [x] 搜索期间通过 `onProgress` 上报阶段（"搜索中…" → "解析结果…"）

> **状态**: ✅ 已完成基础升级 - 已实现 offset/recency_days 参数、最大 20 条结果限制

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/web_search.ts`

**预估工时**: 2.5 人天

---

#### B9.8 todo_write.ts — `todo_write`

**对标**: CCB `TodoWriteTool` (V1) + `TaskCreate/Update/List/Get` (V2)

**升级清单**:
- [ ] V1 增强：当 agent 创建 3+ 任务时，生成 nudge 消息提醒 agent 使用 todo 追踪进度
- [ ] V1 增强：验证任务状态转换合法性（不允许 `completed` → `pending`）
- [ ] 预留 V2 双轨架构入口：当 `isTodoV2Enabled` flag 开启时，`todo_write` 自动代理到 `TaskCreateTool`
- [ ] V2 任务持久化到 `.rookie/tasks/<sessionId>.json` 文件系统

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/todo_write.ts`

**预估工时**: 1.5 人天

---

#### B9.9 search.ts — `search_code`

**对标**: CCB 无直接对标（CCB 依赖 GlobTool + GrepTool 组合）

**升级清单**:
- [ ] 当 Tantivy 索引不可用时，优雅降级为 `GrepTool` + `GlobTool` 组合
- [ ] 搜索结果中包含文件 mtime，支持按新鲜度排序
- [ ] 新增 `fileTypeFilter?: string[]` 参数（如 `[".ts", ".tsx"]`）

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/search.ts`

**预估工时**: 1 人天

---

#### B9.10 git.ts — `git_*` 工具集

**对标**: CCB 无独立 git 工具（git 操作通过 `BashTool` 执行）

**升级清单**:
- [ ] `git_diff` 输出增加行号标注
- [ ] `git_log` 支持 `--oneline --graph` 紧凑格式
- [ ] `git_commit` 支持 `--amend` 选项
- [ ] 新增 `git_stash` 子命令（save/pop/list）
- [ ] 所有 git 命令标记为 `isReadOnly`（除 commit/checkout/branch create 外）

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/git.ts`

**预估工时**: 1 人天

---

#### B9.11 notebook.ts — `notebook_read` / `notebook_edit`

**对标**: CCB `NotebookEditTool`

**升级清单**:
- [ ] 支持 cell 级精确操作（insert_cell/delete_cell/replace_cell/move_cell）
- [ ] 支持 cell 输出清除（clear_outputs）
- [ ] 支持 kernel 选择元数据修改

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/notebook.ts`

**预估工时**: 1 人天

---

#### B9 升级工作量汇总

| 工具 | 预估工时 | 优先级 |
|---|---|---|
| file.ts | 3 人天 | P0 |
| edit.ts | 2.5 人天 | P0 |
| shell.ts | 4 人天 | P0 |
| glob.ts | 1 人天 | P1 |
| grep.ts | 1.5 人天 | P1 |
| web_fetch.ts | 3 人天 | P1 |
| web_search.ts | 2.5 人天 | P1 |
| todo_write.ts | 1.5 人天 | P2 |
| search.ts | 1 人天 | P2 |
| git.ts | 1 人天 | P2 |
| notebook.ts | 1 人天 | P2 |
| **合计** | **22 人天** | |

---

### B10 · 全新工具开发清单

本节列出 Rookie 完全缺失、需要从零开发的工具。

#### B10.1 AgentTool — 子 Agent 调度

**功能描述**: 允许当前 agent 创建并调度子 agent 执行子任务。支持三种模式：in-process（函数调用）、child_process（独立进程）、remote（HTTP/MCP 远程调用）。子 agent 可使用 worktree 隔离工作目录，避免并发写入冲突。

**输入 Schema 概要**:
```
{
  task: string,           // 子任务描述
  agentName?: string,     // 子 agent 名称
  mode?: "in-process" | "child" | "remote",
  tools?: string[],       // 允许的工具白名单
  worktree?: boolean,     // 是否使用 worktree 隔离
  timeout?: number        // 超时（ms）
}
```

**输出 Schema 概要**:
```
{
  agentId: string,
  result: string,
  toolCalls: number,
  tokensUsed: number,
  duration: number
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/agent.ts`（新建）✅
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/subagent.ts`（扩展三路径调度）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/types.ts`（新增 AgentMode）

**优先级**: **P0**
**预估工时**: 4 人天
**依赖**: D1 跨进程 Subagent

> **状态**: ✅ 已完成 - 已实现 `AgentTool` 和 `createAgentTool` 工厂函数，支持子 Agent 调度

---

#### B10.2 AskUserQuestionTool — 向用户提问

**功能描述**: 允许 agent 在执行过程中主动向用户提问并等待回复。中断 agent loop，在 TUI 中展示问题并等待用户输入，收到回复后恢复执行。适用于需要用户确认、提供额外信息或消歧义的场景。

**输入 Schema 概要**:
```
{
  question: string,           // 向用户提出的问题
  options?: string[],         // 可选的选项列表
  defaultAnswer?: string,     // 默认答案
  timeout?: number            // 等待超时（ms），默认无限
}
```

**输出 Schema 概要**:
```
{
  answer: string,
  timedOut: boolean
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/ask_user.ts`（新建）✅
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/UserQuestionPanel.tsx`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/react.ts`（适配中断/恢复）

**优先级**: **P1**
**预估工时**: 2 人天

> **状态**: ✅ 已完成 - 已实现 `AskUserQuestionTool` 和 `createAskUserQuestionTool` 工厂函数

---

#### B10.3 SkillTool — 技能执行

**功能描述**: 执行预定义的技能（skill）。技能是预先编写的 prompt+工具组合模板，允许 agent 调用高级复合操作（如"重构函数"、"添加测试"等）。`alwaysLoad` 属性确保该工具始终在工具列表中可见。结果上限 100K chars。

**输入 Schema 概要**:
```
{
  skillName: string,          // 技能名称
  args?: Record<string, unknown>,  // 技能参数
}
```

**输出 Schema 概要**:
```
{
  result: string,             // 技能执行结果（最多 100K chars）
  toolCalls: number,
  success: boolean
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/skill.ts`（新建）✅
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/skills/`（新建技能目录）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/skills/registry.ts`（新建技能注册表）

**优先级**: **P2**
**预估工时**: 3 人天

> **状态**: ✅ 已完成 - 已实现 `SkillTool` 和 `createSkillTool` 工厂函数，集成 SkillRegistry

---

#### B10.4 EnterPlanModeTool / ExitPlanModeTool — 计划模式切换

**功能描述**: `EnterPlanModeTool` 切换 agent 进入计划模式，此时仅允许只读工具（file_read, grep, glob, search_code, web_search 等），所有写工具被禁用。`ExitPlanModeTool` 恢复完整工具集。与 A4 Plan Mode 只读强化联动。

**输入 Schema 概要**:
```
// EnterPlanModeTool
{ reason?: string }  // 进入计划模式的原因

// ExitPlanModeTool
{ plan?: string }    // 退出时可附带生成的计划
```

**输出 Schema 概要**:
```
{
  mode: "plan" | "normal",
  availableTools: string[]    // 当前可用工具列表
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/plan_mode.ts`（新建）✅
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`（适配 setReadOnly）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/PlanPanel.tsx`（联动）

**优先级**: **P1**
**预估工时**: 1.5 人天
**依赖**: A4 Plan Mode 只读强化

> **状态**: ✅ 已完成 - 已实现 `PlanModeTool` 和 `createPlanModeTool` 工厂函数，支持全局计划模式状态管理

---

#### B10.5 TaskOutputTool — 后台任务输出查询

**功能描述**: 查询后台运行任务的输出。当 shell 命令被自动后台化（执行超 15s）后，agent 可通过此工具获取任务状态和已产生的输出。也可查询其他 agent 的任务输出。

**输入 Schema 概要**:
```
{
  taskId: string,             // 任务 ID
  offset?: number,            // 从第 N 个字符开始读取
  maxChars?: number           // 最多返回字符数
}
```

**输出 Schema 概要**:
```
{
  taskId: string,
  status: "running" | "completed" | "failed",
  output: string,
  exitCode?: number,
  totalChars: number
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/task_output.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/shell.ts`（后台任务注册）

**优先级**: **P2**
**预估工时**: 1.5 人天
**依赖**: B9.3 shell.ts 自动后台化

---

#### B10.6 BriefTool — 简要输出模式

**功能描述**: 指示 agent 切换到简要输出模式。在此模式下 agent 压缩回复长度，省略冗余说明，仅输出关键信息。适用于批量操作或脚本模式下减少 token 消耗。

**输入 Schema 概要**:
```
{
  enabled: boolean            // true 开启简要模式，false 关闭
}
```

**输出 Schema 概要**:
```
{
  briefMode: boolean,
  message: string
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/brief.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/react.ts`（注入 brief 指令到 system prompt）

**优先级**: **P3**
**预估工时**: 0.5 人天

---

#### B10.7 ListMcpResourcesTool / ReadMcpResourceTool — MCP 资源操作

**功能描述**: `ListMcpResourcesTool` 列出所有已连接 MCP 服务器暴露的资源（prompts、resources、resource templates）。`ReadMcpResourceTool` 读取指定资源的内容。这两个工具让 agent 能够发现和利用 MCP 生态中的丰富资源。

**输入 Schema 概要**:
```
// ListMcpResourcesTool
{
  serverName?: string,        // 可选，仅列出指定服务器的资源
  resourceType?: "prompt" | "resource" | "template"
}

// ReadMcpResourceTool
{
  serverName: string,
  resourceUri: string,        // 资源 URI
  arguments?: Record<string, string>  // 模板参数
}
```

**输出 Schema 概要**:
```
// ListMcpResourcesTool
{
  resources: Array<{ server: string, name: string, uri: string, type: string, description?: string }>
}

// ReadMcpResourceTool
{
  content: string,
  mimeType: string
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/mcp_resources.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/mcp/client.ts`（扩展资源查询 API）

**优先级**: **P2**
**预估工时**: 2 人天
**依赖**: B2 MCP 自动注册

---

#### B10.8 TaskCreate / TaskUpdate / TaskList / TaskGet — V2 任务系统

**功能描述**: V2 文件系统任务管理工具集。与 V1 `TodoWriteTool` 的内存全量替换不同，V2 使用文件系统持久化，支持任务之间的依赖关系（blocks/blockedBy），多 agent 可同时操作任务池。每个任务有 assignee 字段，agent 可以认领（claim）任务。

- `TaskCreateTool`: 创建任务，指定 title/description/priority/blocks/blockedBy
- `TaskUpdateTool`: 更新任务状态/内容/认领，自动维护依赖链
- `TaskListTool`: 查询任务列表，支持按状态/优先级/assignee 过滤
- `TaskGetTool`: 查询单个任务详情（含依赖链和变更历史）

**输入 Schema 概要**:
```
// TaskCreateTool
{
  title: string,
  description?: string,
  priority?: "P0" | "P1" | "P2" | "P3",
  blocks?: string[],          // 此任务阻塞的任务 ID
  blockedBy?: string[],       // 阻塞此任务的任务 ID
  assignee?: string           // 认领人（agent 名）
}

// TaskUpdateTool
{
  taskId: string,
  status?: "pending" | "in_progress" | "completed" | "blocked",
  assignee?: string,
  result?: string             // 完成时的结果摘要
}

// TaskListTool
{
  status?: string,
  assignee?: string,
  priority?: string
}

// TaskGetTool
{
  taskId: string
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/tasks_v2.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tasks/`（新建任务存储目录）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tasks/store.ts`（新建文件系统 task store）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tasks/types.ts`（新建任务类型）

**优先级**: **P2**
**预估工时**: 4 人天

---

#### B10.9 WorktreeTool — git worktree 管理

**功能描述**: 管理 git worktree，支持 add/remove/list 操作。与 D2 Worktree 隔离联动，为子 agent 提供独立工作目录。Worktree 创建后自动记录到 `.rookie/worktrees/` 目录中，退出时自动清理。

**输入 Schema 概要**:
```
{
  action: "add" | "remove" | "list",
  name?: string,              // worktree 名称（add/remove 时必需）
  branch?: string,            // 分支名（add 时可选）
  sparseCheckout?: string[]   // 仅检出的子目录（add 时可选）
}
```

**输出 Schema 概要**:
```
{
  worktrees: Array<{ name: string, path: string, branch: string, status: string }>
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/worktree.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/git.ts`（扩展 worktree 底层）

**优先级**: **P2**
**预估工时**: 2 人天
**依赖**: D2 Worktree 隔离

---

#### B10.10 SendMessageTool — Agent 间消息发送

**功能描述**: 在多 agent 场景下，允许一个 agent 向另一个 agent 发送消息。消息通过 Blackboard（共享消息板）传递，接收方在下一轮迭代中读取。支持广播（发给所有 agent）和定向发送。

**输入 Schema 概要**:
```
{
  to: string | "broadcast",  // 目标 agent 名称或 "broadcast"
  message: string,
  priority?: "normal" | "urgent"
}
```

**输出 Schema 概要**:
```
{
  delivered: boolean,
  messageId: string
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/send_message.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/blackboard.ts`（扩展消息队列）

**优先级**: **P2**
**预估工时**: 1.5 人天
**依赖**: D4 Pipe IPC

---

#### B10.11 ToolSearchTool — 工具发现

**功能描述**: 允许 agent 搜索可用工具。使用加权关键词搜索匹配工具的 name、description、aliases、searchHint。支持 `select` 操作直接选择一个 deferred 工具加载到当前会话中。当工具数量多（50+）时，避免在 system prompt 中列出全部工具。

**输入 Schema 概要**:
```
{
  query: string,              // 搜索关键词
  action?: "search" | "select",  // search: 搜索，select: 直接选择加载
  toolName?: string           // select 时指定工具名
}
```

**输出 Schema 概要**:
```
{
  results: Array<{ name: string, description: string, relevance: number }>,
  selected?: string           // select 模式时返回已加载的工具名
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/tool_search.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`（扩展搜索 API）

**优先级**: **P2**
**预估工时**: 2 人天
**依赖**: B1 Tool 泛型（需要 searchHint/aliases 字段）

---

#### B10.12 SleepTool — 定时等待

**功能描述**: 允许 agent 暂停执行指定时长。用于轮询场景（等待 CI 完成、等待文件出现等）。最大等待时间 300 秒。

**输入 Schema 概要**:
```
{
  seconds: number,            // 等待秒数（1-300）
  reason?: string             // 等待原因（用于日志）
}
```

**输出 Schema 概要**:
```
{
  sleptSeconds: number,
  message: string
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/sleep.ts`（新建）✅

**优先级**: **P3**
**预估工时**: 0.5 人天

> **状态**: ✅ 已完成 - 已实现 `SleepTool` 和 `createSleepTool` 工厂函数，支持 1-60 秒等待

---

#### B10.13 WebBrowserTool — 浏览器自动化

**功能描述**: 通过 Playwright 或 Puppeteer 控制无头浏览器。支持页面导航、元素点击、表单填写、截图、JavaScript 执行等操作。用于需要交互式 Web 操作的场景（如登录、表单提交、动态页面抓取）。

**输入 Schema 概要**:
```
{
  action: "navigate" | "click" | "type" | "screenshot" | "evaluate" | "wait",
  url?: string,              // navigate 时
  selector?: string,         // click/type/wait 时
  text?: string,             // type 时
  script?: string,           // evaluate 时
  timeout?: number
}
```

**输出 Schema 概要**:
```
{
  success: boolean,
  pageTitle?: string,
  pageUrl?: string,
  screenshot?: string,       // base64 PNG
  evaluateResult?: unknown,
  error?: string
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/web_browser.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/browser/`（新建浏览器管理目录）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/browser/manager.ts`（新建浏览器生命周期管理）

**优先级**: **P2**
**预估工时**: 4 人天

---

#### B10.14 SnipTool — 历史消息裁剪

**功能描述**: 允许 agent 手动触发历史消息裁剪。当对话变长但 agent 判断早期对话不再相关时，可调用此工具裁剪旧消息，释放 context window 空间。与 B6 上下文预处理管道中的 `snipCompact` 配合使用。

**输入 Schema 概要**:
```
{
  keepLastN?: number,         // 保留最近 N 条消息
  keepTokens?: number,        // 保留最近 N 个 token 的消息
  reason?: string             // 裁剪原因
}
```

**输出 Schema 概要**:
```
{
  snippedMessages: number,
  snippedTokens: number,
  remainingMessages: number,
  remainingTokens: number
}
```

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/snip.ts`（新建）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/compactor.ts`（扩展手动裁剪入口）

**优先级**: **P2**
**预估工时**: 1.5 人天
**依赖**: B6 上下文预处理管道

---

#### B10 新工具开发工作量汇总

| # | 工具 | 预估工时 | 优先级 | 依赖 |
|---|---|---|---|---|
| B10.1 | AgentTool | 4 人天 | P0 | D1 |
| B10.2 | AskUserQuestionTool | 2 人天 | P1 | 无 |
| B10.3 | SkillTool | 3 人天 | P2 | 无 |
| B10.4 | EnterPlanModeTool / ExitPlanModeTool | 1.5 人天 | P1 | A4 |
| B10.5 | TaskOutputTool | 1.5 人天 | P2 | B9.3 |
| B10.6 | BriefTool | 0.5 人天 | P3 | 无 |
| B10.7 | ListMcpResourcesTool / ReadMcpResourceTool | 2 人天 | P2 | B2 |
| B10.8 | TaskCreate/Update/List/Get (V2) | 4 人天 | P2 | 无 |
| B10.9 | WorktreeTool | 2 人天 | P2 | D2 |
| B10.10 | SendMessageTool | 1.5 人天 | P2 | D4 |
| B10.11 | ToolSearchTool | 2 人天 | P2 | B1 |
| B10.12 | SleepTool | 0.5 人天 | P3 | 无 |
| B10.13 | WebBrowserTool | 4 人天 | P2 | 无 |
| B10.14 | SnipTool | 1.5 人天 | P2 | B6 |
| **合计** | | **30 人天** | | |

---

### Phase-B Exit Criteria

| 指标 | 达标条件 |
|---|---|
| Tool 泛型 | 所有内置工具使用 `buildTool()` 创建，输入自动 Zod 校验，35 字段接口覆盖 |
| MCP 自动注册 | 配置一个 MCP 服务后工具自动可用 |
| 并行执行 | 只读工具并行，写工具串行互斥 |
| 文件历史 | `/undo` 可回滚最近 100 次编辑 |
| Shell 沙箱 | Linux/macOS 上 shell 默认受沙箱限制 |
| 上下文管道 | 5 级管道全部就位，长会话不 OOM |
| 权限 8 源 | CLI 参数 / 环境变量 / 策略文件均可控制权限 |
| CCB 全量对齐 | B8 清单中 P0/P1 工具全部完成对齐，⚠️ 状态 ≤ 3 个 |
| 现有工具升级 | B9 中 P0 工具（file/edit/shell）升级完毕 |
| 新工具开发 | B10 中 P0/P1 工具（AgentTool/AskUser/PlanMode）开发完毕 |

---

## 4. Hooks 系统对齐路线（Phase-C）

### C1 · 异步 Hook + asyncRewake

CCB 的 hook 系统支持长耗时审批场景：hook 可返回 `async: true` 表示需要异步等待，主循环继续执行其他任务，待 hook 完成后通过 `rewakeToken` 唤醒恢复。Rookie 的 `HookRegistry.fire()` 要么全阻塞要么 fire-and-forget，没有中间状态。

- [ ] `HookResult` 新增 `async?: boolean` 和 `rewakeToken?: string` 字段
- [ ] `HookRegistry.fire()` 遇到 `async: true` 时将 hook 放入待唤醒队列并立即返回
- [ ] 新增 `HookRegistry.rewake(token: string, result: HookResult)` 方法
- [ ] `runReAct` 循环在每次迭代开头检查待唤醒队列

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/react.ts`

**验收标准**: 一个标记 `async: true` 的 hook 不阻塞 `runReAct` 主循环；hook 完成后通过 `rewake()` 将结果注入下一轮迭代。

---

### C2 · 结构化 LLM 判定

CCB 的 LLM 钩子返回 `hookSpecificOutput` 强类型 JSON 对象 `{ decision, reason, modifiedInput? }`，而非自由文本。Rookie 当前用 `promptLooksRejected()` 函数通过正则 `/\b(reject|deny|denied|block|blocked)\b/i` 匹配来判定 LLM 回复是否为拒绝。

- [x] LLM prompt hook 的 system prompt 中强制要求返回 JSON `{ decision: "allow"|"reject", reason: string, modifiedInput?: object }`
- [x] `runPrompt()` 返回值改为 `{ output: string; parsed: HookLLMDecision; rejected: boolean }`
- [x] 删除 `promptLooksRejected()` 正则函数
- [x] 添加 JSON 解析失败的 fallback（降级为 reject + 日志告警）

> **状态**: ✅ 已完成（之前已实现）- 结构化 LLM 判定系统已就位

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/types.ts`

**验收标准**: LLM hook 返回的是结构化 JSON 而非自由文本；`promptLooksRejected()` 函数已删除。

---

### C3 · 链式 Pipeline

CCB 允许 `PreToolUse` hook 通过 `modifiedInput` 字段修改工具输入后传递给下一个 hook，形成链式管道。`PostToolUse` hook 同理可修改输出。Rookie 的 hook 只能观察或拒绝，不能修改。

- [ ] `HookResult` 新增 `modifiedInput?: Record<string, unknown>` 和 `modifiedOutput?: string`
- [ ] `HookRegistry.fire("PreToolUse", ctx)` 中若某 hook 返回 `modifiedInput`，后续 hook 和实际工具执行使用修改后的输入
- [ ] `HookRegistry.fire("PostToolUse", ctx)` 中若某 hook 返回 `modifiedOutput`，最终返回修改后的输出
- [ ] `ToolRegistry.invoke()` 适配链式结果

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/registry.ts`

**验收标准**: 一个 `PreToolUse` hook 将 `file_write` 的 `path` 参数从 `/tmp/a.txt` 改为 `/tmp/b.txt`，实际写入目标为 `/tmp/b.txt`。

---

### C4 · hookDedupKey 去重

CCB 按 `(event, matcher, inputHash)` 三元组对 hook 触发进行去重，避免同一输入在短时间内重复触发相同 hook。Rookie 无去重机制，每次都完整执行。

- [ ] `HookRegistry` 内部维护 `recentFires: Map<string, number>` 最近触发时间戳
- [ ] 去重 key = `${event}::${matcher}::${sha256(JSON.stringify(input)).slice(0,16)}`
- [ ] 500ms 内相同 key 的触发直接返回上次结果
- [ ] 可通过 `HookConfig.dedup?: false` 关闭单条 hook 的去重

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/types.ts`

**验收标准**: 在 500ms 内连续两次触发相同 `PreToolUse` hook（相同工具名、相同输入），第二次直接返回缓存结果且不执行 shell/HTTP/LLM。

---

### C5 · if-condition 声明式 Matcher

CCB 允许在 `HookConfig` 中使用 `if` 字段编写声明式条件表达式。Rookie 当前仅支持 `matcher` 字段做工具名 glob 匹配。

- [ ] `HookConfig` 新增 `if?: string` 字段
- [ ] 实现受限表达式求值器（基于 jsonata 或安全子集 JS）
- [ ] 表达式上下文包含 `{ toolName, toolInput, projectRoot, sessionId }`
- [ ] `matcher` 保留为快捷方式，`if` 优先级更高

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/registry.ts`

**验收标准**: 配置 `"if": "toolInput.path starts with '/etc'"` 后，仅当工具输入路径以 `/etc` 开头时触发该 hook。

---

### C6 · Trust 机制

CCB 通过 `shouldSkipHookDueToTrust` 在用户首次进入项目时弹出信任对话框，未信任的项目只执行全局 hook，不执行项目级 hook。Rookie 无信任机制，所有项目级 hook 直接执行。

- [ ] 首次进入含 `.rookie/settings.json` 的项目时弹出信任确认
- [ ] 信任状态持久化到 `~/.rookie/trusted-projects.json`
- [ ] 未信任项目：跳过 project-level hook，仅执行 global hook
- [ ] `HookRegistry.fire()` 中检查 trust 状态

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/registry.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/config/settings.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/components/ApprovalPanel.tsx`（信任对话框）

**验收标准**: clone 一个新项目后首次运行 `rookie code`，弹出"信任此项目？"对话框；选择"否"后该项目的 hook 全部被跳过。

---

### C7 · 新增事件补齐

CCB 的 hook 系统覆盖了 subagent 生命周期、空闲检测等事件。Rookie 当前的 `HookEvent` 类型虽然已有 12 种事件，但缺少 subagent 和 proactive 相关事件。

- [ ] `HookEvent` 新增 `SubagentStart` / `SubagentStop` 事件
- [ ] `HookEvent` 新增 `TeammateIdle` 事件（当 orchestrator 检测到某子 agent 空闲时触发）
- [ ] `HookEvent` 新增 `ProactiveTick` 事件（定时心跳，供外部监控）
- [ ] 在 `SubagentManager.delegate()` 和 `AgentOrchestrator` 中埋入相应 hook 调用

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/hooks/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/subagent.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/orchestrator.ts`

**验收标准**: 注册一个 `SubagentStart` hook 后，调用 `SubagentManager.delegate()` 时该 hook 被正确触发。

---

### Phase-C Exit Criteria

| 指标 | 达标条件 |
|---|---|
| 异步 Hook | `async: true` hook 不阻塞主循环 |
| 结构化 LLM | `promptLooksRejected` 已删除，LLM hook 返回 JSON |
| 链式 Pipeline | `PreToolUse` hook 可修改工具输入且下游生效 |
| 去重 | 500ms 内重复触发被抑制 |
| if-condition | 声明式条件表达式生效 |
| Trust | 未信任项目的 project hook 被跳过 |
| 新事件 | SubagentStart/Stop/TeammateIdle/ProactiveTick 均可订阅 |

---

## 5. 多 Agent 协作对齐路线（Phase-D）

### D1 · 跨进程 Subagent（MCP Stdio 复用）

CCB 的 `AgentTool.call` 支持三条路径：in-process（函数调用）、child_process（独立进程）、remote（HTTP/MCP）。Rookie 的 `SubagentManager` 仅支持 in-process 的 fork/shared 模式。

- [ ] `SubagentConfig` 新增 `contextMode: "process"` 选项
- [ ] `"process"` 模式下通过 `child_process.spawn` 启动独立 Node 进程
- [ ] 父子进程通过 MCP JSON-RPC over stdio 通信
- [ ] 子进程标记 `querySource: "subagent"` 防止递归 spawn
- [ ] 双层防递归：子进程再 spawn 时检查深度并拒绝超过 3 层

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/subagent.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/mcp/stdio-transport.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/types.ts`

**验收标准**: 配置 `contextMode: "process"` 的子 agent 在独立进程中运行，父进程通过 stdio 接收其事件流；嵌套超过 3 层时拒绝 spawn。

---

### D2 · Worktree 隔离

CCB 使用 `git worktree` 为每个子任务创建隔离工作目录，通过 `countWorktreeChanges` 统计变更并采用 fail-closed 策略。Rookie 所有 agent 共享同一工作目录，并发写入存在冲突风险。

- [ ] 新增 `EnterWorktree` / `ExitWorktree` 工具
- [ ] `EnterWorktree` 调用 `git worktree add .rookie/worktrees/<slug> -b rookie/<slug>`
- [ ] 支持 sparse checkout 仅检出任务相关子目录
- [ ] `ExitWorktree` 执行 `git worktree remove` 并将变更 cherry-pick 回主分支
- [ ] fail-closed：worktree 创建失败则整个子任务 abort

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/tools/builtin/git.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/subagent.ts`

**验收标准**: parallel 模式下两个子 agent 同时修改不同文件，各自在独立 worktree 中操作，最终变更合并回主分支无冲突。

---

### D3 · Coordinator Mode

CCB 拥有专用的 Coordinator 模式，协调者 agent 使用 XML `task-notification` 协议分配任务给 worker agent，worker 仅能使用 `INTERNAL_WORKER_TOOLS` 白名单中的工具。Rookie 的 `OrchestratorMode` 有 sequential/parallel/adaptive/gan 四种，但缺少 coordinator。

- [ ] 新增 `AgentMode.coordinator` 模式
- [ ] 定义 `INTERNAL_WORKER_TOOLS` 白名单（file_read, grep, glob, search_code）
- [ ] Coordinator agent 拥有 `dispatch_task` / `collect_result` / `scratchpad_write` 工具
- [ ] Scratchpad 落盘到 `.rookie/scratchpad/<session_id>.md`
- [ ] `orchestrator.runCoordinator(task)` 入口方法

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/orchestrator.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/types.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/commands/builtin.ts`（新增 /coordinator 命令）

**验收标准**: 启动 coordinator 模式后，coordinator agent 成功将任务拆分为子任务并分派给 worker；worker 仅能使用白名单工具。

---

### D4 · Pipe IPC / LAN 群控

CCB 支持同机多实例通过 Unix socket 通信（`/pipes` 面板列出所有实例），跨机器通过 mDNS 零配置发现并建立通信。Rookie 当前各实例完全独立，无进程间通信。

- [ ] 创建 `~/.rookie/pipes/` 目录，每个 Rookie 实例启动时注册 Unix socket
- [ ] 新增 `/pipes` 斜杠命令，列出同机所有活跃 Rookie 实例
- [ ] 实现 `sendToPipe(instanceId, message)` 跨实例消息发送
- [ ] `FEATURE_LAN=1` 环境变量启用 mDNS（基于 `bonjour-service`）跨机器发现

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/` (新建 `pipes/` 目录)
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/commands/builtin.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/commands/code.ts`（启动时注册 pipe）

**验收标准**: 同时运行两个 Rookie 实例，在实例 A 中执行 `/pipes` 可见实例 B；向实例 B 发送消息后 B 的 TUI 中出现通知。

---

### D5 · Transcript 持久化 + /resume

CCB 通过 `recordTranscript` 将完整对话（含工具调用）持久化为 JSONL，支持 `--resume <id>` 从中断点恢复会话。Rookie 有 `resume.ts` CLI 命令框架但无实际 transcript 文件。

- [ ] 每次会话自动生成 `~/.rookie/transcripts/<sessionId>.jsonl`
- [ ] 每条记录包含 `{ timestamp, role, content, toolCalls?, toolResults? }`
- [ ] `rookie code --resume <sessionId>` 加载 transcript 并恢复对话上下文
- [ ] `--fork` 标志创建新会话但继承旧 transcript 作为历史
- [ ] `/history` 斜杠命令列出最近 20 个 transcript

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/commands/resume.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/harness/session.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/react.ts`

**验收标准**: 会话结束后 `~/.rookie/transcripts/` 中存在 JSONL 文件；`rookie code --resume <id>` 恢复后模型可见之前的对话历史。

---

### D6 · Scheduler Daemon + 重启恢复

CCB 内置 `workerRegistry` 守护进程管理，支持 `EXIT_CODE_PERMANENT=78` 标记不可恢复的失败，并在意外退出时自动以指数回退重启。Rookie 的 `scheduler/` 有 parser/store/types 但无守护进程。

- [ ] 新建 `scheduler/daemon.ts`，实现进程级 cron-like 守护循环
- [ ] 支持指数回退重启（初始 1s → 2s → 4s → ... → 最大 5min）
- [ ] `EXIT_CODE_PERMANENT=78` 标记永久失败，不再重启
- [ ] 启动时扫描 `~/.rookie/scheduler/pending/` 恢复未完成任务
- [ ] 日志输出到 `~/.rookie/scheduler/logs/`

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/scheduler/index.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/scheduler/` (新建 `daemon.ts`)
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/scheduler/store.ts`

**验收标准**: 调度器中注册一个 5 分钟后执行的任务后终止进程，重新启动后该任务自动恢复并按时执行。

---

### D7 · LLM-as-Judge 评估器

CCB 使用 LLM 作为评判器对 agent 输出质量进行自动评估，支持 pairwise 比较。Rookie 的 `evaluator.ts` 有基础评分框架但未接入 LLM。

- [ ] `EvaluatorAgent` 新增 `llmJudge` 模式，向评判 LLM 发送 plan + output + rubric
- [ ] 支持 pairwise 比较：给出 A/B 两个输出让 LLM 选择更优
- [ ] 评估结果结构化输出 `{ score: number, reasoning: string, preference?: "A"|"B" }`
- [ ] 与 GAN 模式的 evaluator 阶段集成

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/evaluator.ts`
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-sdk/src/agent/orchestrator.ts`（GAN 模式集成）

**验收标准**: GAN 模式下 evaluator 使用 LLM 判定输出质量，返回结构化 JSON 评分和推理过程。

---

### D8 · TUI 多 Agent 可视化

CCB 在多 agent 场景下提供专用面板，展示每个子 agent 的运行状态、进度、token 消耗、工具调用次数等。Rookie 的 TUI 没有针对多 agent 的可视化。

- [ ] 新建 `AgentPanel.tsx` 组件，以表格形式展示所有活跃 agent
- [ ] 每行显示：agent 名称、状态(idle/running/done/error)、token 消耗、工具调用次数、当前任务摘要
- [ ] Mailbox 广播面板：展示 agent 间通过 Blackboard 交换的消息
- [ ] 在 `TuiMode` 中新增 `"agents"` 模式，快捷键 `Ctrl+A` 切换

**涉及文件**:
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/` (新建 `components/AgentPanel.tsx`)
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/types.ts`（TuiMode 新增 "agents"）
- `/Users/bytedance/Documents/douyin/Rookie-Agent/packages/rookie-cli/src/tui/hooks/useTuiState.ts`

**验收标准**: orchestrator parallel 模式下切换到 agents 面板可见每个子 agent 的实时状态和统计信息。

---

### Phase-D Exit Criteria

| 指标 | 达标条件 |
|---|---|
| 跨进程 Subagent | child_process 模式 spawn 成功，stdio 通信正常 |
| Worktree | 并行写入不同文件无冲突 |
| Coordinator | coordinator 成功拆分并分派子任务 |
| Pipe IPC | 同机两实例互相可见 |
| Transcript | 会话 JSONL 持久化且 resume 可恢复 |
| Scheduler | 进程重启后自动恢复未完成调度任务 |
| LLM Judge | GAN 模式使用 LLM 评判 |
| Agent Panel | TUI 中可见多 agent 实时状态 |

---

## 6. 综合优先级排期

### 阶段一 Quick Wins（1~2 周）

立即可做、收益最大、依赖最少的任务。

| 编号 | 任务 | 预估工时（人天） | 依赖 |
|---|---|---|---|
| A1 | 流式中断与假死恢复 | 1.5 | 无 |
| A5 | Permission denial 抑制 | 1 | 无 |
| A8 | 遗留 REPL 清理 | 0.5 | 无 |
| B4 | 文件历史 Snapshot | 2 | 无 |
| B9-file | file.ts 质量升级（去重/多模态/token 预算） | 3 | 无 |
| B9-edit | edit.ts 质量升级（引号标准化/mtime/1GiB） | 2.5 | 无 |
| B9-shell | shell.ts 质量升级（AST/只读/后台化/截断） | 4 | 无 |
| C2 | 结构化 LLM 判定 | 1.5 | 无 |
| C4 | hookDedupKey 去重 | 1 | 无 |
| D5 | Transcript 持久化 + /resume | 2 | 无 |
| **小计** | | **19** | |

### 阶段二 Core Alignment（3~4 周）

核心差距弥合，需要较多重构。

| 编号 | 任务 | 预估工时（人天） | 依赖 |
|---|---|---|---|
| A2 | 工具进度通道 | 2 | B1 (Tool 泛型) |
| A3 | 主题化系统 | 2.5 | 无 |
| A4 | Plan Mode 只读强化 | 1.5 | 无 |
| A6 | 多 Lane 并行事件流 | 2 | B3 (并行执行) |
| B1 | Tool<I,O,P> 结构化泛型（35 字段） | 4 | 无 |
| B2 | MCP 自动注册 | 2 | B1 |
| B3 | StreamingToolExecutor 并行执行 | 2.5 | B1 |
| B6 | 上下文预处理管道 | 3 | 无 |
| B9-glob | glob.ts 质量升级（ripgrep/mtime） | 1 | 无 |
| B9-grep | grep.ts 质量升级（ripgrep/EAGAIN） | 1.5 | 无 |
| B9-webfetch | web_fetch.ts 质量升级（缓存/Turndown/摘要） | 3 | 无 |
| B9-websearch | web_search.ts 质量升级（Bing/Brave 适配器） | 2.5 | 无 |
| B10.1 | AgentTool 新建 | 4 | D1 |
| B10.2 | AskUserQuestionTool 新建 | 2 | 无 |
| B10.4 | EnterPlanModeTool / ExitPlanModeTool 新建 | 1.5 | A4 |
| C1 | 异步 Hook + asyncRewake | 2 | 无 |
| C3 | 链式 Pipeline | 2 | C2 |
| C7 | 新增事件补齐 | 1 | 无 |
| D1 | 跨进程 Subagent | 3 | 无 |
| **小计** | | **41.5** | |

### 阶段三 Advanced Features（3~4 周）

高级功能，依赖前两阶段基础。

| 编号 | 任务 | 预估工时（人天） | 依赖 |
|---|---|---|---|
| A7 | Status Line Hook | 1 | A3 |
| B5 | Shell 强沙箱 | 3 | 无 |
| B7 | 权限 8 源叠加 | 2 | A5 |
| B9-todo | todo_write.ts 质量升级 | 1.5 | 无 |
| B9-search | search.ts 质量升级 | 1 | 无 |
| B9-git | git.ts 质量升级 | 1 | 无 |
| B9-notebook | notebook.ts 质量升级 | 1 | 无 |
| B10.3 | SkillTool 新建 | 3 | 无 |
| B10.5 | TaskOutputTool 新建 | 1.5 | B9-shell |
| B10.7 | ListMcpResourcesTool / ReadMcpResourceTool 新建 | 2 | B2 |
| B10.8 | TaskCreate/Update/List/Get (V2) 新建 | 4 | 无 |
| B10.9 | WorktreeTool 新建 | 2 | D2 |
| B10.10 | SendMessageTool 新建 | 1.5 | D4 |
| B10.11 | ToolSearchTool 新建 | 2 | B1 |
| B10.13 | WebBrowserTool 新建 | 4 | 无 |
| B10.14 | SnipTool 新建 | 1.5 | B6 |
| C5 | if-condition 声明式 Matcher | 2 | 无 |
| C6 | Trust 机制 | 1.5 | 无 |
| D2 | Worktree 隔离 | 3 | D1 |
| D3 | Coordinator Mode | 3 | D1 |
| D4 | Pipe IPC / LAN 群控 | 3.5 | D1 |
| D6 | Scheduler Daemon + 重启恢复 | 2.5 | D5 |
| D7 | LLM-as-Judge 评估器 | 2 | 无 |
| D8 | TUI 多 Agent 可视化 | 2.5 | D1, A6 |
| **小计** | | **51.5** | |

### 阶段四 Long-tail & Polish（2~3 周）

长尾工具和远期功能。

| 编号 | 任务 | 预估工时（人天） | 依赖 |
|---|---|---|---|
| B10.6 | BriefTool 新建 | 0.5 | 无 |
| B10.12 | SleepTool 新建 | 0.5 | 无 |
| B8-P3 | PowerShellTool / REPLTool / ConfigTool / TungstenTool | 6 | 无 |
| B8-FF | Chrome Use 工具集 / SendUserFileTool | 5 | 无 |
| | 集成测试 + 文档补充 | 5 | 全部 |
| **小计** | | **17** | |

**总计**: 约 **129 人天**（原 62 人天 + B8~B10 新增约 67 人天）

> 注：B8~B10 新增的工具对齐工作（现有工具升级 22 人天 + 新工具开发 30 人天 + 集成测试 11 人天 + 远期 P3 工具 4 人天）显著增加了总工作量。建议按 P0→P1→P2→P3 严格排期，P3 工具可视资源情况延后。

---

## 7. 本周立即可动手的 5 件事

按可操作性从高到低排序：

### 1. 删除遗留 REPL（A8）—— 0.5 人天

**做什么**: 删除 `packages/rookie-cli/src/repl.ts` 和对应的 `dist/repl.d.ts`，清理 `index.ts` 中的引用。
**依赖**: 无。确认 `code.ts` 已使用 TUI 入口即可。
**为什么先做**: 最简单的 Quick Win，消除代码库的困惑点，为后续 TUI 改动减少干扰。

### 2. Permission Denial 抑制（A5）—— 1 人天

**做什么**: 在 `PermissionManager` 中加入 `consecutiveDenialCount` / `totalDenialCount` 计数器，阈值触发 abort。
**依赖**: 无。只修改 `permissions/manager.ts` 和 `permissions/types.ts`。
**为什么先做**: 直接改善用户体验，避免无限弹窗。

### 3. 流式假死恢复（A1）—— 1.5 人天

**做什么**: 在 `useTuiState` 中添加 `streamIdleTimer`，30 秒提示 + 90 秒自动中断重试。
**依赖**: 无。只修改 `useTuiState.ts` 和 `BottomBar.tsx`。
**为什么先做**: 解决目前最常见的用户抱怨——流卡死只能 Ctrl+C。

### 4. 结构化 LLM 判定（C2）—— 1.5 人天

**做什么**: 改造 `runPrompt()` 返回结构化 JSON，删除 `promptLooksRejected()` 正则。
**依赖**: 无。只修改 `hooks/registry.ts` 和 `hooks/types.ts`。
**为什么先做**: 消除 hook 系统中最大的脆弱点——正则匹配 LLM 输出。

### 5. hookDedupKey 去重（C4）—— 1 人天

**做什么**: 在 `HookRegistry` 中维护 `recentFires` Map，500ms 内去重。
**依赖**: 无。只修改 `hooks/registry.ts`。
**为什么先做**: 简单有效，防止高频工具调用导致 hook 重复执行。

---

## 8. 风险与兜底

| 风险 | 影响 | 概率 | 兜底方案 |
|---|---|---|---|
| B1 Tool 泛型重构导致大量内置工具 break | 阶段二停滞 | 中 | 保留旧 `Tool` 接口作为 shim，新旧并存过渡 |
| B5 Shell 沙箱在 CI 环境无 bwrap/sandbox-exec | CI 测试失败 | 高 | 沙箱层做 graceful fallback，`ROOKIE_SANDBOX=off` 禁用 |
| D1 跨进程 Subagent stdio 通信不稳定 | 子任务丢失 | 中 | 进程心跳 + 超时自动回收 + 退化为 in-process 模式 |
| D2 Worktree 在浅 clone 仓库不可用 | worktree add 失败 | 中 | 检测 `--depth` 浅 clone 后降级为目录复制隔离 |
| D4 LAN mDNS 在企业网被防火墙阻断 | 跨机器发现失败 | 高 | 提供手动 `--peer <ip:port>` 配置作为 fallback |
| C5 jsonata 依赖体积较大 | 包体积增长 | 低 | 可改用自研受限表达式解析器（< 200 行） |
| A3 主题化需改动所有 TUI 组件 | 改动面广容易遗漏 | 中 | 使用 ESLint 规则检测硬编码颜色引用 |
| 整体进度风险 | 62 人天超出预期 | 中 | 阶段一优先保证交付，阶段三根据实际进展调整范围 |

---

## 9. 任务→文件影响面速查表

| 任务 | 涉及文件（绝对路径简写，前缀 `packages/`） |
|---|---|
| A1 流式中断 | `rookie-cli/src/tui/hooks/useTuiState.ts`, `rookie-cli/src/tui/components/BottomBar.tsx` |
| A2 工具进度 | `rookie-sdk/src/tools/types.ts`, `rookie-sdk/src/tools/builtin/shell.ts`, `rookie-sdk/src/tools/builtin/web_search.ts`, `rookie-sdk/src/tools/builtin/web_fetch.ts`, `rookie-cli/src/tui/components/ToolProgressPanel.tsx` (新) |
| A3 主题化 | `rookie-cli/src/tui/types.ts`, `rookie-cli/src/tui/themes/` (新), `rookie-cli/src/tui/components/*.tsx` (全部), `rookie-sdk/src/config/settings.ts` |
| A4 Plan 只读 | `rookie-sdk/src/tools/registry.ts`, `rookie-cli/src/tui/hooks/useTuiState.ts`, `rookie-cli/src/tui/components/TopStatusBar.tsx`, `rookie-cli/src/tui/components/PlanPanel.tsx` |
| A5 Denial 抑制 | `rookie-sdk/src/permissions/manager.ts`, `rookie-sdk/src/permissions/types.ts`, `rookie-sdk/src/errors.ts`, `rookie-sdk/src/config/settings.ts` |
| A6 多 Lane | `rookie-cli/src/tui/components/EventStream.tsx`, `rookie-cli/src/tui/types.ts` |
| A7 StatusLine | `rookie-cli/src/tui/components/BottomBar.tsx`, `rookie-sdk/src/config/settings.ts` |
| A8 REPL 清理 | `rookie-cli/src/repl.ts` (删除), `rookie-cli/src/index.ts`, `rookie-cli/src/commands/code.ts` |
| B1 Tool 泛型 | `rookie-sdk/src/tools/types.ts` (重写), `rookie-sdk/src/tools/factory.ts` (新), `rookie-sdk/src/tools/compat.ts` (新), `rookie-sdk/src/tools/registry.ts`, `rookie-sdk/src/tools/builtin/*.ts` (12 文件) |
| B2 MCP 注册 | `rookie-sdk/src/tools/registry.ts`, `rookie-sdk/src/mcp/client.ts`, `rookie-sdk/src/mcp/types.ts`, `rookie-sdk/src/config/settings.ts` |
| B3 并行执行 | `rookie-sdk/src/tools/types.ts`, `rookie-sdk/src/tools/registry.ts`, `rookie-sdk/src/tools/executor.ts` (新) |
| B4 文件历史 | `rookie-sdk/src/tools/builtin/edit.ts`, `rookie-sdk/src/tools/builtin/file.ts`, `rookie-sdk/src/commands/builtin.ts` |
| B5 Shell 沙箱 | `rookie-sdk/src/tools/builtin/shell.ts`, `rookie-sdk/src/tools/sandbox-adapter.ts` (新) |
| B6 上下文管道 | `rookie-sdk/src/agent/compactor.ts`, `rookie-sdk/src/agent/react.ts` |
| B7 权限 8 源 | `rookie-sdk/src/permissions/manager.ts`, `rookie-sdk/src/permissions/types.ts`, `rookie-cli/src/commands/code.ts` |
| B8 CCB 全量对齐 | （元数据任务，无直接代码变更，追踪 B9/B10 进度） |
| B9-file 质量升级 | `rookie-sdk/src/tools/builtin/file.ts` |
| B9-edit 质量升级 | `rookie-sdk/src/tools/builtin/edit.ts` |
| B9-shell 质量升级 | `rookie-sdk/src/tools/builtin/shell.ts` |
| B9-glob 质量升级 | `rookie-sdk/src/tools/builtin/glob.ts` |
| B9-grep 质量升级 | `rookie-sdk/src/tools/builtin/grep.ts` |
| B9-webfetch 质量升级 | `rookie-sdk/src/tools/builtin/web_fetch.ts` |
| B9-websearch 质量升级 | `rookie-sdk/src/tools/builtin/web_search.ts` |
| B9-todo 质量升级 | `rookie-sdk/src/tools/builtin/todo_write.ts` |
| B9-search 质量升级 | `rookie-sdk/src/tools/builtin/search.ts` |
| B9-git 质量升级 | `rookie-sdk/src/tools/builtin/git.ts` |
| B9-notebook 质量升级 | `rookie-sdk/src/tools/builtin/notebook.ts` |
| B10.1 AgentTool | `rookie-sdk/src/tools/builtin/agent_tool.ts` (新), `rookie-sdk/src/agent/subagent.ts`, `rookie-sdk/src/agent/types.ts` |
| B10.2 AskUserQuestionTool | `rookie-sdk/src/tools/builtin/ask_user.ts` (新), `rookie-cli/src/tui/components/UserQuestionPanel.tsx` (新), `rookie-sdk/src/agent/react.ts` |
| B10.3 SkillTool | `rookie-sdk/src/tools/builtin/skill_tool.ts` (新), `rookie-sdk/src/skills/` (新目录), `rookie-sdk/src/skills/registry.ts` (新) |
| B10.4 PlanModeTool | `rookie-sdk/src/tools/builtin/plan_mode.ts` (新), `rookie-sdk/src/tools/registry.ts`, `rookie-cli/src/tui/components/PlanPanel.tsx` |
| B10.5 TaskOutputTool | `rookie-sdk/src/tools/builtin/task_output.ts` (新), `rookie-sdk/src/tools/builtin/shell.ts` |
| B10.6 BriefTool | `rookie-sdk/src/tools/builtin/brief.ts` (新), `rookie-sdk/src/agent/react.ts` |
| B10.7 MCP 资源工具 | `rookie-sdk/src/tools/builtin/mcp_resources.ts` (新), `rookie-sdk/src/mcp/client.ts` |
| B10.8 V2 任务系统 | `rookie-sdk/src/tools/builtin/tasks_v2.ts` (新), `rookie-sdk/src/tasks/` (新目录), `rookie-sdk/src/tasks/store.ts` (新), `rookie-sdk/src/tasks/types.ts` (新) |
| B10.9 WorktreeTool | `rookie-sdk/src/tools/builtin/worktree.ts` (新), `rookie-sdk/src/tools/builtin/git.ts` |
| B10.10 SendMessageTool | `rookie-sdk/src/tools/builtin/send_message.ts` (新), `rookie-sdk/src/agent/blackboard.ts` |
| B10.11 ToolSearchTool | `rookie-sdk/src/tools/builtin/tool_search.ts` (新), `rookie-sdk/src/tools/registry.ts` |
| B10.12 SleepTool | `rookie-sdk/src/tools/builtin/sleep.ts` (新) |
| B10.13 WebBrowserTool | `rookie-sdk/src/tools/builtin/web_browser.ts` (新), `rookie-sdk/src/browser/` (新目录), `rookie-sdk/src/browser/manager.ts` (新) |
| B10.14 SnipTool | `rookie-sdk/src/tools/builtin/snip.ts` (新), `rookie-sdk/src/agent/compactor.ts` |
| C1 异步 Hook | `rookie-sdk/src/hooks/types.ts`, `rookie-sdk/src/hooks/registry.ts`, `rookie-sdk/src/agent/react.ts` |
| C2 结构化 LLM | `rookie-sdk/src/hooks/registry.ts`, `rookie-sdk/src/hooks/types.ts` |
| C3 链式 Pipeline | `rookie-sdk/src/hooks/types.ts`, `rookie-sdk/src/hooks/registry.ts`, `rookie-sdk/src/tools/registry.ts` |
| C4 去重 | `rookie-sdk/src/hooks/registry.ts`, `rookie-sdk/src/hooks/types.ts` |
| C5 if-condition | `rookie-sdk/src/hooks/types.ts`, `rookie-sdk/src/hooks/registry.ts` |
| C6 Trust | `rookie-sdk/src/hooks/registry.ts`, `rookie-sdk/src/config/settings.ts`, `rookie-cli/src/tui/components/ApprovalPanel.tsx` |
| C7 新增事件 | `rookie-sdk/src/hooks/types.ts`, `rookie-sdk/src/agent/subagent.ts`, `rookie-sdk/src/agent/orchestrator.ts` |
| D1 跨进程 Subagent | `rookie-sdk/src/agent/subagent.ts`, `rookie-sdk/src/mcp/stdio-transport.ts`, `rookie-sdk/src/agent/types.ts` |
| D2 Worktree | `rookie-sdk/src/tools/builtin/git.ts`, `rookie-sdk/src/agent/subagent.ts` |
| D3 Coordinator | `rookie-sdk/src/agent/orchestrator.ts`, `rookie-sdk/src/agent/types.ts`, `rookie-sdk/src/commands/builtin.ts` |
| D4 Pipe IPC | `rookie-sdk/src/pipes/` (新目录), `rookie-sdk/src/commands/builtin.ts`, `rookie-cli/src/commands/code.ts` |
| D5 Transcript | `rookie-cli/src/commands/resume.ts`, `rookie-sdk/src/harness/session.ts`, `rookie-sdk/src/agent/react.ts` |
| D6 Scheduler | `rookie-sdk/src/scheduler/index.ts`, `rookie-sdk/src/scheduler/daemon.ts` (新), `rookie-sdk/src/scheduler/store.ts` |
| D7 LLM Judge | `rookie-sdk/src/agent/evaluator.ts`, `rookie-sdk/src/agent/orchestrator.ts` |
| D8 Agent Panel | `rookie-cli/src/tui/components/AgentPanel.tsx` (新), `rookie-cli/src/tui/types.ts`, `rookie-cli/src/tui/hooks/useTuiState.ts` |

### 新建文件汇总

B8~B10 合计需要新建 **18 个文件** 和 **4 个新目录**：

**新文件**:
| # | 文件路径 | 所属任务 |
|---|---|---|
| 1 | `rookie-sdk/src/tools/factory.ts` | B1 |
| 2 | `rookie-sdk/src/tools/compat.ts` | B1 |
| 3 | `rookie-sdk/src/tools/builtin/agent_tool.ts` | B10.1 |
| 4 | `rookie-sdk/src/tools/builtin/ask_user.ts` | B10.2 |
| 5 | `rookie-sdk/src/tools/builtin/skill_tool.ts` | B10.3 |
| 6 | `rookie-sdk/src/tools/builtin/plan_mode.ts` | B10.4 |
| 7 | `rookie-sdk/src/tools/builtin/task_output.ts` | B10.5 |
| 8 | `rookie-sdk/src/tools/builtin/brief.ts` | B10.6 |
| 9 | `rookie-sdk/src/tools/builtin/mcp_resources.ts` | B10.7 |
| 10 | `rookie-sdk/src/tools/builtin/tasks_v2.ts` | B10.8 |
| 11 | `rookie-sdk/src/tools/builtin/worktree.ts` | B10.9 |
| 12 | `rookie-sdk/src/tools/builtin/send_message.ts` | B10.10 |
| 13 | `rookie-sdk/src/tools/builtin/tool_search.ts` | B10.11 |
| 14 | `rookie-sdk/src/tools/builtin/sleep.ts` | B10.12 |
| 15 | `rookie-sdk/src/tools/builtin/web_browser.ts` | B10.13 |
| 16 | `rookie-sdk/src/tools/builtin/snip.ts` | B10.14 |
| 17 | `rookie-sdk/src/tasks/store.ts` | B10.8 |
| 18 | `rookie-sdk/src/tasks/types.ts` | B10.8 |

**新目录**:
| # | 目录路径 | 所属任务 |
|---|---|---|
| 1 | `rookie-sdk/src/skills/` | B10.3 |
| 2 | `rookie-sdk/src/tasks/` | B10.8 |
| 3 | `rookie-sdk/src/browser/` | B10.13 |
| 4 | `rookie-cli/src/tui/components/UserQuestionPanel.tsx` 所在目录已存在 | B10.2 |

---

## 10. 变更日志

| 日期 | 版本 | 变更内容 |
|---|---|---|
| 2026-04-23 | v1.0 | 初始版本：完成 CCB 五层架构对照、Phase-A~D 共 30 项任务规划、三阶段排期、风险评估 |
| 2026-04-23 | v1.1 | **B1 重写**: 补充 CCB Tool 接口 35 字段全量对照表 + 核心改造方案 + 向后兼容 shim；**新增 B8**: CCB 50+ 工具全量对齐清单（固定工具 17 / 条件工具 10 / Feature Flag 6 / Ant-only 3，统计 0 个完全对齐、10 个部分、26 个缺失）；**新增 B9**: 现有 11 个工具质量升级清单（22 人天）；**新增 B10**: 14 个全新工具开发清单（30 人天）；**更新 Phase-B Exit Criteria**: 新增 B8~B10 相关达标条件；**更新第 6 节排期**: 拆为四阶段，总工作量从 62 人天上调至 129 人天；**更新第 9 节文件影响面**: 新增 B8~B10 涉及的 18 个新文件和 4 个新目录 |
| 2026-04-27 | v1.2 | **完成 Phase-A 部分任务**: A2 工具进度通道、A6 多 Lane 并行事件流；**完成 Phase-B 部分任务**: B9 现有工具基础升级（file/glob/grep/web_fetch/web_search）、B10 新工具开发（AgentTool/AskUserQuestionTool/SkillTool/PlanModeTool/SleepTool）；**标记已完成功能**: B5 Shell 沙箱、B6 上下文管道、B7 权限 8 源、C2 结构化 LLM 判定（之前已实现）|
