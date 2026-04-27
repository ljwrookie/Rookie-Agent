# Rookie Agent × Hermes 设计理念对齐路线图 v2

> 基于 Hermes Agent v0.11.0 全量审计，对照 Rookie-Agent 现有实现的差距分析与分阶段执行计划
> 定位：作为 P1-P3 已完成后的**下一阶段执行蓝图**，聚焦 Hermes 核心设计理念的深度对齐

**日期**: 2026-04-27
**版本**: v2.0
**状态**: 待执行
**前置文档**:
- `2026-04-23-rookie-agent-gap-analysis-and-roadmap.md`（v1 路线图，P1-P3 已完成）
- `EXECUTION_SUMMARY_P1_P3.md`（P1-P3 执行报告）

---

## 0. 总览：Hermes 六大设计理念 vs Rookie 现状

| # | Hermes 设计理念 | 核心含义 | Rookie 对齐度 | 差距等级 |
|---|---|---|---|---|
| 1 | **闭环学习系统** | 技能自创建 → 自改进 → 记忆持久化 → 跨会话检索 → 用户建模 | ⚠️ 70% | 🟡 记忆闭环不够主动 |
| 2 | **模型无关** | 15+ Provider 一键切换，Transport 抽象层 | ⚠️ 60% | 🔴 缺 Transport 抽象 |
| 3 | **全平台接入** | 17 个消息平台 + CLI + Web Dashboard | ❌ 15% | 🔴 仅飞书 1 个平台 |
| 4 | **运行无处不在** | 6 种终端后端 + Serverless 持久化 | ❌ 10% | 🔴 仅本地 Shell |
| 5 | **委托与并行** | Subagent 生成 + Orchestrator + 文件协调 | ✅ 85% | 🟢 已有 GAN 编排 |
| 6 | **插件化扩展** | 完整插件 API + 技能标准化 + Skills Hub | ⚠️ 40% | 🟡 有 Hook，缺插件 API |

**综合对齐度: ~47%**（P1-P3 已完成基础框架，但 Hermes 核心的"自我进化"和"全平台"两翼仍有显著差距）

---

## 1. 现状详细审计

### 1.1 已完成能力清单（P1-P3 成果）

| 模块 | 文件 | 行数 | 测试 | 状态 |
|---|---|---|---|---|
| ReAct 循环 | `agent/react.ts` | 345 | ✅ | 生产可用 |
| 5 角色 Agent | `agent/{coder,reviewer,explorer,architect,planner}.ts` | ~1200 | ✅ | 生产可用 |
| Orchestrator | `agent/orchestrator.ts` | ~400 | ✅ | 含 sequential/parallel/adaptive/GAN |
| Subagent | `agent/subagent.ts` | ~200 | ✅ | 基本可用 |
| Blackboard | `agent/blackboard.ts` | ~150 | ✅ | 共享状态 |
| Compactor | `agent/compactor.ts` | ~300 | ✅ | 阈值触发 + Hook 通知 |
| 5 阶段管道 | `agent/context-pipeline.ts` | ~250 | ✅ | Budget→Snip→Normalize→Collapse→Compact |
| Evaluator | `agent/evaluator.ts` | ~200 | ✅ | 独立评估角色 |
| SkillLearner | `skills/learner.ts` | 500 | ✅ 10 tests | 自创建 + rewritePool |
| SkillRegistry | `skills/registry.ts` | ~200 | ✅ | SKILL.md 格式 |
| MemoryStore | `memory/store.ts` | ~300 | ✅ | SQLite FTS5 + CuratedMemory |
| UserModel | `memory/user-model.ts` | ~400 | ✅ 15 tests | SimpleReflector 规则版 |
| ModelRouter | `models/router.ts` | ~180 | ✅ | Default/CostAware/Fallback |
| 3 个 Provider | `models/providers/{openai,anthropic,openrouter}.ts` | ~600 | ✅ | 基本可用 |
| Hook 系统 | `hooks/{types,registry}.ts` | ~600 | ✅ | Shell/HTTP/Prompt + Chain |
| MCP Client | `mcp/client.ts` | ~200 | ✅ | connect/discover/callTool |
| Scheduler | `scheduler/index.ts` | ~300 | ✅ 22 tests | node-cron |
| Gateway 基类 | `gateway/base.ts` | ~200 | ✅ 17 tests | 抽象 OK |
| 飞书 Gateway | `gateway/feishu.ts` | ~300 | ✅ | 唯一实现 |
| 17 个内置工具 | `tools/builtin/*.ts` | ~2000 | ✅ 60 tests | file/shell/edit/git/web 等 |
| NAPI Transport | `transport/napi.ts` | ~200 | ✅ 11 tests | TS↔Rust 桥 |
| Rust 引擎 | `crates/rookie-core/` | ~3000 | ✅ | AST/Tantivy/KnowledgeGraph |
| Eval Harness | `packages/rookie-eval/` | ~500 | ✅ 17 tests | 评估 + 优化器 |
| TUI | Ink 7 + React 19 | ~2000 | ✅ | 6 模式 + 侧边栏 |

**总计**: 273 个测试通过，SDK 约 8,000 行 TS + Rust 约 3,000 行

### 1.2 关键差距矩阵

