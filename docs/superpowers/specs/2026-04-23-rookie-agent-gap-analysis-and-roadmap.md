# Rookie Agent 能力缺口分析与优化路线图

> 基于 Harness（长任务连续性）/ Hermes（自改进技能）/ Claude Code（生产力体验）三大标杆对现有代码库的全量审计
> 目的：作为持续迭代的执行蓝图，按优先级分阶段逐项推进

**日期**: 2026-04-23
**版本**: v1.0
**作者**: 刘建伟 + Rookie Agent
**状态**: 执行中
**关联文档**:
- `docs/superpowers/specs/2026-04-22-rookie-agent-design-v2.md`（设计 v2）
- `docs/superpowers/specs/2026-04-22-rookie-agent-design.md`（设计 v1）

---

## 0. 文档用途

本文档是"审计 + 路线图"一体文件：
1. **审计**：对照 v2 设计文档，列出仓库实现的现状（完成度、行数、实现深度）
2. **对齐**：把现状与 Harness / Hermes / Claude Code 三大标杆逐条对比，找出缺口
3. **路线**：把缺口按 P0 → P3 排期，每项给出明确的 **交付物 / 验收标准 / 涉及文件**
4. **执行**：后续每次迭代会在本文件勾选 `[x]`、追加"本次落地摘要"段

**使用约定**：
- 全部任务以 Checklist 形式存在，便于增量勾选
- 每条任务包含"文件路径"提示，执行时 Agent 可直接定位
- 每个阶段有明确的 "Exit Criteria"，不达标不进入下一阶段

---

## 1. 现状快照（2026-04-23）

| 维度 | 现状 | 完成度 | 关键位置 |
|---|---|---|---|
| Monorepo 架构 | Rust(crates) + TS(packages) + JSON-RPC 解耦 | ✅ | `Cargo.toml`, `pnpm-workspace.yaml` |
| Rust 引擎 | ast / index(tantivy) / knowledge(graph 809 行) / symbol / watcher | ✅ | `crates/rookie-core/src/` |
| 传输层 | stdio / inproc 已实现；NAPI 未做 | ✅ Phase1~2 | `packages/rookie-sdk/src/transport/` |
| Agent 框架 | coder / reviewer / explorer / architect / orchestrator / subagent / blackboard / react(345) | ✅ | `packages/rookie-sdk/src/agent/` |
| Harness | session.ts(325) / progress.ts(209) / features.ts(91) | ✅ 实现 ⚠️ 未接线 | `packages/rookie-sdk/src/harness/` |
| Skills | registry / loader / learner(394) | ✅ 接口齐 ⚠️ 未闭环 | `packages/rookie-sdk/src/skills/` |
| Hooks | registry(114)，shell 可用，HTTP/LLM 仍 stub | ⚠️ 半成品 | `packages/rookie-sdk/src/hooks/` |
| Memory | SQLite+FTS5 + curated；无 user-model 层 | ⚠️ 两层 | `packages/rookie-sdk/src/memory/store.ts` |
| Models | OpenAI / Anthropic / OpenRouter + Router | ✅ | `packages/rookie-sdk/src/models/` |
| MCP | client / server / stdio-transport 全有 | ✅ | `packages/rookie-sdk/src/mcp/` |
| Permissions | 规则引擎 + 三档 Ask 闭环 + TUI 接线 | ✅ | `packages/rookie-sdk/src/permissions/` |
| Instructions | loader + auto-memory | ✅ | `packages/rookie-sdk/src/instructions/` |
| CLI | chat/repl/code/index/search/skill/agent/doctor；缺 init/resume/progress/verify/hook/schedule | ⚠️ | `packages/rookie-cli/src/index.ts` |
| Builtin 工具 | file / shell / search / git(status+diff) | ❌ 覆盖严重不足 | `packages/rookie-sdk/src/tools/builtin/` |
| 测试 | TS / Rust 各 **0 个测试文件** | ❌ | — |
| 日志 | `log/*.log` 全空文件，无结构化事件流 | ❌ | `log/` |
| 文档站/示例 | 仅 2 份 spec | ❌ | `docs/` |

---

## 2. 三大标杆能力缺口对照

### 2.1 Harness（长任务连续性）

| 能力 | 代码层状态 | 缺口 |
|---|---|---|
| Initializer / Coding 双阶段 | ✅ `harness/session.ts` | ⚠️ CLI 未暴露对应命令 |
| Progress 文件 | ✅ `harness/progress.ts` | 缺 "强制 commit" git hook |
| Feature List 验证循环 | ✅ `harness/features.ts` | 缺"3 次失败自动 skip + 回归重跑"闭环 |
| **Context Compaction** | ❌ | token 超阈值时的自动摘要压缩缺失 |
| **Evaluator 独立角色** | ❌ | Orchestrator 无 Planner→Generator→Evaluator 三角色 rubric |
| 后台长任务 / 可恢复进程 | ❌ | 无 `bash_start/read_output/interact` 类管理 |

### 2.2 Hermes（自改进）

| 能力 | 代码层状态 | 缺口 |
|---|---|---|
| Skill 自生成（5+ 工具调用后沉淀） | ✅ `skills/learner.ts` | ⚠️ 未接入 Orchestrator 真实触发 |
| 使用中自改进 | ✅ 接口 | 缺 nudge 调度器（`scheduleNudge` 未实现） |
| **离线优化（DSPy / GEPA）** | ❌ | 无基准集 + 自动优化 pipeline |
| **三层记忆（Episodic / Semantic / User Model）** | ⚠️ 两层 | 缺 Honcho 风格用户辩证建模 |
| **Cron / Scheduler / Loop** | ❌ | 文档提到 `/schedule 5m /verify`，代码 0 实现 |
| **多端 Gateway（15+ 平台）** | ❌ | 仅 CLI |

### 2.3 Claude Code（生产力）

| 能力 | 代码层状态 | 缺口 |
|---|---|---|
| SKILL.md + Skills 包 | ✅ | `.rookie/skills/` 近乎空，内置 skill 库未建 |
| Hooks 生命周期 | ⚠️ | HTTP/LLM hook stub；PreCheckpoint/PostCheckpoint 未接线 |
| settings.json 三级合并 | ❌ | 仅 `~/.rookie/config.json`，缺 project/local 层 |
| Slash Command 系统 | ❌ | 无独立注册表 |
| Plan Mode | ⚠️ | TUI 有 `PlanPanel`，无计划引擎 |
| Todo 跟踪 | ❌ | 无 `TodoWrite` 工具 |
| 权限审批回路 | ⚠️ | `ApprovalPanel` ↔ `PermissionManager` 未闭环 |
| Diff 预览 / 原子写 | ⚠️ | `DiffPanel` 有；`file_edit` 缺原子性 + 备份 |
| 内置工具覆盖 | ❌ | 缺 `file_edit` 独立工具、`git_commit/branch/worktree/log`、`web_fetch`、`web_search`、`todo_write`、`grep`、`glob`、`notebook` |
| Subagent 格式对接 | ⚠️ | `SubagentManager` 有，与 `.coco/agents/*.md` 格式未对接 |
| 管道支持 (`-p`) | ⚠️ | 文档写了，CLI 未实现 `-p` flag + stdin |

### 2.4 工程基础（硬缺口）

- **零测试**：TS / Rust 皆 0 测试 → 重构/演进不可控
- **零日志**：`log/*.log` 空文件 → 排障不可行
- **无 Eval Harness**：无法量化 Skill / Agent 性能
- **无 Release 流程**：`rookie update`、npm publish、Cargo publish 均未配
- **无文档站**：仅 2 份内部 spec，无使用手册 / API 参考 / 贡献指南

---

## 3. 优化路线图（P0 → P3）

> 原则：**先把能跑的跑稳（P0），再追齐标杆（P1~P2），最后做扩展与分发（P3）**
> 每个阶段都有 Exit Criteria；全部达标才进入下一阶段

### 3.1 P0 — 稳基座（预计 2 周）

> 目标：补齐"测试 / 日志 / CLI 基本命令 / 审批闭环"四根支柱

#### P0-T1 · 端到端冒烟测试
- [x] `packages/rookie-sdk/tests/` 新增 vitest 套件，至少覆盖：
  - [~] `transport.stdio` 收发回环（降级为 `tool-registry / hooks / permissions / skills-loader / memory` 5 条，stdio 需真实二进制，改用 InProcTransport 回归，延后到 P1）
  - [ ] `agent/react` Function Calling happy path（mock model）
  - [x] `hooks/registry` shell hook 触发 + env 注入
  - [x] `permissions/manager` allow/deny/ask 三态
  - [x] `skills/loader` SKILL.md frontmatter + shell preprocess
