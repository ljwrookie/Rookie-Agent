// Transport
export { Transport, type JsonRpcRequest, type JsonRpcResponse, type JsonRpcNotification } from "./transport/types.js";
export { StdioTransport, type StdioTransportOptions } from "./transport/stdio.js";
export { InProcTransport } from "./transport/inproc.js";

// Client
export { RookieClient, type AstApi, type IndexApi, type SymbolApi, type KnowledgeApi } from "./client.js";

// Errors (Phase 1)
export { RookieError, ErrorCode } from "./errors.js";

// Token Tracking (Phase 1)
export { TokenTracker, type TokenUsage, type CostEntry } from "./tracking.js";

// Agent
export {
  type Agent, type AgentInput, type AgentContext, type AgentEvent,
  type Message, type ToolCall, type ToolResult,
} from "./agent/types.js";
export { runReAct } from "./agent/react.js";
// B6: Context preprocessing pipeline
export {
  runContextPipeline, logPipelineStats,
  type PipelineConfig, type PipelineResult,
} from "./agent/context-pipeline.js";
export {
  Compactor,
  defaultSummariser,
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  type Summariser,
  type CompactorOptions,
  type CompactionResult,
} from "./agent/compactor.js";
export { CoderAgent } from "./agent/coder.js";
export { ExplorerAgent, type FileInfo, type ModuleGraph } from "./agent/explorer.js";
export { ReviewerAgent } from "./agent/reviewer.js";
export { ArchitectAgent } from "./agent/architect.js";
export {
  PlannerAgent,
  makePlan,
  renderPlanMarkdown,
  type Plan,
  type PlanStep,
  type MakePlanOptions,
} from "./agent/planner.js";
export {
  EvaluatorAgent,
  evaluate,
  RUBRIC_AXES,
  type EvaluationResult,
  type EvaluateOptions,
  type AxisScore,
  type RubricAxis,
} from "./agent/evaluator.js";
export {
  AgentOrchestrator, type AgentConfig, type OrchestratorEvent,
  type SharedContext, type OrchestratorMode,
  type GANResult, type GANRoundRecord, type RunGANOptions,
} from "./agent/orchestrator.js";
export {
  SharedBlackboard, type BlackboardEntry, type BlackboardMessage,
} from "./agent/blackboard.js";
export {
  SubagentManager, type SubagentConfig, type SubagentTask, type SubagentResult,
} from "./agent/subagent.js";