| 差距项 | Hermes 实现 | Rookie 现状 | 补齐难度 | 业务影响 |
|---|---|---|---|---|
| 记忆 LLM 摘要 | FTS5 + LLM summarization | FTS5 原始返回 | ⭐⭐ | 🔥🔥🔥 |
| 记忆 Auto-Nudge | 定期分析对话自动持久化 | 仅 tool_result 被动触发 | ⭐⭐ | 🔥🔥🔥 |
| Transport 抽象 | ABC → 4 个具体实现 | 每个 Provider 全量实现 | ⭐⭐⭐ | 🔥🔥🔥 |
| 消息平台 | 17 个 | 1 个（飞书） | ⭐⭐ × N | 🔥🔥🔥 |
| 终端后端 | 6 种（含 Serverless） | 1 种（本地 Shell） | ⭐⭐⭐ | 🔥🔥 |
| LLM UserModeling | Honcho 辩证式 | SimpleReflector 规则 | ⭐⭐⭐ | 🔥🔥 |
| 技能标准化 | agentskills.io 开放标准 | 自定义 SKILL.md | ⭐⭐ | 🔥🔥 |
| 插件 API | register_command/dispatch_tool/veto/transform | 仅 Hook 系统 | ⭐⭐⭐ | 🔥🔥 |
| Voice (TTS/STT) | Edge/ElevenLabs + Whisper | 无 | ⭐⭐ | 🔥 |
| Web Dashboard | FastAPI + React SPA | 无（仅 TUI） | ⭐⭐⭐ | 🔥 |
| RL 训练集成 | Atropos + Trajectory + WandB | 仅 Eval Harness | ⭐⭐⭐⭐ | 🔥 |

---

## 2. 分阶段执行计划

### Phase 4：记忆闭环深化（P4, 预计 1.5 周）

> **目标**：让 Agent 真正"记住"并"理解"过去的一切，而非只是检索原始文本

#### P4-T1 跨会话记忆 LLM 摘要层 ⏱️ 2d

**Hermes 对标**：Agent 搜索过去对话时，得到的不是原始消息片段，而是语义化摘要

**现状**：`MemoryStore.search()` 返回 `MemoryEntry[]`（原始 FTS5 匹配），缺少摘要

**交付物**：

- [ ] `memory/store.ts` 新增 `searchWithSummary(query, limit, summarizer)` 方法
  - FTS5 检索 top-N 结果
  - 按 `sessionId` 聚合
  - 调用注入的 `summarizer` 函数（LLM 或规则）生成每个 session 的摘要
  - 返回 `{ sessionId, summary, relevance, messageCount, timeRange }[]`
- [ ] `memory/summarizer.ts` 新增摘要器模块
  - `LLMSummarizer`：调用 ModelRouter 的 `fast` 任务路由，生成一句话摘要
  - `RuleSummarizer`：降级方案，提取首尾消息 + 工具调用列表
  - 摘要结果缓存到 `curated_memory` 表（type: `"session_summary"`）
- [ ] `agent/react.ts` 中接入：当 Agent 需要回忆时，优先调用 `searchWithSummary`

**验收标准**：
```
输入：searchWithSummary("上次讨论的部署方案", 5)
输出：[
  { sessionId: "abc", summary: "讨论了 K8s vs Docker Compose 部署方案，最终选择 K8s + Helm chart", relevance: 0.92, messageCount: 34 },
  ...
]
```

**涉及文件**：
```
packages/rookie-sdk/src/memory/store.ts          (修改)
packages/rookie-sdk/src/memory/summarizer.ts      (新建)
packages/rookie-sdk/tests/memory-summary.test.ts  (新建, ≥8 tests)
```

---

#### P4-T2 记忆自动 Nudge 机制 ⏱️ 2d

**Hermes 对标**：Agent 定期 nudge 自己持久化关键知识，不需要用户显式触发

**现状**：
- `SkillLearner.onAgentStep()` 仅做技能层面的 nudge
- `AutoMemory`（instructions/auto-memory.ts）只在 `tool_result` 时被动触发
- 缺少对对话内容中隐含偏好/决策/上下文的**主动提取**

**交付物**：

- [ ] `memory/nudge.ts` 新建记忆 Nudge 引擎
  ```typescript
  interface NudgeConfig {
    /** 每隔多少轮 Agent 步骤触发一次分析 */
    stepInterval: number;           // 默认 8
    /** 每次分析的最近消息数 */
    lookbackMessages: number;       // 默认 20
    /** 最低置信度阈值 */
    minConfidence: number;          // 默认 0.6
    /** 可提取的记忆类型 */
    extractableTypes: CuratedMemory["type"][];
  }

  class MemoryNudge {
    constructor(store: MemoryStore, config?: NudgeConfig);
    /** 在 ReAct 循环中每步调用 */
    async onStep(stepIndex: number, recentMessages: Message[]): Promise<CuratedMemory[]>;
    /** 手动触发全量分析 */
    async analyze(messages: Message[]): Promise<CuratedMemory[]>;
  }
  ```
- [ ] **LLM 提取模式**：通过 Prompt 分析最近 N 条消息
  - 提取模板覆盖 8 种类型：`fact | preference | decision | pattern | debug_tip | build_command | env_issue | api_pattern | convention`
  - 每个提取结果带 `confidence` 分数，低于阈值丢弃
  - 去重：与已有 CuratedMemory 的语义相似度检查（简化版用字符串 overlap）