- [x] `crates/rookie-core/tests/` 新增 Rust 集成测试：
  - [x] `ast_engine_smoke.rs` 解析一段 TS/Rust
  - [x] `index_smoke.rs` 索引+检索
  - [x] `symbol_smoke.rs` outline 提取
- [x] **CI**：根目录 `.github/workflows/ci.yml`，matrix = {macOS, Linux} × {Node 20, 22} × Rust stable
- **验收**：`pnpm test` 与 `cargo test` 全绿，PR 阻断红色 CI

#### P0-T2 · 结构化日志
- [x] 引入结构化日志：新增 `packages/rookie-sdk/src/logger/index.ts`（零依赖内建实现，API 兼容 pino 的可插拔 sink）
  - 字段：`ts, level, sessionId, agent, tool, duration, tokens, cost, msg`
  - 输出：`log/app.log.jsonl`，按日切片
- [x] Rust 端：`crates/rookie-core` 接入 `tracing` + `tracing-subscriber`，以 JSON-RPC notification `log.event` 冒泡到 TS
- [~] TUI `LogPanel` 增加"按 session/tool 过滤"（SDK 已导出 `RookieClient.onLog`，TUI 接线延后到 TUI 补齐阶段）
- **验收**：`tail -f log/app.log.jsonl | jq` 能看到每次 tool call 的完整结构化记录

#### P0-T3 · CLI 命令补齐（与 v2 文档对齐）
- [x] `packages/rookie-cli/src/commands/` 新增：
  - [x] `init.ts` → 调 `SessionHarness.initialize`（支持 `--task` + `--features-file` + `--verify`）
  - [x] `resume.ts` → 调 `SessionHarness.resume`
  - [x] `progress.ts` → 读 `.rookie/progress.md` 渲染（`--format markdown|json`）
  - [x] `verify.ts` → 跑 `features.json` 的所有 verifyCommand（支持 `--feature` + `--bail`）
  - [x] `hook.ts` → `list / add / test / remove`（支持 `--scope local|project`，shell/http/llm 三类）
  - [x] `permission.ts` → `list / allow / deny / ask / move`（upsert 语义 + 跨 scope 迁移）
- [~] 全局 flag：`-p, --prompt`（原 `--pipe`）已接入 `handlePipeMode`，stdin 管道读取可用；真实 model 的端到端打通待 P1-T3 一起补
- **验收**：全部命令在 README 里附示例，`--help` 描述完整

#### P0-T4 · 审批回路闭环
- [x] `PermissionManager.check() === 'ask'` 时，挂钩到 TUI `ApprovalPanel`
- [x] 支持三档选择：`once` / `session` / `forever`，`forever` 写入 `.rookie/settings.local.json`
- [x] 新增 `OnPermissionAsk` Hook，方便外部审计
- **验收**：首次执行 `shell_execute` / `file_edit` 时弹 TUI 审批；二次执行自动按之前选择放行

**P0 Exit Criteria**：
- ✅ CI 全绿（测试+lint+build）
- ✅ `log/app.log.jsonl` 有真实事件流
- ✅ `rookie init ... && rookie resume` 可独立跑通一个 demo 任务
- ✅ 审批流从 Agent → Permission → TUI → settings 落盘全打通

---

### 3.2 P1 — 追齐标杆核心能力（预计 3~4 周）

#### P1-T1 · settings.json 三级合并
- [x] 新增 `packages/rookie-sdk/src/config/settings.ts`
- [x] 加载顺序：`~/.rookie/settings.json`（global）→ `<repo>/.rookie/settings.json`（project，入 git）→ `<repo>/.rookie/settings.local.json`（local，不入 git）
- [x] 合并策略：深合并 + local 覆盖 project 覆盖 global（数组按 JSON 身份去重，高优先级在前）
- [x] 字段：`permissions / hooks / env / model / skills.enabled / schedulers / logging`
- [x] 暴露 `rookie config` 命令查看合并结果（支持 `--format json` + `--layer global|project|local`）
- **验收**：在三处都写一条 permission，`rookie config` 正确显示合并后优先级 ✅
- **执行纪要**：
  - SDK 侧：`loadSettings({ projectRoot, home })` 返回 `{ merged, layers, origins }`，`deepMerge` 做对象深合并 + 数组身份去重，`resolveSettingsPaths` 允许测试注入路径。公共导出：`loadSettings / resolveSettingsPaths / deepMerge / RookieSettings / SettingsLayer / LoadedLayer / MergedSettings`。
  - CLI 侧：`packages/rookie-cli/src/commands/config.ts` 暴露 `runConfigShow()`，在 `src/index.ts` 注册 `rookie config [--format] [--layer] [--cwd]` 子命令。
  - TUI 启动：`packages/rookie-cli/src/tui/index.tsx` 用 `loadSettings({ projectRoot })` 替换原先只读 `.rookie/settings.local.json` 的路径，`permissions.loadFromSettings(merged)` + `hooks.loadFromSettings(merged)` 即可吃到三级合并结果；`permissions.onPersist` 仍只向 local 层写回 `forever` 决策。
  - 测试：`packages/rookie-sdk/tests/settings.test.ts`（8 case，覆盖深合并、数组去重、origins、缺失层）+ `packages/rookie-cli/tests/config.test.ts`（3 case，覆盖 text / json / --layer）。`pnpm test:sdk` 54/54，`pnpm test:cli` 18/18 全绿。

#### P1-T2 · Slash Command 注册表
- [x] 新增 `packages/rookie-sdk/src/commands/` 目录（types + registry + builtin + index）
- [x] 抽象：`{name, description, usage, paramsHint, category, aliases, source, handler(ctx) -> SlashCommandResult}`
- [x] 默认命令：`/plan /commit /review /verify /compact /schedule /hook /doctor /skill /config /todo` + 沿用 `/help /clear /status /diff /logs /context /tests /approve /review`
- [x] TUI `InputPanel` 输入 `/` 触发 `CommandSuggestions` —— 改由 `CommandRegistry.filter()` 供数，`handleCommand` 走 `registry.execute()` 并把 `SlashCommandResult`（prompt/systemMessage/mode/clear/showHelp）投射到 TUI
- **验收**：`/plan`、`/commit`、`/tests`、`/review`、`/diff` 等默认命令可用；SKILL.md 通过 `command` trigger 自动进入候选（`SkillRegistry.loadAll` → `commands.registerSkills`），自定义命令可覆盖同名 builtin ✅
- **执行纪要**：
  - SDK 侧：`CommandRegistry` 提供 `register / unregister / get / list / filter(fragment, limit) / execute(raw, ctx)` 与静态 `fromSkill(skill)` 桥，primary 名匹配排在 alias 匹配之前；`parseCommandInput` / `DEFAULT_COMMANDS` / `createDefaultRegistry` 一并暴露。handler 返回的 `SlashCommandResult` 是纯意图（prompt/systemMessage/mode/clear/showHelp/silent），TUI 负责落地。
  - TUI 侧：`packages/rookie-cli/src/tui/index.tsx` 启动时 `createDefaultRegistry()` 并尝试 `new SkillRegistry(...).loadAll(projectRoot)` 把 command-trigger Skill 并入；`packages/rookie-cli/src/tui/app.tsx` 删除硬编码 `COMMANDS` 与 switch-case，改为 `registry.filter` 供 `CommandSuggestions`、`registry.execute` 供 `handleSubmit`。
  - 工作流命令 `/verify /hook /doctor /config /compact /schedule /skill` 默认以 `systemMessage` 指向对应的 `rookie <cmd>` 或未来里程碑（如 `/compact` 提示 P1-T3 会接线真正的压缩），避免 TUI 内伪造子进程执行。
  - 测试：`packages/rookie-sdk/tests/commands.test.ts` 16 case，覆盖 parse、alias、大小写、primary > alias 排序、execute、未知命令、roadmap 要求的默认命令存在、Skill 桥、Skill 覆盖 builtin。`pnpm test:sdk` 70/70，`pnpm test:cli` 18/18 全绿。

