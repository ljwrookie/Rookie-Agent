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
  // B1: New structured tool types (CCB-aligned 35 fields)
  type ToolDefinition, type ToolBuilderConfig, type ToolProgressCallback,
  type PermissionMatcher, type RetryPolicy, type ToolMetrics, type DenyRule,
  buildTool, filterToolsByDenyRules,
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
  saveSnapshot,
  restoreSnapshot,
  listSnapshots,
  getSnapshot,
  checkFileModified,
  getSnapshotDir,
  type FileSnapshot,
  type SnapshotMetadata,
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
  // B9.2: Edit quality upgrades
  normalizeQuotes,
  findActualString,
  findAllOccurrences,
  checkFileSize,
  validateMtime,
  recordFileMtime,
  getRecordedMtime,
  clearRecordedMtime,
} from "./tools/builtin/edit.js";
export { globFilesTool, globToRegExp } from "./tools/builtin/glob.js";
export { grepFilesTool } from "./tools/builtin/grep.js";
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
// B10.6: Brief mode tool
export {
  briefTool,
  isBriefMode,
  setBriefMode,
  getBriefModePrompt,
} from "./tools/builtin/brief.js";
// B10.7: MCP resources tools
export {
  listMcpResourcesTool,
  readMcpResourceTool,
  registerMcpClient,
  unregisterMcpClient,
  getMcpClient,
  getAllMcpClients,
} from "./tools/builtin/mcp_resources.js";
// B10.8: V2 Task system tools
export {
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  taskGetTool,
  type TaskV2,
  type TaskStatusV2,
  type TaskPriority,
  type TaskStoreV2,
} from "./tools/builtin/tasks_v2.js";

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
  PROVIDER_REGISTRY,
  type ProviderName,
} from "./models/providers/index.js";
export {
  ModelRouter, type TaskType, type RoutingStrategy,
  DefaultStrategy, CostAwareStrategy, FallbackStrategy,
} from "./models/router.js";
export {
  HealthRegistry, ProviderHealth,
  type HealthMetrics, type HealthCheckOptions, type RequestRecord,
  type CircuitState,
} from "./models/health.js";

// Skills (Phase 2: SKILL.md + SkillLearner)
export { SkillRegistry, type SkillRegistryOptions } from "./skills/registry.js";
export {
  type Skill, type SkillManifest, type Trigger, type Example, type CompletedTask,
  type SkillMdFrontmatter, type SkillMd,
  type SkillCandidate, type SkillUsage, type SkillImprovement,
} from "./skills/types.js";
export { SkillLoader } from "./skills/loader.js";
export { SkillLearner, type SkillRewriteCandidate } from "./skills/learner.js";
// P8-T1: Semantic Skill Matcher
export {
  SemanticSkillMatcher,
  skillToEntry,
  exportEmbeddings,
  type SemanticMatchResult,
  type MatcherConfig,
  type SkillEmbeddings,
} from "./skills/matcher.js";
// P8-T4: Skill Manifest & Installer
export {
  ManifestValidator,
  createManifest,
  skillToManifest,
  manifestToSkill,
  updateManifestVersion,
  type SkillManifestV1,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
} from "./skills/manifest.js";
export {
  SkillInstaller,
  type InstallOptions,
  type InstallResult,
  type InstalledSkill,
  createInstallCommand,
  createListCommand,
  createRemoveCommand,
} from "./skills/installer.js";

// Agent
export type { RunReActOptions } from "./agent/react.js";

// D1: Cross-process Subagent with MCP Stdio (SubagentManager already exported above)
export { SubagentWorker } from "./agent/subagent-worker.js";

// D4: Pipe IPC / LAN Group Control
export {
  PipeManager,
  initPipeManager,
  getGlobalPipeManager,
  setGlobalPipeManager,
  type PipeMessage,
  type PipeInstance,
  type PipeManagerOptions,
} from "./pipes/index.js";

// D5: Transcript Persistence
export {
  TranscriptManager,
  initTranscriptManager,
  getGlobalTranscriptManager,
  setGlobalTranscriptManager,
  type TranscriptRecord,
  type TranscriptSession,
  type TranscriptOptions,
} from "./harness/transcript.js";