- [ ] **规则提取模式**（零 LLM 成本降级）
  - 正则匹配："我习惯..."、"以后都..."、"记住..."、"我们决定..."、"选方案X"
  - 自动提取项目名、框架名、偏好声明
- [ ] 在 `agent/react.ts` 的主循环中集成
  ```typescript
  // react.ts 主循环
  if (stepIndex % nudgeConfig.stepInterval === 0) {
    const extracted = await memoryNudge.onStep(stepIndex, recentMessages);
    if (extracted.length > 0) {
      // 静默持久化，不打断对话流
      for (const m of extracted) await memoryStore.saveCurated(m);
    }
  }
  ```

**验收标准**：
- 对话中说"以后用 pnpm 不要用 npm"后，第 8 步自动提取 `{ type: "preference", content: "用户偏好 pnpm 作为包管理器", confidence: 0.85 }`
- 下次会话中相关上下文自动注入

**涉及文件**：
```
packages/rookie-sdk/src/memory/nudge.ts          (新建, ~200行)
packages/rookie-sdk/src/agent/react.ts            (修改, 集成 nudge)
packages/rookie-sdk/tests/memory-nudge.test.ts    (新建, ≥10 tests)
```

---

#### P4-T3 LLM 辩证用户建模 ⏱️ 3d

**Hermes 对标**：Honcho 辩证式建模（thesis → antithesis → synthesis）

**现状**：`SimpleReflector` 是纯正则匹配，只能识别显式声明的偏好

**交付物**：

- [ ] `memory/user-model.ts` 新增 `LLMReflector` 实现
  ```typescript
  class LLMReflector implements Reflector {
    constructor(modelRouter: ModelRouter, config?: LLMReflectorConfig);

    async reflect(input: ReflectorInput): Promise<ReflectorOutput> {
      // 1. Thesis: 从最近 sessions 提取用户特征假设
      const thesis = await this.extractThesis(input.recentSessions);
      // 2. Antithesis: 找反证 — 用户行为中与假设矛盾的部分
      const antithesis = await this.findContradictions(thesis, input);
      // 3. Synthesis: 综合得出更准确的用户模型
      return this.synthesize(thesis, antithesis, input.currentModel);
    }
  }
  ```
- [ ] **三阶段 Prompt 模板**
  - Thesis Prompt：分析 N 个 session，提取用户技术栈/风格/偏好假设
  - Antithesis Prompt：审视假设，找出与实际行为不一致的地方
  - Synthesis Prompt：综合正反，输出 `ReflectorOutput` 结构化 JSON
- [ ] **增量更新**：不是每次全量重建，而是在已有 UserModel 基础上增量修正
- [ ] **Reflector 工厂**：根据配置自动选择 Simple / LLM
  ```typescript
  function createReflector(config: ReflectorConfig): Reflector {
    if (config.mode === "llm") return new LLMReflector(config.modelRouter);
    return new SimpleReflector();
  }
  ```
- [ ] `UserModelManager.update()` 支持传入 Reflector 实例

**验收标准**：
- 5 个 session 后，UserModel 能准确反映：用户偏好 TypeScript、使用 pnpm、喜欢简洁回复
- LLM 模式下 synthesis 能发现 SimpleReflector 遗漏的隐含偏好

**涉及文件**：
```
packages/rookie-sdk/src/memory/user-model.ts         (修改, +LLMReflector ~250行)
packages/rookie-sdk/src/memory/reflector-prompts.ts   (新建, ~100行 prompt 模板)
packages/rookie-sdk/tests/user-model-llm.test.ts      (新建, ≥10 tests)
```

---

#### P4-T4 记忆上下文自动注入 ⏱️ 1d

**Hermes 对标**：每次对话开始时，自动注入相关记忆 + 用户模型到 system prompt

**现状**：`instructions/auto-memory.ts` 存在但注入逻辑不完整

**交付物**：

- [ ] `instructions/auto-memory.ts` 重构
  - 会话开始时：查询 `CuratedMemory` 中 confidence > 0.7 且 type 匹配当前任务的条目
  - 注入 UserModel 摘要（技术栈 + 偏好 + 沟通风格）
  - Token 预算控制：记忆注入不超过总 context 的 10%
- [ ] 在 `agent/react.ts` 的 `buildSystemPrompt()` 中集成

**涉及文件**：
```
packages/rookie-sdk/src/instructions/auto-memory.ts  (重构)
packages/rookie-sdk/src/agent/react.ts               (修改)
packages/rookie-sdk/tests/auto-memory.test.ts        (新建, ≥6 tests)
```

---

### Phase 5：模型层重构（P5, 预计 1.5 周）

> **目标**：模型无关的 Transport 抽象 + 快速扩展 Provider

#### P5-T1 Transport 抽象层 ⏱️ 3d

**Hermes 对标**：v0.11.0 Transport ABC — 将 API 格式转换从主循环完全解耦

**现状**：`models/providers/{openai,anthropic,openrouter}.ts` 每个都独立实现完整聊天逻辑（消息格式化 + HTTP 请求 + 响应解析 + 流式处理），大量重复代码