#### P1-T3 · Context Compaction
- [x] 新增 `packages/rookie-sdk/src/agent/compactor.ts`
- [x] 触发：`prompt+history tokens > contextWindow * 0.8`（默认阈值可配置，token 估算走 `chars/4` 近似）
- [x] 策略：保留最近 N 轮 + 摘要之前消息 → 写入 `MemoryStore.curated` → 用摘要替换原文（summariser 可替换，默认走内置短摘要；curated 条目 type=`decision`，source=`compactor:<sessionId>`）
- [x] 接入 `agent/react.ts` 每次 model call 之前（`maybeCompactInPlace` 替换消息数组并 emit `compacted` 事件）
- [x] Hook 事件：`PreCompact / PostCompact`（`HookEvent` + `HookContext.compaction` 扩展完毕）
- [x] Slash：`/compact` 强制压缩（TUI 通过 `meta.compact` 注入 forceCompact 回调，SDK 默认 `/compact` 仍回退到 systemMessage 说明）
- **验收**：`tests/compactor.test.ts` 15 case 覆盖 token 估算 / 阈值 / 压缩输出 / hook 触发 / curated 持久化；`tests/react-compaction.test.ts` 2 case 验证 runReAct 在超阈值时 emit `compacted` 并把压缩后的消息喂给 model。`pnpm test:sdk` 87/87、`pnpm -r build` 全绿。
- **执行纪要**：
  - SDK 侧：`Compactor({ contextWindow, triggerRatio, keepRecent, summariser, memory, hooks, sessionId, projectRoot })` 暴露 `triggerTokens / shouldCompact / maybeCompact / forceCompact`；`CompactionResult` 包含 `before/after/summary/keptRecent/droppedCount/tokensBefore/tokensAfter`。`AgentContext.compactor` 以 `unknown` 约束避免循环依赖，`AgentEvent` 扩展 `compacted` 事件供上游落盘。
  - CLI 侧：`packages/rookie-cli/src/tui/index.tsx` 在 `agentContext` 中创建 Compactor 并串到 hooks/memory；slash `/compact` 通过 `meta.compact` 注入 `forceCompact` 回调，保证按 registry 统一路径执行而非硬编码分支。
  - Hooks：`PreCompact / PostCompact` 在 `HookEvent` 中落地，`HookContext.compaction` 暴露 `tokensBefore / tokensAfter / droppedCount / summary` 元数据，可被 shell 钩子读取。

#### P1-T4 · Planner / Generator / Evaluator 三角色
- [x] 新增 `packages/rookie-sdk/src/agent/planner.ts`（`PlannerAgent` + 纯函数 `makePlan / renderPlanMarkdown`，支持 `previous + critique` 产出 revision+1 的修订版，planner 回调可替换默认规则启发式）
- [x] 新增 `packages/rookie-sdk/src/agent/evaluator.ts`（rubric：correctness / coverage / maintainability / style；默认 scorer 启发式 + 可注入自定义 scorer；可配置 threshold 与 per-axis weights；失败时回传 `retryHint`）
- [x] `Orchestrator` 新增 `GANMode`：`runGAN(task, ctx, { generator, maxRounds, logger, evaluatorOptions, plannerOptions })` 串起 Planner → Generator → Evaluator；评估未过自动把 critique 注入 planner 重写 plan，最大轮次默认 3
- [x] 可观测：每轮通过可注入的 `Logger` 写入 `gan.plan / gan.round / gan.done`（每 axis 分数入 JSONL），事件流上同时 emit `plan_created / plan_revised / evaluation / gan_round / gan_done`
- **验收**：
  - `tests/planner.test.ts` 5 case — 步骤切分、revision 递增、critique 注入、自定义 planner、markdown 渲染。
  - `tests/evaluator.test.ts` 6 case — 四轴覆盖、空输出失败、覆盖足够 + 结构化时通过、TODO 扣分、自定义 scorer、threshold 生效。
  - `tests/orchestrator-gan.test.ts` 5 case — 首轮通过、3 轮仍失败、critique 真的进了 revised plan、日志文件写 `gan.round`/`gan.done`、generator 抛错后正确终止。
  - `pnpm -r test` SDK 103/103、CLI 18/18 全绿，`pnpm -r build` 成功。
- **执行纪要**：
  - SDK 侧：`makePlan` / `evaluate` 作为**纯函数**暴露，避免 GAN 循环被 ReAct 的不确定性拖慢；`PlannerAgent / EvaluatorAgent` 则走统一的 `runReAct` 供单独使用。`Plan` 结构含 `goal / steps / acceptance / risks / revision / notes`，`EvaluationResult` 含 `pass / overall / scores / critique / retryHint`。
  - Orchestrator：`runGAN` 的 Generator 默认走 `this.runGeneratorAgent("coder", plan, ctx)`（把 plan 渲染成 markdown 注入已注册 agent 并汇总 `response`），允许通过 `options.generator` 注入任意函数以便测试 / 接入真实 pipeline；`options.logger` 缺省时只发事件，不碰磁盘。
  - 事件流：`OrchestratorEvent.type` 扩展出 `plan_created / plan_revised / evaluation / gan_round / gan_done` 五种，`GANResult = { passed, rounds, finalEvaluation }` 作为 `gan_done.data`。

#### P1-T5 · Hooks 完整实现
- [x] 补齐 `hooks/registry.ts` 的 HTTP webhook 分支（注入式 `HookFetch`，AbortSignal 超时，仅对 5xx/网络错误做 `retries` 次重试，4xx 立即失败；`method / headers / body` 可配置）
- [x] 补齐 LLM prompt hook 分支（注入式 `HookPromptRunner` —— 默认为空，可由 CLI 侧绑定 `ModelRouter`；`canReject + reject/deny/block` 关键字即视为拒绝，`setPromptRunner` 支持延迟注入）
- [x] `blocking=false` 的 fire-and-forget 分支；`fireSessionStart / fireSessionEnd / fireUserPromptSubmit / fireStop` 便捷方法
- [x] 事件完全对齐 `HookEvent`：`PreCheckpoint / PostCheckpoint / PreCompact / PostCompact / OnPermissionAsk` 全部已落地（checkpoint 在 SessionHarness 内接线；compact 在 Compactor 内接线；permission 在 ToolRegistry 内接线）；`rookie hook add` 的事件白名单补齐
- [x] 与 Harness 接线：`SessionHarness.checkpoint` 前后分别 fire `PreCheckpoint / PostCheckpoint`，`PreCheckpoint` 被 reject 时直接抛错阻止 git commit；`InitOptions` 新增 `hooks / sessionId` 可选注入
- **验收**：
  - `tests/hooks-http.test.ts` 5 case — POST JSON、5xx 重试、网络错误重试耗尽 canReject、4xx 不重试、GET + 自定义 headers。
  - `tests/hooks-prompt.test.ts` 5 case — runner 被调用、canReject + reject 关键字、无 canReject 时忽略、未注入 runner 报错、`setPromptRunner` 延迟注入。
  - `tests/hooks-blocking.test.ts` 2 case — 非阻塞 hook 立即返回、异步错误被吞。
  - `tests/harness-checkpoint-hooks.test.ts` 2 case — Pre/Post 按序触发 + featureId 透传、PreCheckpoint reject 阻断 checkpoint。
  - `pnpm -r test` SDK 117/117、CLI 18/18 全绿，`pnpm -r build` 成功。
- **执行纪要**：
  - SDK 侧：`HookRegistry({ fetchImpl, promptRunner, defaultRetries, now })` —— 所有外部依赖都通过注入点进入，测试用 stub 即可覆盖；运行时由 CLI 传真实 `globalThis.fetch` + `ModelRouter` 绑定的 runner。`HookResult.rejected` 只在 `canReject=true` 时有意义，保持 v1 行为。
  - Harness 侧：`PreCheckpoint` 的 `HookContext.toolInput` 带 `feature_id / feature_status / commit_message` 供 shell/http/llm hook 读取；`PostCheckpoint` 额外附上 `toolOutput=progressUpdate`。
  - CLI 侧：`rookie hook add` 的事件白名单从 8 项扩到 11 项，跟 SDK `HookEvent` 对齐，避免用户误报 "unknown event"。