// Tools
export {
  type Tool, type ToolParameter,
  // B1: New structured tool types
  type ToolDefinition, type ToolBuilderConfig, type ToolProgressCallback,
  buildTool,
} from "./tools/types.js";
export { ToolRegistry, type ToolRegistryOptions, type AskPermissionResponse } from "./tools/registry.js";
// B3: Streaming tool executor for parallel execution
export {
  StreamingToolExecutor,
  type ToolExecutionRequest, type ToolExecutionResult,
  type ExecutionProgressCallback, type StreamingExecutorOptions,
} from "./tools/executor.js";
// B4: File snapshot manager for undo/rollback
export {
  SnapshotManager,
  type FileSnapshot, type SnapshotManagerOptions,
  getSnapshotManager, initSnapshotManager,
} from "./tools/snapshot.js";
// B5: Shell sandbox adapter
export {
  createSandboxAdapter, isSandboxAvailable, executeWithSandbox,
  type SandboxConfig, type SandboxAdapter,
} from "./tools/sandbox-adapter.js";
export { fileReadTool, fileWriteTool, fileEditTool } from "./tools/builtin/file.js";
export { shellExecuteTool, getBackgroundTaskOutput } from "./tools/builtin/shell.js";
// B10.5: Task output tool for background commands
export { taskOutputTool } from "./tools/builtin/task_output.js";
export { searchCodeTool } from "./tools/builtin/search.js";
export {
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitBranchTool,
  gitLogTool,
  gitCheckoutTool,
  gitWorktreeTool,
} from "./tools/builtin/git.js";
export {
  editApplyDiffTool,
  editAtomicWriteTool,
  atomicWrite,
  applyUnifiedDiff,
  parseUnifiedDiff,
} from "./tools/builtin/edit.js";
export { globFilesTool, grepFilesTool, globToRegExp } from "./tools/builtin/glob.js";
export {
  webFetchTool,
  createWebFetchTool,
  isIntranetUrl,
  type WebFetchDeps,
} from "./tools/builtin/web_fetch.js";
export {
  webSearchTool,
  createWebSearchTool,
  type WebSearchBackend,
  type WebSearchResult,
  type WebSearchDeps,
} from "./tools/builtin/web_search.js";
// B10: New CCB-aligned tools
export {
  agentTool,
  createAgentTool,
} from "./tools/builtin/agent.js";
export {
  askUserQuestionTool,
  createAskUserQuestionTool,
  type AskUserQuestionOptions,
} from "./tools/builtin/ask_user.js";
export {
  skillTool,
  createSkillTool,
} from "./tools/builtin/skill.js";
export {
  planModeTool,
  createPlanModeTool,
  setPlanModeCallbacks,
  isPlanModeActive,
  type PlanModeCallbacks,
} from "./tools/builtin/plan_mode.js";
export {
  sleepTool,
  createSleepTool,
} from "./tools/builtin/sleep.js";
export {
  todoWriteTool,
  createTodoWriteTool,
  readTodos,
  todosPath,
  applyOps as applyTodoOps,
  type TodoItem,
  type TodoStatus,
  type TodoStore,
  type TodoOp,
} from "./tools/builtin/todo_write.js";
export {
  notebookReadTool,
  notebookEditTool,
  loadNotebook,
  saveNotebook,
  type Notebook,
  type NotebookCell,
  type NotebookCellType,
} from "./tools/builtin/notebook.js";

// Scheduler
export {
  Scheduler,
  getGlobalScheduler,
  setGlobalScheduler,
  parseInterval,
  intervalToCron,
  intervalToString,
  getNextRunTime,
  loadSchedulerStore,
  saveSchedulerStore,
  generateTaskId,
  validateTask,
  type ScheduleInterval,
  type ScheduledTask,
  type SchedulerStore,
  type SchedulerOptions,
  type SchedulerEvent,
} from "./scheduler/index.js";

// Memory
export { MemoryStore, type MemoryEntry, type CuratedMemory } from "./memory/store.js";

// Models (v2: streaming + function calling + OpenRouter)
export {
  type ModelProvider, type ModelCapabilities,
  type ChatParams, type ChatWithToolsParams,
  type ChatChunk, type ChatResponse,
  // Note: ToolDefinition is also exported from ./tools/types.js (B1)
  type ToolDefinition as ModelToolDefinition,
} from "./models/types.js";
export { OpenAIProvider, type OpenAIConfig } from "./models/providers/openai.js";
export { AnthropicProvider, type AnthropicConfig } from "./models/providers/anthropic.js";
export { OpenRouterProvider, type OpenRouterConfig } from "./models/providers/openrouter.js";
export {
  ModelRouter, type TaskType, type RoutingStrategy,
  DefaultStrategy, CostAwareStrategy, FallbackStrategy,
} from "./models/router.js";

// Skills (Phase 2: SKILL.md + SkillLearner)
export { SkillRegistry } from "./skills/registry.js";
export {
  type Skill, type SkillManifest, type Trigger, type Example, type CompletedTask,
  type SkillMdFrontmatter, type SkillMd,
  type SkillCandidate, type SkillUsage, type SkillImprovement,
} from "./skills/types.js";
export { SkillLoader } from "./skills/loader.js";
export { SkillLearner, type SkillRewriteCandidate } from "./skills/learner.js";

// Agent
export type { RunReActOptions } from "./agent/react.js";