**交付物**：

- [ ] `models/transport/base.ts` 新建 Transport 抽象基类
  ```typescript
  abstract class Transport {
    abstract readonly name: string;

    /** 将统一的 Message[] 转换为 Provider 特有格式 */
    abstract formatMessages(messages: Message[]): unknown;

    /** 将统一的 ToolDefinition[] 转换为 Provider 格式 */
    abstract formatTools(tools: ToolDefinition[]): unknown;

    /** 将 Provider 原始响应解析为统一的 AgentEvent[] */
    abstract parseResponse(raw: unknown): AgentEvent[];

    /** 将 Provider 流式 chunk 解析为统一的 StreamChunk */
    abstract parseStreamChunk(chunk: unknown): StreamChunk | null;

    /** 构建 HTTP 请求体 */
    abstract buildRequestBody(params: TransportParams): unknown;

    /** 发送请求并返回流式迭代器 */
    async *stream(params: TransportParams): AsyncGenerator<StreamChunk> {
      // 通用 HTTP 流处理，子类可 override
    }
  }
  ```
- [ ] `models/transport/openai.ts` — ChatCompletionsTransport
- [ ] `models/transport/anthropic.ts` — AnthropicMessagesTransport
- [ ] `models/transport/openrouter.ts` — 继承 ChatCompletionsTransport + header 定制
- [ ] `models/transport/responses-api.ts` — OpenAI Responses API Transport
- [ ] 重构 `models/providers/*.ts`：不再各自处理格式转换，委托给 Transport
  ```typescript
  // 重构后的 Provider
  class OpenAIProvider implements ModelProvider {
    private transport: ChatCompletionsTransport;
    async chat(params) {
      const body = this.transport.buildRequestBody(params);
      const raw = await this.httpClient.post(body);
      return this.transport.parseResponse(raw);
    }
  }
  ```

**验收标准**：
- 新增一个 Provider（如 Mistral）只需 ~30 行代码（声明 Transport + 配置 endpoint）
- 现有 OpenAI/Anthropic/OpenRouter 功能不退化
- 流式输出行为一致

**涉及文件**：
```
packages/rookie-sdk/src/models/transport/base.ts           (新建, ~200行)
packages/rookie-sdk/src/models/transport/openai.ts         (新建, ~150行)
packages/rookie-sdk/src/models/transport/anthropic.ts      (新建, ~180行)
packages/rookie-sdk/src/models/transport/openrouter.ts     (新建, ~50行)
packages/rookie-sdk/src/models/transport/responses-api.ts  (新建, ~120行)
packages/rookie-sdk/src/models/transport/index.ts          (新建)
packages/rookie-sdk/src/models/providers/openai.ts         (重构)
packages/rookie-sdk/src/models/providers/anthropic.ts      (重构)
packages/rookie-sdk/src/models/providers/openrouter.ts     (重构)
packages/rookie-sdk/tests/transport.test.ts                (新建, ≥15 tests)
```

---

#### P5-T2 新增 Provider 快速扩展 ⏱️ 3d

**Hermes 对标**：支持 15+ Provider（含 Bedrock、NIM、Gemini、Mistral、xAI、Ollama 等）

**现状**：3 个 Provider（OpenAI、Anthropic、OpenRouter）

**交付物**（基于 P5-T1 的 Transport 抽象，每个新 Provider 工时大幅降低）：

- [ ] `models/providers/bedrock.ts` — AWS Bedrock (boto3 Converse API 等价的 TS 实现)
- [ ] `models/providers/gemini.ts` — Google Gemini (AI Studio API)
- [ ] `models/providers/ollama.ts` — 本地 Ollama（重要：离线 / 隐私场景）
- [ ] `models/providers/mistral.ts` — Mistral AI
- [ ] `models/providers/custom.ts` — 任意 OpenAI 兼容 endpoint（用户自定义 baseURL）
- [ ] `hermes model` 等价的 CLI 交互式模型选择命令
  - `rookie model` / `rookie model set <provider>:<model>`
  - `rookie model list` — 列出已配置的 Provider

**验收标准**：
- `rookie model set ollama:llama3` 后立即可用
- 新增 Provider 代码量 < 50 行（验证 Transport 抽象的效果）

**涉及文件**：
```
packages/rookie-sdk/src/models/providers/bedrock.ts   (新建)
packages/rookie-sdk/src/models/providers/gemini.ts    (新建)
packages/rookie-sdk/src/models/providers/ollama.ts    (新建)
packages/rookie-sdk/src/models/providers/mistral.ts   (新建)
packages/rookie-sdk/src/models/providers/custom.ts    (新建)
packages/rookie-cli/src/commands/model.ts             (新建)
packages/rookie-sdk/tests/providers.test.ts           (新建, ≥12 tests)
```

---

#### P5-T3 模型健康检查 + 自动降级 ⏱️ 1d

**Hermes 对标**：`routeWithFallback()` + Provider 健康追踪

**现状**：`ModelRouter.routeWithFallback()` 返回备选列表但无自动重试逻辑

**交付物**：

- [ ] `models/router.ts` 增强
  - `ProviderHealth` 追踪：记录每个 Provider 的成功率、延迟 P50/P99、最近错误
  - `routeWithAutoFallback()` — 主 Provider 失败后自动切换到备选
  - 基于健康数据的智能路由（降级不健康的 Provider 的优先级）