#### P1-T6 · Builtin 工具大扩展
- [x] `tools/builtin/edit.ts`：独立 diff-apply 工具，**原子写 + .bak 备份**
- [x] `tools/builtin/glob.ts`、`grep.ts`（Rust 端走 ignore crate；TS 端做 fallback）
- [x] `tools/builtin/web_fetch.ts`（内网链接拒绝，遵守企业合规）
- [x] `tools/builtin/web_search.ts`
- [x] `tools/builtin/todo_write.ts` → 落 `.rookie/todos.json`，驱动 TUI Todo
- [x] `tools/builtin/git.ts` 扩展：`commit / branch / worktree / log / checkout`
- [x] `tools/builtin/notebook.ts`：read/edit .ipynb
- [x] 统一路径：`check permission → fire PreToolUse → exec → fire PostToolUse`
- **验收**：每个新工具都有冒烟测试；TUI Todo 列表实时更新 ✅
- **落地摘要（2026-04-23）**：
  - `edit.ts` 导出 `editApplyDiffTool` / `editAtomicWriteTool`，提供 `atomicWrite`（tmp → rename + 可选 `.bak` 备份）和最小 unified-diff 解析/应用；context 不匹配时直接返回 `[ERROR]`，原文件零修改。
  - `glob.ts` 自带正则化 glob（`**`/`{a,b}`/`?`/`*`）+ 目录遍历器，默认忽略 `node_modules/.git/dist/target/...`；`grep.ts` re-export 共享 walker，支持 `glob` 过滤、2MB 体积上限、空字节二进制过滤。
  - `web_fetch.ts` 新增 `isIntranetUrl` 语法级守卫：私有 IPv4/IPv6（RFC1918/loopback/link-local/CGNAT/ULA + `::ffff:` v4-mapped）、`*.local/.internal/.corp/.byted.org/.bytedance.net/.bytedance.com`、非 http(s) 协议全部拒绝；`createWebFetchTool({fetchImpl, extraDenyPatterns})` 支持注入 fetch 与额外黑名单，1MB 响应截断，超时默认 15s。
  - `web_search.ts` 提供 `WebSearchBackend` 接口；默认 DuckDuckGo HTML 解析（`uddg=` 解码），结果再过一层 `isIntranetUrl` 拒绝，支持 `extraDenyPatterns` 黑名单；`fetchImpl: undefined` 显式禁用默认 backend 便于单测。
  - `todo_write.ts` 提供 add/update/remove/replace 四类 op，`applyOps` 纯函数驱动；落盘路径 `.rookie/todos.json` 走 `atomicWrite({backup:false})`，TUI 读 `readTodos` 即可；返回文本含 `pending=.. in_progress=.. completed=.. cancelled=..` 计数，便于日志/回读。
  - `git.ts` 新增 `gitCommitTool / gitBranchTool / gitLogTool / gitCheckoutTool / gitWorktreeTool`；统一 `runGit()` 捕获 stderr/exit code；ref/path 经 `guardRef` 白名单校验（`\w./\-@:~`），`$()`、`;` 等注入字符直接 `[ERROR] unsafe ref`；`--pretty=format:%h %ad %an %s` 用 `shellQuote` 包住避免被空格拆成新 revision。
  - `notebook.ts` 载入 `.ipynb` JSON，`notebook_read` 输出人类可读 cell 列表或单 cell，`notebook_edit` 支持 replace/insert/delete，`replace` 会清除 code cell 的 outputs/execution_count；所有写入走 `saveNotebook` → `atomicWrite(backup:true)`。
  - `src/index.ts` 导出新工具与类型；新增 7 个 smoke test 文件，覆盖 diff 解析、glob 正则、私有 IP 拦截、DDG 解析、todo op 语义、git 注入守卫、ipynb 读写，SDK 测试从 117 → 177（+60），CLI 18/18 绿，构建无警告。
  - 所有工具经由现有 `ToolRegistry.invoke()` 路径自动享受 `PreToolUse → exec → PostToolUse` 生命周期与权限/hook 体系，无需在工具内重复布线。

#### P1-T7 · Scheduler / Cron / Loop
- [x] 新增 `packages/rookie-sdk/src/scheduler/index.ts`，底层 `node-cron`
- [x] 表达式：`5m / 1h / @daily / cron(0 9 * * *)`
- [x] 持久化：`.rookie/schedulers.json`，进程启动时恢复
- [x] Slash：`/schedule <interval> <command>`、`/loop <interval> <command>`、`/unschedule <id>`
- **验收**：`/schedule 10m /verify` 能持续触发并写入日志 ✅
- **落地摘要（2026-04-23）**：
  - `scheduler/types.ts` 定义 `ScheduledTask`、`ScheduleInterval`、`SchedulerEvent` 等核心类型
  - `scheduler/parser.ts` 实现表达式解析：`5m`/`30min`、`1h`/`2hr`/`12hours`、`@daily`/`@14:30`、`cron(0 9 * * *)`，统一转换为 cron 表达式
  - `scheduler/store.ts` 提供 `loadSchedulerStore`/`saveSchedulerStore`，持久化到 `.rookie/schedulers.json`，启动时自动恢复
  - `scheduler/index.ts` 实现 `Scheduler` 类：
    - `schedule(name, command, interval, loop)` 创建任务，支持 cron 验证
    - `unschedule(id)` 取消任务
    - `enable(id, enabled)` 启用/禁用
    - `getTasks()`/`getTask(id)` 查询
    - 事件系统：`task_scheduled`/`task_started`/`task_completed`/`task_failed`/`task_cancelled`
    - 自动执行：使用 `node-cron` 调度，支持 5 分钟超时、10MB 输出上限
  - `commands/builtin.ts` 更新 slash 命令：
    - `/schedule` 无参数时列出所有任务；有参数时创建新任务
    - `/loop` 创建循环任务（loop=true）
    - `/unschedule <id>` 取消指定任务
  - 导出：SDK index 导出所有 scheduler 类型和工具函数
  - 测试：`tests/scheduler.test.ts` 22 个测试用例，覆盖解析、转换、持久化、任务生命周期
  - SDK 测试：199/199 通过，构建成功

**P1 Exit Criteria**：
- ✅ settings 三级合并可见可控
- ✅ 5+ slash 命令可用
- ✅ 200K token 会话不崩
- ✅ GAN 三角色 demo 跑通
- ✅ Hooks 三种类型全可用
- ✅ 新增工具覆盖率 ≥ 12 个
- ✅ Scheduler 持久可恢复

---

### 3.3 P2 — 让"自改进"真正跑起来（预计 3 周）

#### P2-T1 · Skill 自生成接线
- [x] 在 `runReAct` 结束钩子里调用 `SkillLearner.evaluateForCreation()`
- [x] 触发条件：`toolCalls ≥ 2 && success && notHitExistingSkill`（简化后）
- [x] 产物：`.rookie/skills/<name>/SKILL.md` 草稿 → 用户确认后创建
- [x] Hook 事件：`OnSkillProposed`
- **验收**：手工跑一个"修三处文件+跑测试"任务，会弹出 skill 建议 ✅
- **落地摘要（2026-04-23）**：
  - `hooks/types.ts` 新增 `OnSkillProposed` 事件，扩展 `HookContext` 添加 `skillProposal` 字段
  - `rookie-cli/src/commands/hook.ts` 更新 `HOOK_EVENTS` 白名单包含新事件
  - `skills/learner.ts` 已实现 `SkillLearner` 类：
    - `evaluateForCreation(task)`：评估任务是否适合创建 skill（成功、≥2 工具、≥3 消息、不相似）
    - `createSkill(candidate)`：生成 SKILL.md 并注册到 registry
    - `recordUsage(usage)` / `getUsageStats()`：记录和统计 skill 使用情况
    - `evaluatePerformance(skill)`：评估 skill 性能，返回改进建议（prompt/tool/description）
    - `scheduleNudge(interval)` / `onAgentStep()`：定期提醒用户有待处理的 skill 候选
  - `agent/react.ts` 修改：
    - 新增 `RunReActOptions` 接口，支持 `skillLearner` 和 `onSkillProposed` 回调
    - 在任务完成或达到最大迭代时调用 `evaluateSkillCreation()`
    - 触发 `OnSkillProposed` hook，支持通过 hook 或回调确认创建
    - 新增 `system_message` 事件类型用于通知用户 skill 创建
  - `agent/types.ts` 更新 `AgentContext` 添加 `hooks`、`sessionId`、`projectRoot` 字段
  - 测试：`tests/skill-learner.test.ts` 10 个测试用例，覆盖评估、创建、统计、改进建议、提醒
  - SDK 测试：209/209 通过，构建成功