// D6: Scheduler Daemon
export {
  SchedulerDaemon,
  isDaemonRunning,
  getDaemonLogs,
  EXIT_CODE_PERMANENT,
  EXIT_CODE_RESTART,
  type DaemonOptions,
  type DaemonStatus,
  type PendingTask,
} from "./scheduler/daemon.js";

// D7: LLM-as-Judge
export {
  llmJudge,
  llmJudgePairwise,
  LLMJudgeEvaluatorAgent,
  type LLMJudgeOptions,
  type LLMJudgeResult,
  type PairwiseComparisonOptions,
  type PairwiseComparisonResult,
} from "./agent/evaluator.js";

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

// Hooks (Phase 1 + Phase-C enhancements)
export { HookRegistry } from "./hooks/registry.js";
export type {
  HookFetch,
  HookPromptRunner,
  HookRegistryOptions,
} from "./hooks/registry.js";
export {
  type HookEvent,
  type HookConfig,
  type HookContext,
  type HookResult,
  type HookPriority,
  type HookTrustLevel,
  type HookExecutionMode,
  type HookLLMDecision,
  type HookChainResult,
  type PendingAsyncHook,
  HOOK_PRIORITY_VALUE,
} from "./hooks/types.js";
// C6: Trust management
export {
  getProjectTrust,
  isProjectTrusted,
  trustProject,
  untrustProject,
  resetProjectTrust,
  listTrustedProjects,
  clearTrustCache,
  type ProjectTrustLevel,
  type TrustEntry,
  type TrustStore,
} from "./hooks/trust.js";

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

// User Model (P2-T4: third-layer memory + P8-T2: LLM Reflector)
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
export {
  LLMReflector,
  ReflectorFactory,
  IncrementalReflector,
  type DialecticalAnalysis,
  type UserHypothesis,
  type CounterEvidence,
  type SynthesisResult,
  type LLMReflectorConfig,
  type ReflectorType,
  type ReflectorFactoryConfig,
  type IncrementalUpdate,
} from "./memory/llm-reflector.js";

// Config
export { ConfigManager, type RookieConfig, type ModelConfig } from "./config.js";
export {
  loadSettings,
  saveSettings,
  resolveSettingsPaths,
  deepMerge,
  type RookieSettings,
  type SettingsPaths,
  type SettingsLayer,
  type LoadSettingsOptions,
  type SaveSettingsOptions,
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
  type TransportFactoryOptions,
  type TransportBenchmark,
} from "./transport/napi.js";
export { type RookieNapiAddon as NapiAddon } from "./transport/napi-types.js";

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

// Voice (TTS/STT)
export {
  VoiceManager,
  getVoiceManager,
  getTTSEngine,
  getSTTEngine,
  textToSpeech,
  speechToText,
  speechToTextBuffer,
  type TTSOptions,
  type STTOptions,
  type TTSResult,
  type STTResult,
  type TTSProvider,
  type STTProvider,
  type VoiceConfig,
} from "./tools/voice/index.js";

// Utils
export { resolveCoreBinary } from "./utils/binary.js";

// P8-T3: Plugin System
export {
  PluginContextImpl,
  globalPluginLogger,
  HookExecutorImpl,
  PermissionDeniedError,
  type HookExecutor,
  type VetoResult,
} from "./plugins/api.js";
export { type PluginContext } from "./plugins/types.js";
export {
  PluginLoader,
  PluginLoadError,
  type PluginLoaderOptions,
  type LoadedPlugin,
} from "./plugins/loader.js";
export {
  telemetryPlugin,
  gitIntegrationPlugin,
  autoSavePlugin,
} from "./plugins/builtin/index.js";
export type {
  Plugin,
  PluginMeta,
  PluginConfig,
  PluginPermission,
  CommandDefinition,
  CommandContext,
  HookDefinition,
  HookContext as PluginHookContext,
  PluginManifest,
  SandboxOptions,
  SandboxedPlugin,
  PluginRegistryEvents,
  PluginLogger,
  PluginApi,
  EventHandler,
  EventMeta,
  ArgSchema,
  OptionSchema,
} from "./plugins/types.js";