- [ ] `rookie doctor` 命令集成 Provider 健康检查

**涉及文件**：
```
packages/rookie-sdk/src/models/router.ts           (修改, +ProviderHealth)
packages/rookie-sdk/src/models/health.ts           (新建, ~100行)
packages/rookie-sdk/tests/router-health.test.ts    (新建, ≥8 tests)
```

---

### Phase 6：全平台接入（P6, 预计 2 周）

> **目标**：从 1 个平台扩展到 8 个核心平台，实现跨平台对话连续性

#### P6-T1 Gateway 架构增强 ⏱️ 2d

**Hermes 对标**：单 Gateway 进程管理所有平台 + 跨平台会话连续性

**现状**：`GatewayBase` 抽象 OK，但缺少跨平台会话管理

**交付物**：

- [ ] `gateway/manager.ts` — Gateway 统一管理器
  ```typescript
  class GatewayManager {
    private gateways = new Map<string, GatewayBase>();

    register(platform: string, gateway: GatewayBase): void;
    async startAll(): Promise<void>;
    async stopAll(): Promise<void>;

    /** 跨平台会话绑定：Telegram 上的会话 ID 映射到统一的 Session */
    bindSession(platform: string, platformUserId: string, sessionId: string): void;

    /** 获取用户在所有平台上的统一 Session */
    getUnifiedSession(platform: string, platformUserId: string): string;
  }
  ```
- [ ] `gateway/session-bridge.ts` — 会话桥接
  - 用户在 Telegram 开始的对话可以在 CLI 无缝接续
  - 基于 `MemoryStore` 的 `sessionId` 统一标识
- [ ] CLI 命令：`rookie gateway start` / `rookie gateway setup` / `rookie gateway status`

**涉及文件**：
```
packages/rookie-sdk/src/gateway/manager.ts         (新建, ~200行)
packages/rookie-sdk/src/gateway/session-bridge.ts  (新建, ~100行)
packages/rookie-cli/src/commands/gateway.ts        (新建)
packages/rookie-sdk/tests/gateway-manager.test.ts  (新建, ≥10 tests)
```

---

#### P6-T2 钉钉 Gateway ⏱️ 2d

**Hermes 对标**：DingTalk Stream SDK + AI Card streaming

**交付物**：

- [ ] `gateway/dingtalk.ts` — 钉钉机器人网关
  - 基于 `dingtalk-stream` SDK
  - 支持 AI Card（streaming 流式卡片）
  - 支持单聊 + 群聊 @机器人
  - 消息格式适配（Markdown → 钉钉 Markdown）

**涉及文件**：
```
packages/rookie-sdk/src/gateway/dingtalk.ts        (新建, ~300行)
packages/rookie-sdk/tests/gateway-dingtalk.test.ts (新建, ≥8 tests)
```

---

#### P6-T3 企业微信 Gateway ⏱️ 2d

**Hermes 对标**：WeCom + QR 扫码配置

**交付物**：

- [ ] `gateway/wecom.ts` — 企微机器人网关
  - 回调验证 + 消息解密
  - 支持文本/Markdown/图片消息
  - 应用消息 + 群机器人两种模式

**涉及文件**：
```
packages/rookie-sdk/src/gateway/wecom.ts           (新建, ~300行)
packages/rookie-sdk/tests/gateway-wecom.test.ts    (新建, ≥8 tests)
```

---

#### P6-T4 Telegram Gateway ⏱️ 2d

**Hermes 对标**：完整 Telegram Bot + 代理 + streaming + 语音消息转录

**交付物**：

- [ ] `gateway/telegram.ts` — Telegram Bot 网关
  - 基于 `node-telegram-bot-api` 或 `telegraf`
  - 支持 Markdown 渲染
  - 支持语音消息（对接 STT）
  - 支持代理（SOCKS5/HTTP proxy）
  - 支持长消息自动分段

**涉及文件**：
```
packages/rookie-sdk/src/gateway/telegram.ts        (新建, ~350行)
packages/rookie-sdk/tests/gateway-telegram.test.ts (新建, ≥8 tests)
```

---

#### P6-T5 Discord Gateway ⏱️ 1.5d

**交付物**：

- [ ] `gateway/discord.ts` — Discord Bot 网关
  - 基于 `discord.js`
  - 支持 Thread 会话隔离
  - 支持 Slash Commands
  - 支持 Embed（富文本展示）

**涉及文件**：
```
packages/rookie-sdk/src/gateway/discord.ts         (新建, ~250行)
packages/rookie-sdk/tests/gateway-discord.test.ts  (新建, ≥6 tests)
```

---

#### P6-T6 Slack Gateway ⏱️ 1.5d

**交付物**：

- [ ] `gateway/slack.ts` — Slack App 网关
  - 基于 `@slack/bolt`
  - 支持 Thread 会话
  - 支持 Block Kit（富文本）
  - 支持 App Mention + DM

**涉及文件**：
```
packages/rookie-sdk/src/gateway/slack.ts           (新建, ~250行)
packages/rookie-sdk/tests/gateway-slack.test.ts    (新建, ≥6 tests)
```

---