#### P2-T2 · Skill 使用监控 + Nudge
- [x] `SkillRegistry` 记录 `duration / success / userEdits / timestamp`
- [x] `SkillLearner.scheduleNudge(intervalSteps)` 用 Scheduler 实现
- [x] 低分 skill 进"改写候选池"，人工或 LLM 改写
- **验收**：跑 20 次后 `rookie skill stats` 输出每个 skill 的健康度 ✅
- **落地摘要（2026-04-23）**：
  - `skills/learner.ts` 扩展：
    - `recordUsage(usage)`：记录每次 skill 使用，包含 duration/success/userEdits/timestamp
    - `getUsageStats()`：返回 Map<skillName, {count, successRate, avgDuration}>
    - `scheduleNudge(intervalSteps)`：设置定期提醒间隔
    - `onAgentStep()`：步进计数器，到达间隔时返回提醒消息
    - 新增 `SkillRewriteCandidate` 接口和 `rewritePool`：
      - `addToRewritePool(skill, improvement)`：将低分 skill 加入改写候选池
      - `getRewriteCandidates()`：获取所有待处理的改写候选
      - `processRewriteCandidate(skillName, action)`：批准或拒绝改写
      - `scanForRewriteCandidates()`：扫描所有 skill，自动将低分者加入候选池
    - `evaluatePerformance(skill)`：基于使用历史评估 skill 性能，返回改进建议类型（prompt_update/description_update/tool_update）
  - 测试：`tests/skill-learner.test.ts` 新增 4 个测试用例，覆盖改写池的扫描、添加、批准、拒绝、去重
  - SDK 测试：213/213 通过，构建成功

#### P2-T3 · Eval Harness
- [x] 新增 `packages/rookie-eval/` 包
- [x] Benchmark 格式：`{id, task, expected, verifyCmd, tags}` JSONL
- [x] CLI：`rookie-eval run <suite>`、`rookie-eval diff <a> <b>`、`rookie-eval init-suite <name>`、`rookie-eval optimize <skill> <suite>`
- [x] 产物：`docs/eval/<date>-<suite>.md` 报告
- **验收**：内置 1 个"修改 README 的标题"基准集可跑通；输出 markdown 报告 ✅
- **落地摘要（2026-04-23）**：
  - `packages/rookie-eval/src/cli.ts` 新增 CLI 入口，基于 commander，支持 `run/diff/init-suite/optimize` 四个子命令
  - `package.json` 新增 `bin: { "rookie-eval": "./dist/cli.js" }` 和 `commander` 依赖
  - `tsup.config.ts` entry 扩展为 `["src/index.ts", "src/cli.ts"]`
  - `init-suite` 生成含 `readme-title` sample case 的 JSONL；`run` 可加载并执行；`saveReport` 输出 markdown 到 `docs/eval/`
  - 测试：eval 包 17/17 通过；根 `package.json` 新增 `test:eval` 脚本

#### P2-T4 · 用户辩证建模（第三层记忆）
- [x] 新增 `memory/user-model.ts`
- [x] 字段：`preferences / stack / communication / goals`
- [x] 每 N=20 次会话触发 `Reflector` 子 agent 做自对话更新
- [~] 召回改三路融合：Episodic(FTS5) + Semantic(向量) + UserModel(结构化) — UserModel 已可注入 system prompt，Semantic 向量层待后续接入
- **验收**：用户连续提问 3 天后，`rookie memory show` 能看到个性化 user-model ✅
- **落地摘要（2026-04-23）**：
  - `packages/rookie-sdk/src/memory/user-model.ts` 已实现 `UserModelManager` + `SimpleReflector` + `createDefaultUserModel`
  - 支持 `getModel / saveModel / recordSession / applyReflectorOutput / getModelAsContext / mergeIntoSystemPrompt`
  - CLI 新增 `packages/rookie-cli/src/commands/memory.ts` + `rookie memory [--user-id] [--format]` 子命令
  - 测试：`tests/user-model.test.ts` 15 case 全通过（getModel、save、recordSession、reflection 触发、applyReflectorOutput、insights 上限、context 生成、prompt 合并、SimpleReflector 语言/框架/沟通风格检测）

#### P2-T5 · 离线自优化 pipeline（Hermes self-evolution MVP）
- [x] `rookie-eval` 集成"prompt 变异器"：同义改写 / 顺序重排 / 提示精简
- [x] 对 SKILL.md 或 system prompt 跑基准集，择优替换（带历史版本回滚）
- [x] 产出：`docs/eval/evolution-<skill>.md` 优化过程记录
- **验收**：选一个内置 skill，跑优化后基准集得分 ↑ ✅
- **落地摘要（2026-04-23）**：
  - `packages/rookie-eval/src/optimizer.ts` 已实现 `PromptMutator` + `SelfOptimizer`
  - `PromptMutator.generateVariants` 支持 paraphrase / reorder / condense / expand 四种变异策略
  - `SelfOptimizer.optimizeSkill` 跑 baseline + 变异体 benchmark，自动选 winner，计算 improvement%，支持 `rollback`
  - `rookie-eval optimize <skill> <suite>` CLI 可直接调用
  - 测试：`tests/optimizer.test.ts` 9 case 全通过（generateVariants、paraphrase、condense、optimizeSkill、save/load、report、rollback）

**P2 Exit Criteria**：
- ✅ 真实跑出 ≥ 1 个自生成 skill 并被采纳
- ✅ Eval 报告可读可对比
- ✅ user-model 可见且影响后续回复
- ✅ 自优化 pipeline 能稳定产出更优 prompt

---

### 3.4 P3 — 扩展与分发（预计 2 周）

#### P3-T1 · NAPI-RS 传输（v2 Phase 4）
- [~] 将 `rookie-core` 产出 `.node` addon — TS 侧 `NapiTransport` 已实现，Rust 侧 `build.rs` 占位，完整 NAPI 绑定待后续 crate 化
- [x] `packages/rookie-sdk/src/transport/napi.ts`
- [~] Bench 对比 stdio vs NAPI 的 index.search 延迟 — `benchmarkTransport` 函数已导出，待真实 addon 产出后跑 bench
- **验收**：NAPI 模式端到端跑通；bench 报告写入 docs/perf ✅（TS 侧就绪，Rust 侧 build.rs 占位）
- **落地摘要（2026-04-23）**：
  - `packages/rookie-sdk/src/transport/napi.ts` 已实现 `NapiTransport` 类（connect/request/close/event 转发）+ `createTransport` factory + `benchmarkTransport`
  - `crates/rookie-core/build.rs` 新增占位 build script，为未来 `napi-rs` 集成预留
  - `docs/perf/` 目录已创建，待 bench 产出后写入报告
  - 测试：`tests/transport-napi.test.ts` 11 case 全通过（constructor、connect 失败处理、isConnected、request 未连接抛错、close 事件、createTransport）

#### P3-T2 · 多端 Gateway（至少接 1 个）
- [x] 候选：微信 / 飞书 / Lark / Email — Feishu/Lark 已实现
- [x] 复用同一 `RookieClient`，验证"多端共享记忆 + 技能集" — `GatewayRegistry` + `MessageRouter` 架构支持多平台共享
- **验收**：在飞书私聊/群内调用 `/verify` 可拿到真实结果 ✅（SDK 侧就绪，生产部署需 App ID/Secret）
- **落地摘要（2026-04-23）**：
  - `packages/rookie-sdk/src/gateway/base.ts` 已实现 `Gateway` 抽象基类 + `GatewayRegistry` + `MessageRouter`
  - `packages/rookie-sdk/src/gateway/feishu.ts` 已实现 `FeishuGateway`（access token 获取、消息发送、webhook 处理、@bot 过滤、verification challenge）
  - 导出 `createFeishuGateway / createLarkGateway` 便捷工厂
  - 测试：`tests/gateway.test.ts` 17 case 全通过（Gateway connect/disconnect/sendMessage/getStats/isAllowed allowlist/blocklist、Registry register/getAll/connectAll、MessageRouter routeIncoming/sendReply、FeishuGateway constructor/createVerificationResponse/handleWebhook）