// MCP (Phase 3: full client + server + stdio transport)
export { McpClient } from "./mcp/client.js";
export { McpServer, type McpServerConfig } from "./mcp/server.js";
export { StdioMcpTransport, type StdioMcpTransportOptions } from "./mcp/stdio-transport.js";
export {
  type McpTool, type McpResource, type McpServerCapabilities,
  type McpTransport, type McpServerInfo,
  // B2: MCP configuration types for auto-registration
  type McpServerConfig as McpServerSettingsConfig, type McpRegistryConfig,
} from "./mcp/types.js";

// Harness (Phase 2: full implementation)
export { SessionHarness, type CodingLoopEvent } from "./harness/session.js";
export { ProgressManager, type ProgressData, type ProgressEntry } from "./harness/progress.js";
export { FeatureListManager, type FeatureList } from "./harness/features.js";
export {
  type InitOptions, type SessionState, type Feature,
  type CheckpointData, type VerificationResult,
} from "./harness/types.js";

// Hooks (Phase 1)
export { HookRegistry } from "./hooks/registry.js";
export type {
  HookFetch,
  HookPromptRunner,
  HookRegistryOptions,
} from "./hooks/registry.js";
export { type HookEvent, type HookConfig, type HookContext, type HookResult } from "./hooks/types.js";

// Instructions (Phase 1)
export { InstructionLoader } from "./instructions/loader.js";
export { AutoMemory } from "./instructions/auto-memory.js";
export { type InstructionLayer, type ProjectInstructions, type MemoryCandidate } from "./instructions/types.js";

// Logger (Phase P0-T2: structured logging)
export { Logger, parseLogEvent } from "./logger/index.js";
export {
  LOG_LEVEL_ORDER,
  type LogLevel, type LogFields, type LogRecord, type LogSink, type LoggerOptions,
} from "./logger/index.js";

// Permissions (Phase 1)
export { PermissionManager, PermissionDenialError, type PermissionPersistHandler } from "./permissions/manager.js";
export {
  type PermissionRule,
  type PermissionAction,
  type AskDecision,
  type RememberScope,
  type DenialTrackingConfig,
  type PermissionErrorCode,
} from "./permissions/types.js";

// User Model (P2-T4: third-layer memory)
export {
  UserModelManager,
  SimpleReflector,
  createDefaultUserModel,
  type UserModel,
  type UserPreferences,
  type TechStack,
  type CommunicationStyle,
  type UserGoals,
  type ReflectorInput,
  type ReflectorOutput,
  type ReflectorAgent,
  type UserModelOptions,
} from "./memory/user-model.js";

// Config
export { ConfigManager, type RookieConfig, type ModelConfig } from "./config.js";
export {
  loadSettings,
  resolveSettingsPaths,
  deepMerge,
  type RookieSettings,
  type SettingsPaths,
  type SettingsLayer,
  type LoadSettingsOptions,
  type LoadedLayer,
  type MergedSettings,
} from "./config/settings.js";

// Slash Commands (P1-T2)
export {
  CommandRegistry,
  parseCommandInput,
  DEFAULT_COMMANDS,
  registerDefaults,
  createDefaultRegistry,
  type SlashCommand,
  type SlashCommandCategory,
  type SlashCommandContext,
  type SlashCommandHandler,
  type SlashCommandResult,
} from "./commands/index.js";

// Transport (P3-T1: NAPI-RS)
export {
  NapiTransport,
  createTransport,
  benchmarkTransport,
  type NapiTransportOptions,
  type NapiRequest,
  type NapiResponse,
  type NapiAddon,
  type TransportFactoryOptions,
  type TransportBenchmark,
} from "./transport/napi.js";

// Gateway (P3-T2: Multi-platform)
export {
  Gateway,
  GatewayRegistry,
  MessageRouter,
  type GatewayConfig,
  type GatewayMessage,
  type GatewaySendOptions,
  type GatewayStats,
  type RouterConfig,
} from "./gateway/base.js";
export {
  FeishuGateway,
  createFeishuGateway,
  createLarkGateway,
  type FeishuConfig,
  type FeishuMessageEvent,
} from "./gateway/feishu.js";

// Utils
export { resolveCoreBinary } from "./utils/binary.js";