#### P6-T7 Email Gateway ⏱️ 1d

**交付物**：

- [ ] `gateway/email.ts` — 邮件网关
  - IMAP 轮询 + SMTP 发送
  - 支持附件（Agent 生成文件作为附件回复）
  - 支持 HTML 格式化

**涉及文件**：
```
packages/rookie-sdk/src/gateway/email.ts           (新建, ~200行)
```

---

### Phase 7：终端后端多样化（P7, 预计 1.5 周）

> **目标**：Agent 不再局限于本地 Shell，可以在 Docker/SSH/Serverless 环境执行

#### P7-T1 终端后端抽象层 ⏱️ 1.5d

**交付物**：

- [ ] `tools/terminal/backend.ts` — 终端后端抽象
  ```typescript
  abstract class TerminalBackend {
    abstract readonly name: string;
    abstract exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
    abstract spawn(command: string, opts?: SpawnOptions): AsyncGenerator<OutputChunk>;
    abstract writeFile(path: string, content: string): Promise<void>;
    abstract readFile(path: string): Promise<string>;
    abstract isAlive(): Promise<boolean>;
    abstract destroy(): Promise<void>;
  }
  ```
- [ ] `tools/terminal/local.ts` — 本地后端（重构现有 shell.ts）

**涉及文件**：
```
packages/rookie-sdk/src/tools/terminal/backend.ts  (新建, ~100行)
packages/rookie-sdk/src/tools/terminal/local.ts    (新建/重构)
```

---

#### P7-T2 Docker 后端 ⏱️ 2d

**Hermes 对标**：Docker 容器隔离执行

**交付物**：

- [ ] `tools/terminal/docker.ts` — Docker 后端
  - 自动拉取/创建容器
  - 通过 `docker exec` 执行命令
  - 文件通过 volume mount 共享
  - 容器生命周期管理（idle timeout 自动销毁）
  - 安全：限制网络/CPU/内存

**涉及文件**：
```
packages/rookie-sdk/src/tools/terminal/docker.ts   (新建, ~250行)
packages/rookie-sdk/tests/terminal-docker.test.ts  (新建, ≥8 tests)
```

---

#### P7-T3 SSH 后端 ⏱️ 2d

**交付物**：

- [ ] `tools/terminal/ssh.ts` — SSH 远程后端
  - 基于 `ssh2` 库
  - 支持密码/密钥认证
  - 支持 SFTP 文件传输
  - 连接池（复用 SSH 连接）
  - Keep-alive + 断线重连

**涉及文件**：
```
packages/rookie-sdk/src/tools/terminal/ssh.ts      (新建, ~300行)
packages/rookie-sdk/tests/terminal-ssh.test.ts     (新建, ≥8 tests)
```

---

#### P7-T4 Serverless 后端（Daytona） ⏱️ 3d

**Hermes 对标**：环境休眠 + 按需唤醒，空闲成本趋近于零

**交付物**：

- [ ] `tools/terminal/daytona.ts` — Daytona Serverless 后端
  - 基于 `daytona` SDK
  - Workspace 创建/销毁/休眠/唤醒
  - 持久化文件系统（跨会话保留）
  - 按需唤醒延迟优化

**涉及文件**：
```
packages/rookie-sdk/src/tools/terminal/daytona.ts  (新建, ~250行)
```

---

### Phase 8：插件系统 + 技能标准化（P8, 预计 1.5 周）

> **目标**：从 Hook 系统升级为完整的插件 API，技能可分享可安装

#### P8-T1 插件 API ⏱️ 3d

**Hermes 对标**：`register_command()`、`dispatch_tool()`、`pre_tool_call` veto、`transform_tool_result`、自定义 image_gen 后端

**现状**：有 HookRegistry 但缺少插件级 API

**交付物**：

- [ ] `plugins/api.ts` — 插件 API
  ```typescript
  interface PluginContext {
    /** 注册自定义 slash 命令 */
    registerCommand(name: string, handler: CommandHandler): void;
    /** 从插件代码直接调用工具 */
    dispatchTool(toolName: string, input: Record<string, unknown>): Promise<string>;
    /** 注册工具结果转换器 */
    registerToolTransform(matcher: string, transform: TransformFn): void;
    /** 注册自定义工具 */
    registerTool(definition: ToolDefinition, handler: ToolHandler): void;
    /** 访问 MemoryStore */
    readonly memory: MemoryStore;
    /** 访问 ModelRouter */
    readonly models: ModelRouter;
    /** 访问配置 */
    readonly config: AgentConfig;
  }

  interface Plugin {
    name: string;
    version: string;
    activate(ctx: PluginContext): Promise<void>;
    deactivate?(): Promise<void>;
  }
  ```
- [ ] `plugins/loader.ts` — 插件加载器
  - 从 `~/.rookie/plugins/` 自动发现和加载
  - 支持 npm 包格式的插件
  - 插件沙箱（限制文件系统访问范围）
- [ ] `plugins/builtin/` — 内置插件示例

**涉及文件**：
```
packages/rookie-sdk/src/plugins/api.ts       (新建, ~200行)
packages/rookie-sdk/src/plugins/loader.ts    (新建, ~150行)
packages/rookie-sdk/src/plugins/types.ts     (新建, ~80行)
packages/rookie-sdk/tests/plugins.test.ts    (新建, ≥12 tests)
```