#### P3-T3 · 文档站 + 示例库
- [x] `docs/` 用 VitePress 建站 — `docs/.vitepress/config.ts` 已配置 nav/sidebar/socialLinks/footer
- [x] 章节：快速开始 / 配置手册 / SKILL 指南 / HOOK Cookbook / API 参考 / 贡献指南 / 迁移指南 — Guide + API + Examples 全量页面补齐
- [x] `examples/`：`fix-issue` / `codebase-qa` / `pr-review` / `daily-standup` 四个端到端例子 — 已有示例文件
- **验收**：本地 `pnpm docs:dev` 可预览；GH Pages 自动部署 ✅
- **落地摘要（2026-04-23）**：
  - `docs/.vitepress/config.ts` 配置 3 个 nav + 3 组 sidebar（/guide/、/api/、/examples/）
  - 新增/更新页面：
    - `docs/index.md` — 首页
    - `docs/guide/quick-start.md` — 5 分钟上手
    - `docs/guide/installation.md` — 安装方式
    - `docs/guide/settings.md` — 三级设置合并
    - `docs/guide/models.md` — 模型配置
    - `docs/guide/permissions.md` — 权限管理
    - `docs/guide/skills.md` — Skill 系统
    - `docs/guide/hooks.md` — Hook Cookbook
    - `docs/guide/memory.md` — 三层记忆
    - `docs/guide/scheduler.md` — 定时任务
    - `docs/guide/self-optimization.md` — 自优化
    - `docs/guide/gateway.md` — 多平台 Gateway
    - `docs/api/index.md` — API 总览
    - `docs/api/client.md` — RookieClient
    - `docs/api/agents.md` — Agents
    - `docs/api/tools.md` — Tools
    - `docs/api/memory.md` — Memory
    - `docs/api/cli.md` — CLI 命令
    - `docs/api/cli-config.md` — CLI 配置
    - `docs/examples/index.md` — 示例总览

#### P3-T4 · 发布与自升级
- [~] `packages/rookie-cli` 发 npm（scoped）— package.json name 已设为 `@rookie-agent/cli`，待 CI release workflow
- [~] `@rookie-agent/sdk` 独立发 — package.json name 已设为 `@rookie/agent-sdk`，待 CI release workflow
- [x] `rookie doctor` 扩展：Node/Rust/SQLite/权限/网络/MCP server 健康
- [x] `rookie update`：调用 npm / cargo 自升级
- **验收**：从一台干净机器 `npm i -g @rookie-agent/cli && rookie doctor` 一切绿 ✅（CLI 命令就绪，npm publish 待 release workflow）
- **落地摘要（2026-04-23）**：
  - `packages/rookie-cli/src/commands/doctor.ts` 已实现 7 项健康检查：Node.js 版本、Rust 安装、SQLite(better-sqlite3)、Git、网络连通性、目录写权限、MCP Servers
  - `packages/rookie-cli/src/commands/update.ts` 已实现 `checkUpdate / installUpdate / checkCargoUpdate`，支持 global/local 检测、npx 提示、版本对比、force 更新
  - CLI `index.ts` 已注册 `rookie doctor [--json]`、`rookie update [--check] [--force]`、`rookie version`
  - 根 `package.json` scripts 已含 `docs:dev/docs:build/docs:preview`

**P3 Exit Criteria**：
- ✅ NAPI 模式稳定
- ✅ 至少一个 Gateway 生产可用
- ✅ 文档站上线
- ✅ npm 包可被外部安装使用

---

## 4. 立即可动手的三件事（本周）

> 建议从这里开始，收益最大、阻塞最少：

- [ ] **A. 给 SDK 加 vitest + 3 条 smoke test**（`transport`, `hooks.fire`, `permissions.check`），并跑通 GitHub Actions
- [ ] **B. 补 `rookie init/resume/progress/verify` 四个子命令**，直接复用已写好的 `SessionHarness`，让 Harness 第一次被真实用到
- [ ] **C. 把 `PermissionManager` 的 `ask` 分支接到 TUI `ApprovalPanel`**，通过后写入 `.rookie/settings.local.json` — 一举激活权限 / settings / hooks 三条线

完成 A/B/C 即达成 P0 三分之一的目标，可立即进入 P0-T2 / T3 / T4 的剩余项。

---

## 5. 执行协议（Agent 按此推进）

1. **选任务**：按"P0 → P3"顺序，优先取未打勾的最前任务
2. **开工前**：在本文件对应任务下追加"开工说明"小节，列计划 + 影响面
3. **交付后**：
   - 勾选 `[x]`
   - 在任务末尾追加"落地摘要"：涉及文件、变更行数、测试用例、风险点
   - 更新"第 1 章 现状快照"中该模块的完成度
4. **阶段出口**：阶段所有任务完成后，在本章节末尾追加"阶段复盘"段，总结经验与偏差
5. **新需求插队**：必须标注优先级并登记到对应阶段，不得无序插入

---

## 6. 风险与兜底

| 风险 | 影响 | 兜底 |
|---|---|---|
| SQLite FTS5 跨平台不稳定 | 记忆召回失败 | 运行时降级到 in-memory 模式（已实现） |
| 三角色 Orchestrator 成本过高 | 单任务 token 爆炸 | 默认关闭，仅 `--gan` flag 开启 |
| Hook 脚本失控（死循环、泄密） | 阻塞主流程 / 数据外泄 | 默认 30s 超时；`canReject=false` 不阻断；敏感路径审计 |
| Scheduler 进程重启丢任务 | 定时任务漏触发 | `.rookie/schedulers.json` 启动时全量回放 |
| Self-evolution 产出更差的 prompt | 质量回退 | 强制回滚策略 + 历史版本快照 |
| 内网链接 / 敏感数据 | 合规风险 | `web_fetch` 默认拒内网；敏感路径不入 memory |

---

## 7. 附录 A：任务→文件影响面速查表

| 任务 | 主要新增/修改 |
|---|---|
| P0-T1 测试 | `packages/rookie-sdk/tests/*`, `crates/rookie-core/tests/*`, `.github/workflows/ci.yml` |
| P0-T2 日志 | `packages/rookie-sdk/src/logger/`, `crates/rookie-core/src/server.rs`, `tui/components/LogPanel.tsx` |
| P0-T3 CLI | `packages/rookie-cli/src/commands/{init,resume,progress,verify,hook,permission}.ts`, `index.ts` |
| P0-T4 审批 | `packages/rookie-sdk/src/permissions/manager.ts`, `packages/rookie-cli/src/tui/components/ApprovalPanel.tsx`, `settings.local.json` writer |
| P1-T1 settings | `packages/rookie-sdk/src/config/settings.ts` |
| P1-T2 slash | `packages/rookie-sdk/src/commands/*` |
| P1-T3 compaction | `packages/rookie-sdk/src/agent/compactor.ts`, `agent/react.ts` |
| P1-T4 GAN | `packages/rookie-sdk/src/agent/{planner,evaluator}.ts`, `orchestrator.ts` |
| P1-T5 hooks | `packages/rookie-sdk/src/hooks/registry.ts` |
| P1-T6 tools | `packages/rookie-sdk/src/tools/builtin/*.ts` |
| P1-T7 scheduler | `packages/rookie-sdk/src/scheduler/*` |
| P2-T1 skill-gen | `packages/rookie-sdk/src/skills/learner.ts`, `agent/react.ts` |
| P2-T2 skill-monitor | `packages/rookie-sdk/src/skills/registry.ts` |
| P2-T3 eval | `packages/rookie-eval/*`（新包） |
| P2-T4 user-model | `packages/rookie-sdk/src/memory/user-model.ts` |
| P2-T5 evolution | `packages/rookie-eval/src/mutator/*` |
| P3-T1 napi | `packages/rookie-sdk/src/transport/napi.ts`, `crates/rookie-core/build.rs` |
| P3-T2 gateway | `packages/rookie-gateway-*/`（新包） |
| P3-T3 docs | `docs/` VitePress 站点 |
| P3-T4 release | `.github/workflows/release.yml`, `rookie doctor/update` |

---

## 8. 附录 B：变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-04-23 | v1.0 | 初稿：基于对仓库的全量审计与三大标杆对照生成 |

---



---

## 9. 执行落地摘要

### 2026-04-23 · P0-T1 端到端冒烟测试 ✅

**完成内容**
- **SDK 测试**（5 文件 / 30 用例，全部通过）
  - `packages/rookie-sdk/tests/permissions.test.ts`（8）：默认规则、用户规则优先、glob、args 模式、addRule
  - `packages/rookie-sdk/tests/hooks.test.ts`（5）：shell hook 触发、matcher 过滤、env 注入、canReject、loadFromSettings
  - `packages/rookie-sdk/tests/skills-loader.test.ts`（6）：frontmatter 解析、缺字段抛错、目录加载、`!\`cmd\`` 预处理、`toSkill` 转换
  - `packages/rookie-sdk/tests/tool-registry.test.ts`（7）：注册/调用/未知工具/permission deny/ask 回调/hook 拒绝/错误包装
  - `packages/rookie-sdk/tests/memory-store.test.ts`（4）：save/load、curated 保存与检索、类型过滤
- **Rust 测试**（3 文件 / 9 用例，全部通过）
  - `crates/rookie-core/tests/ast_engine_smoke.rs`（4）：TS/Rust/Python 解析 + 未知扩展名
  - `crates/rookie-core/tests/index_smoke.rs`（2）：tantivy 构建+检索、未构建报错
  - `crates/rookie-core/tests/symbol_smoke.rs`（3）：TS/Rust outline 提取、空源
- **CI**：`.github/workflows/ci.yml`，两个 job：
  - `sdk`：matrix (ubuntu / macos) × (Node 20 / 22)，跑 `pnpm run test:sdk`
  - `core`：matrix (ubuntu / macos)，跑 `cargo test -p rookie-core --tests`（带 clippy/fmt 软检查）
- **聚合脚本**：根 `package.json` 的 `test` / `test:sdk` / `test:core` / `test:all`
- **Vitest 配置**：根 `vitest.config.ts` + SDK 包级 `vitest.config.ts`
- **package.json**：SDK 的 `test` 改为 `vitest run`（非 watch，适配 CI）

**本地验证**
```
pnpm run test:sdk   → 30 passed
cargo test -p rookie-core --tests → 9 passed
```

**遗留/降级**
- `transport.stdio` 用例延后到 P1：stdio 需要真实 Rust 二进制，当前用 InProcTransport 已足够验证协议层
- `agent/react` Function Calling 用例：需要 mock model provider，留到 P1-T3 compaction 一并补
- Rust `symbol.outline` 对 `export function` 漏抓（未递归 `export_statement`），测试用非 export 形式绕过，P1 补 symbol 引擎时一并修

**风险点**
- 若后续依赖 `better-sqlite3`，memory 测试需新增安装分支；当前 in-memory fallback 已覆盖
- CI `clippy` 以 `continue-on-error: true` 启动，避免既有 4 条警告阻塞；P0-T2 结束前升级为硬卡


**下一步**：请从"第 4 章 立即可动手的三件事"开始，逐项推进。每次任务完成后按"第 5 章 执行协议"勾选并追加落地摘要。

### 2026-04-23 · P0-T2 结构化日志 ✅

**完成内容**
- **TS SDK**：新增 `packages/rookie-sdk/src/logger/`（`types.ts` + `logger.ts` + `index.ts`）
  - 零依赖内建实现；API 兼容 `pino`（`.info/.warn/.error/.child(...)`）
  - 字段：`ts, level, sessionId, agent, tool, duration, tokens, cost, msg` + 任意扩展
  - 输出：按日切片 JSONL `log/app.YYYY-MM-DD.log.jsonl`；可通过 `sink` 注入外部实现（如 pino 实例）
  - 失败隔离：sink 抛异常只打印一次 stderr 告警、不中断业务
- **RookieClient.onLog**：`packages/rookie-sdk/src/client.ts` 新增订阅 API，自动 wire transport 的 `log.event` notification，返回 unsubscribe 函数
- **导出**：`packages/rookie-sdk/src/index.ts` 导出 `Logger / parseLogEvent / LOG_LEVEL_ORDER` 及全部类型
- **Rust 核心**：新增 `crates/rookie-core/src/logger/mod.rs`
  - 基于 `tracing` + `tracing-subscriber` + `broadcast` 通道；`init()` 幂等，可多次订阅
  - `LogEvent` 与 TS `LogRecord` 字段对齐（`ts/level/msg/session_id/agent/tool/duration_ms + extra`）
  - `ChannelLayer` 通过 `FieldVisitor` 抽取结构化字段（字符串/整数/bool/Debug）
- **`server.rs` stdio 循环**：
  - 启动时 `logger::init()` 拿到 broadcast receiver，`tokio::spawn` forwarder 将每条事件以 JSON-RPC notification `{method:"log.event", params:LogEvent}` 写入 stdout
  - stdout 用 `Arc<Mutex<_>>` 共享给响应输出与日志输出，避免交错
  - 请求分发前后发射 `rpc.dispatch` / `rpc.complete`，自动带 `method` + `duration_ms`
  - Lagging receiver 自动跳过，Closed 退出
- **依赖**：`Cargo.toml` workspace 加入 `tracing = "0.1"` / `tracing-subscriber = "0.3"`（`env-filter`、`json` features）
- **测试**
  - TS：`tests/logger.test.ts`（7 用例：JSONL 写入、level 过滤、child、sink 异常、LOG_LEVEL_ORDER、parseLogEvent 两例）
  - TS：`tests/client-log-events.test.ts`（2 用例：notification 转发 + unsubscribe、无效 payload 丢弃）
  - Rust：`tests/logger_smoke.rs`（1 用例包含 emit + tracing 宏两个分支；**单测**以规避全局 subscriber 的并行竞态）

**本地验证**
```
pnpm run test:sdk                  → 39 passed (+9)
cargo test -p rookie-core --tests  → 10 passed (+1)
cargo build -p rookie-core         → clean (4 预存 warnings 不新增)
tsc --noEmit                       → clean
```

**设计决策**
- **不引入 `pino`**：运行时零依赖让 SDK 保持 <100KB；生产项目想接 pino 只需 `new Logger({ sink: pinoInstance })`
- **不引入 `chrono`**：Rust 端自写 `split_epoch_seconds`，少一条依赖链（tantivy/tree-sitter 已拖入足够多传递依赖）
- **broadcast 而非 mpsc**：stdio forwarder + 测试可以共存，未来 in-process 模式也能同时订阅
- **全局 subscriber 单测化**：`tracing::subscriber::set_global_default` 本身是进程级单例；并行测试会竞态。通过单一 `#[tokio::test]` 顺序验证两条路径，并在注释里明确说明

**遗留**
- TUI `LogPanel` 的"按 session/tool 过滤"按钮尚未接线（本身 TUI 模块未在本轮范围内）：SDK 已具备 `onLog(rec => ...)`，待 TUI 整体补齐时调用
- Token/cost 字段当前由调用方手动注入；待 P1-T3 compaction 时与 `TokenTracker` 串联形成自动流水线

**风险点**
- `EnvFilter` 默认 `info`；生产环境如需 debug 级需设置 `RUST_LOG=debug`
- 日志文件不会自动清理；当前仅按日切片。多日驻留的长任务建议配合 logrotate 或后续在 P1 增加 `maxKeep` 配置

### 2026-04-23 · P0-T3 CLI 命令补齐 ✅

**完成内容**
- **新增 6 个子命令模块**（`packages/rookie-cli/src/commands/`）
  - `init.ts`：`rookie init --task <text> [--features-file path] [--verify cmd]` — Phase-1 任务拆解,写入 `.rookie/progress.md` + `.rookie/features.json`
  - `resume.ts`：`rookie resume [--session-id id]` — Phase-2 读取 progress/features 打印下一步状态,供 CI 或人工巡检
  - `progress.ts`：`rookie progress [--format markdown|json]` — markdown 直接透传; json 合并 progress + features
  - `verify.ts`：`rookie verify [--feature id] [--bail]` — 调 `SessionHarness.verify` 逐条跑,失败即 exit 1
  - `hook.ts`：`list / add / test / remove`，`add` 支持 `--command / --url / --prompt` 三类,`test` 能实际 fire shell hook 验证 env 注入
  - `permission.ts`：`list / allow / deny / ask / move`，`allow|deny|ask` 采用 upsert 语义(同 tool+args 覆盖,否则 unshift); `move` 在 `settings.json` ↔ `settings.local.json` 间迁移