---

#### P8-T2 技能标准化 + Install ⏱️ 2d

**Hermes 对标**：agentskills.io 开放标准

**交付物**：

- [ ] `skills/manifest.ts` — 标准化 Skill Manifest
  ```typescript
  interface SkillManifest {
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    /** agentskills.io 兼容的类型标签 */
    tags: string[];
    /** 依赖的工具 */
    tools: string[];
    /** 入口 SKILL.md 路径 */
    entry: string;
    /** 兼容性 */
    engines: { rookie: string };
  }
  ```
- [ ] `skills/installer.ts` — 技能安装器
  - `rookie skill install <url|name>` — 从 Git URL / npm / Skills Hub 安装
  - `rookie skill list` — 列出已安装技能
  - `rookie skill remove <name>` — 卸载技能
  - 版本管理 + 冲突检测
- [ ] `skills/hub.ts` — Skills Hub 客户端（可选）

**涉及文件**：
```
packages/rookie-sdk/src/skills/manifest.ts     (新建)
packages/rookie-sdk/src/skills/installer.ts    (新建)
packages/rookie-cli/src/commands/skill.ts      (修改, 新增 install/remove)
packages/rookie-sdk/tests/skill-install.test.ts (新建, ≥8 tests)
```

---

### Phase 9：体验增强（P9, 预计 2 周）

> **目标**：补齐语音/Dashboard/安全等体验层能力

#### P9-T1 Voice 能力（TTS + STT） ⏱️ 2d

**交付物**：

- [ ] `tools/voice/tts.ts` — 文本转语音
  - Edge TTS（免费，零 API 成本）
  - ElevenLabs（高质量，付费）
- [ ] `tools/voice/stt.ts` — 语音转文本
  - Whisper（本地 / API）
  - 用于 Telegram/WhatsApp 语音消息转录

**涉及文件**：
```
packages/rookie-sdk/src/tools/voice/tts.ts     (新建)
packages/rookie-sdk/src/tools/voice/stt.ts     (新建)
```

---

#### P9-T2 Web Dashboard ⏱️ 5d

**Hermes 对标**：`hermes dashboard` — localhost SPA + API

**交付物**：

- [ ] `packages/rookie-web/` — Web Dashboard 新包
  - 技术栈：React + Vite + TailwindCSS
  - 页面：对话界面、记忆管理、技能管理、模型配置、Gateway 状态、日志查看
  - API：FastAPI 等价的 Express/Koa 后端
- [ ] CLI 命令：`rookie dashboard` — 启动 Dashboard

---

#### P9-T3 安全加固 ⏱️ 2d

**Hermes 对标**：命令审批、DM pairing、容器隔离

**交付物**：

- [ ] `permissions/` 增强
  - 命令白名单持久化（不只是 session 级）
  - DM Pairing：消息平台用户绑定验证
  - 沙箱策略配置文件

---

#### P9-T4 RL 训练集成（探索性） ⏱️ 5d

**Hermes 对标**：Atropos + Trajectory + WandB

**交付物**：

- [ ] `packages/rookie-rl/` — RL 训练包
  - Trajectory 记录器：记录 Agent 的完整决策链
  - Trajectory 压缩器：为训练准备高效数据
  - Atropos 环境适配
  - WandB 监控集成

---

## 3. 完整时间线

```
Week 1-2  │ Phase 4: 记忆闭环深化
          │ ├── P4-T1 LLM 摘要层 (2d)
          │ ├── P4-T2 Auto-Nudge (2d)
          │ ├── P4-T3 LLM 辩证建模 (3d)
          │ └── P4-T4 记忆自动注入 (1d)
          │
Week 3-4  │ Phase 5: 模型层重构
          │ ├── P5-T1 Transport 抽象层 (3d)
          │ ├── P5-T2 新增 5 个 Provider (3d)
          │ └── P5-T3 健康检查 + 降级 (1d)
          │
Week 5-6  │ Phase 6: 全平台接入
          │ ├── P6-T1 Gateway 架构增强 (2d)
          │ ├── P6-T2 钉钉 (2d)
          │ ├── P6-T3 企微 (2d)
          │ ├── P6-T4 Telegram (2d)
          │ ├── P6-T5 Discord (1.5d)
          │ ├── P6-T6 Slack (1.5d)
          │ └── P6-T7 Email (1d)
          │
Week 7-8  │ Phase 7: 终端后端多样化
          │ ├── P7-T1 后端抽象层 (1.5d)
          │ ├── P7-T2 Docker (2d)
          │ ├── P7-T3 SSH (2d)
          │ └── P7-T4 Daytona Serverless (3d)
          │
Week 9-10 │ Phase 8: 插件 + 技能标准化
          │ ├── P8-T1 插件 API (3d)
          │ └── P8-T2 Skill Install (2d)
          │
Week 11-14│ Phase 9: 体验增强
          │ ├── P9-T1 Voice TTS/STT (2d)
          │ ├── P9-T2 Web Dashboard (5d)
          │ ├── P9-T3 安全加固 (2d)
          │ └── P9-T4 RL 训练集成 (5d)
```

---

## 4. 里程碑与验收标准