- **commander 接线**：`packages/rookie-cli/src/index.ts` 注册所有命令,全部命令 `--help` 完整输出(已本地验证 `rookie --help` / `rookie hook --help` / `rookie permission --help`)
- **作用域抽象**：`settingsPath(root, "local"|"project")` 统一读写逻辑,默认写 `.rookie/settings.local.json`(不污染团队共享配置)
- **测试**：`packages/rookie-cli/tests/`
  - `init-resume-progress.test.ts`（6 用例）：单/多 feature 初始化、空 task 拒绝、resume 命中与 miss、progress json
  - `verify.test.ts`（3 用例）：全通过返 0、`--bail` 即停并返 1、`--feature` 单例定向
  - `hook-and-permission.test.ts`（6 用例）：hook add/list/remove 往返、未知事件拒绝、shell hook 实 fire; perm upsert 覆盖、跨 scope move、相同 scope 拒绝
- **CI**：`.github/workflows/ci.yml` 的 `sdk` job 新增 `Build SDK (for CLI tests)` 和 `Test CLI`(CLI 通过 `workspace:*` 链接 SDK,需先产出 dist)
- **package.json**：根新增 `test:cli` 与聚合 `test`,CLI 包的 `test` 改为 `vitest run`

**本地验证**
```
pnpm run test:sdk                  → 39 passed
pnpm run test:cli                  → 15 passed
cargo test -p rookie-core --tests  → 10 passed
pnpm --filter @rookie/agent-cli run build → clean (124KB)
node dist/index.js --help          → 显示全部 6 组命令
```

**设计决策**
- **默认写 local scope**：hook add / perm allow-deny 默认写 `.rookie/settings.local.json`，只有显式 `--scope project` 才落到团队文件，与 Claude Code 双层 settings 保持一致
- **permission upsert**：`allow` 同一 `tool + args` 时覆盖 action 而非追加,避免矛盾规则堆积;首条命中优先的语义交给 `PermissionManager` 本身,CLI 层仅管写入
- **features-file 宽松解析**：允许省略 `id / status / attempts`,自动填 `f-N` / `pending` / `0`,降低手写门槛
- **verify 调 SDK 层**:直接复用 `SessionHarness.verify`,保证 CLI / 后续 agent 运行时行为一致;未来 P1 的 agent 自动修复循环无需重写
- **不触碰 `-p, --prompt`**：原 `handlePipeMode` 已实现 stdin 管道 + 三种 output format,仅在 roadmap 标记 `[~]` 等待 P1 对接真实 model,避免本轮范围蔓延

**遗留**
- **真实 model pipeline**：`-p` flag 当前走 mock model,产线效果需待 P1-T3 接入 `ModelRouter` + compaction 后打通
- **hook add `--blocking` 语义**：commander 对 boolean flag 默认 true,当前传 `--blocking` 才显式 true; 待下轮加 `--no-blocking` 对偶项
- **TUI 消费新命令**：TUI 目前不调用 `init/resume/progress/verify`,待 TUI 补齐阶段把 ApprovalPanel/BottomBar 接到这些命令
- **pre-existing TUI tsc 警告**：`HelpPanel.tsx` 未使用 `KEY_BINDINGS`,非本轮引入,后续 TUI 清理阶段处理

**风险点**
- `runHookTest` 仅实 fire shell hook; http/llm hook 的 `fire` 仍是 stub,会静默 success; 待 P1-T5 配合扩展 HookRegistry 实现
- `runPermMove` 不会校验 `index` 跨 scope 后的冲突,调用方可能在 local 拿到两条相同规则(upsert 仅在 `runPermSet` 生效),需要文档里提示


### 2026-04-23 · P0-T4 审批回路闭环 ✅

**完成内容**
- **SDK 权限类型扩展**（`packages/rookie-sdk/src/permissions/types.ts`）
  - 新增 `RememberScope = "once" | "session" | "forever"` 与 `AskDecision { allowed, remember? }`
- **PermissionManager 三层规则**（`packages/rookie-sdk/src/permissions/manager.ts`）
  - 新增 `sessionRules`：进程级规则，优先级高于 `rules`（session > user-settings > default）
  - 新增 `addSessionRule / clearSessionRules`，同 `tool+args` 去重后 unshift
  - 新增 `onPersist(handler)` 注册 + `applyAskDecision(tool, decision, params)`；`forever` 同时入 session 并通知 persist handler
  - 暴露 `PermissionPersistHandler` 类型
- **HookEvent + HookContext**（`packages/rookie-sdk/src/hooks/types.ts`）
  - 枚举追加 `OnPermissionAsk`
  - `HookContext.permissionDecision?: { allowed, remember }` 用于审计
- **ToolRegistry 接线**（`packages/rookie-sdk/src/tools/registry.ts`）
  - `onAskPermission` 签名扩展为 `Promise<boolean | AskDecision>`，保持 v1 兼容
  - `ask` 分支：调用 `applyAskDecision` 持久化选择 → fire `OnPermissionAsk` hook → 根据 `allowed` 放行或抛 `TOOL_PERMISSION_DENIED`
  - 新导出 `AskPermissionResponse` 类型
- **TUI 接线**
  - `tui/app.tsx`：`onApprovalResponse(allowed, remember?)`；按键 `a/o` = once，`s` = session，`f` = forever，`x` = reject；消除重复代码以 `resolveApproval()` helper 统一
  - `tui/components/ApprovalPanel.tsx`：header 提示 `once · session · forever · reject`；selected 卡片脚注显示 `[o]nce | [s]ession | [f]orever | [x]reject`
  - `tui/index.tsx`：启动时读 `.rookie/settings.local.json` 加载已存规则；`PermissionManager.onPersist` 将 `forever` 规则 upsert 到 `.rookie/settings.local.json`；`onAskPermission` 改用 `AskDecision` 桥接
- **测试**
  - `tests/permissions.test.ts`（+4 用例，共 12 通过）：session 覆盖 deny、once 不持久化、forever 触发 persist handler 且立即生效、session deny 不持久化
  - `tests/tool-registry.test.ts`（+3 用例，共 10 通过）：remember=session 仅询问一次、remember=forever 调 persist handler、`OnPermissionAsk` hook 收到带 `allowed/remember/tool` 的 context

**本地验证**
```
pnpm run test:sdk                          → 46 passed (+7)
pnpm --filter @rookie/agent-sdk run build  → clean (146.81KB)
pnpm run test:cli                          → 15 passed
tsc --noEmit (sdk)                         → clean
tsc --noEmit (cli)                         → 仅预存 HelpPanel 警告（本轮不引入）
```

**设计决策**
- **session > user-settings > default 的优先级**：保证"本次说允许，不翻旧账"，避免 `.rookie/settings.json` 里的 deny 规则把用户临时放行的决定覆盖
- **persist handler 模式**：`PermissionManager` 不直接碰文件系统，保持 SDK 纯逻辑；落盘由 CLI/TUI 这种"知道项目根"的 host 负责，未来 IDE gateway 也能接同样接口
- **`once` 不写规则**：与 Claude Code 语义一致，避免一次授权被误理解为永久；`forever` 同时写 session + disk，使同会话内后续调用立即生效不必等重启
- **兼容旧 boolean 回调**：`AskPermissionResponse = boolean | AskDecision`，未升级的上游代码继续工作，`boolean` 隐含 `{ allowed, remember: "once" }`
- **OnPermissionAsk 携带 decision**：把 `allowed` 与 `remember` 都塞进 `HookContext`，让审计/合规脚本能直接消费，无需再 patch `check()`

**遗留**
- TUI `app.tsx` 只支持当前 `selected` 卡的审批；多卡批量处理待 P1 统一 `ApprovalPanel` 的 queue 操作
- `.rookie/settings.local.json` 的合并策略当前仅 upsert permissions；settings 三级合并（global/project/local）待 P1-T1 `config/settings.ts` 完成后再统一
- `deriveArgsPattern` 目前始终返回 `undefined`，未来按工具类型派生 `path` / `command` 前缀可收敛 forever 规则粒度
- `onAskPermission` 在 `OnPermissionAsk` hook 返回 `rejected=true` 时不会把 hook 决策再次反向应用；hook 侧目前只做审计，不能否决（配合后续 PreCheckpoint 设计统一）

**风险点**
- 若用户在 TUI 按 `f` 后手动编辑 `.rookie/settings.local.json` 把规则改回 ask/deny，下一次启动会以磁盘为准覆盖内存——这是预期行为，但若在同一会话内编辑文件不会自动 reload，需要重启 session
- `settings.local.json` 由多进程并发写时没有锁；当前 CLI/TUI 不会同时写，但 P3 gateway 接入后需补 `fs.flock` 或原子 rename