| 里程碑 | 时间 | 关键指标 | Exit Criteria |
|---|---|---|---|
| **M1: 记忆闭环** | Week 2 末 | 跨会话摘要 + Nudge + LLM 建模 | 5 轮对话后 UserModel 准确反映用户偏好；记忆自动注入命中率 > 70% |
| **M2: 模型无关** | Week 4 末 | Transport 抽象 + 8 个 Provider | 新增 Provider < 50 行代码；`rookie model set` 一键切换 |
| **M3: 全平台** | Week 6 末 | 8 个消息平台 | 在 Telegram 开始的对话可在 CLI 无缝续接 |
| **M4: 运行无处不在** | Week 8 末 | 4 种终端后端 | Docker 沙箱内执行代码；SSH 远程执行 |
| **M5: 插件化** | Week 10 末 | 插件 API + 技能 Install | `rookie skill install <url>` 可用 |
| **M6: 体验完整** | Week 14 末 | Voice + Dashboard + RL | Web Dashboard 可视化管理所有能力 |

---

## 5. 新增代码量估算

| Phase | 新增 TS 代码 | 新增测试 | 新增文件数 |
|---|---|---|---|
| P4 记忆闭环 | ~950 行 | ~34 tests | 8 |
| P5 模型层 | ~1,200 行 | ~35 tests | 12 |
| P6 全平台 | ~2,000 行 | ~56 tests | 14 |
| P7 终端后端 | ~1,000 行 | ~24 tests | 8 |
| P8 插件系统 | ~630 行 | ~20 tests | 7 |
| P9 体验增强 | ~2,500 行 | ~30 tests | 10+ |
| **总计** | **~8,280 行** | **~199 tests** | **~59 文件** |

加上已有的 8,000 行 TS + 3,000 行 Rust + 273 个测试，完成后：

- **总代码**: ~16,000+ 行 TS + 3,000 行 Rust
- **总测试**: ~472 个
- **Hermes 理念对齐度**: 47% → **~92%**

---

## 6. Rookie-Agent 差异化优势保持

在对齐 Hermes 的同时，以下 Rookie 独有优势需要**持续保持和强化**：

| 优势 | 说明 | 强化方向 |
|---|---|---|
| **Rust 计算引擎** | AST + Tantivy + KnowledgeGraph | P5 中用 KnowledgeGraph 增强模型路由决策 |
| **GAN 编排模式** | Planner→Generator→Evaluator 对抗循环 | P4 中用 Evaluator 验证记忆提取质量 |
| **5 阶段上下文管道** | 比 Hermes 单层 Compactor 更精细 | P4-T1 中摘要层集成到 Stage 5 |
| **结构化 Hook 链** | 优先级 + 链式 + transform + filter | P8-T1 中基于 Hook 链实现插件 API |
| **NAPI-RS Transport** | TS↔Rust 二进制桥 | P7 中用 Rust 加速 Docker/SSH 后端 IO |
| **TypeScript 生态** | 对前端工程师更友好 | 保持纯 TS SDK API，Rust 仅做计算层 |

---

## 附录 A：Hermes v0.11.0 完整功能清单对照

| Hermes 功能 | Rookie 状态 | 计划 Phase |
|---|---|---|
| Closed learning loop | ⚠️ 70% → 待深化 | P4 |
| Periodic memory nudges | ❌ 缺 → 新建 | P4-T2 |
| FTS5 session search + LLM summarization | ⚠️ FTS5 有, 摘要无 | P4-T1 |
| Honcho dialectic user modeling | ⚠️ SimpleReflector | P4-T3 |
| agentskills.io standard | ❌ | P8-T2 |
| Transport ABC (4 transports) | ❌ | P5-T1 |
| 15+ model providers | ⚠️ 3 个 | P5-T2 |
| Telegram gateway | ❌ | P6-T4 |
| Discord gateway | ❌ | P6-T5 |
| Slack gateway | ❌ | P6-T6 |
| DingTalk gateway | ❌ | P6-T2 |
| WeCom gateway | ❌ | P6-T3 |
| Feishu gateway | ✅ 已有 | — |
| Email gateway | ❌ | P6-T7 |
| Cross-platform session continuity | ❌ | P6-T1 |
| Docker terminal backend | ❌ | P7-T2 |
| SSH terminal backend | ❌ | P7-T3 |
| Daytona serverless | ❌ | P7-T4 |
| Modal serverless | ❌ | 暂不规划 |
| Plugin API (register_command etc.) | ❌ | P8-T1 |
| Voice TTS (Edge/ElevenLabs) | ❌ | P9-T1 |
| Voice STT (Whisper) | ❌ | P9-T1 |
| Web Dashboard | ❌ | P9-T2 |
| RL / Atropos integration | ❌ | P9-T4 |
| Cron scheduler | ✅ 已有 | — |
| MCP integration | ✅ 已有 | — |
| Subagent delegation | ✅ 已有 | — |
| Context compaction | ✅ 已有（5阶段） | — |
| React/Ink TUI | ✅ 已有（6模式） | — |
| CLI (slash commands) | ✅ 已有 | — |

---

> **下一步行动**：从 P4-T1（记忆 LLM 摘要层）开始执行，这是闭环学习系统的核心缺口，也是 Hermes "自我进化"理念的基石。
