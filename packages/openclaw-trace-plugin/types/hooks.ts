/** Minimal hook shapes for typing (mirror OpenClaw plugin hooks). */

export type AgentCtx = {
  sessionId?: string;
  sessionKey?: string;
  /** OpenClaw-configured agent id (e.g. `main`); also derivable from `sessionKey` when omitted. */
  agentId?: string;
  /** Display name from OpenClaw config (`agents.list[].name`) or same as `agentId`. */
  agentName?: string;
  /** OpenClaw hook context: messaging channel when sessionKey is omitted (e.g. control UI hidden). */
  channelId?: string;
  /** Provider chat/thread id when present; keeps one trace when hooks omit session_key. */
  conversationId?: string;
  messageProvider?: string;
};

export type SessionStartEvent = {
  sessionId: string;
  sessionKey?: string;
  resumedFrom?: string;
};

/** OpenClaw `message_received` hook (inbound user/channel message). */
export type MessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type LlmInputEvent = {
  runId: string;
  /** Present on OpenClaw payloads; ctx.sessionId may be omitted on some paths. */
  sessionId?: string;
  provider: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  /**
   * Prompt after bootstrap warnings, before `before_prompt_build` / legacy `before_agent_start`
   * prepends `prependContext` (memory, plugins, etc.).
   */
  promptBeforeHookPrepend?: string;
  historyMessages: unknown[];
  imagesCount: number;
  /** Forwarded into `crabagent.layers.reasoning.modelParams` when present. */
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** OpenClaw 路由表 / 控制面可能提供的展示标签（多版本字段名由 `extractLlmInputRoutingMeta` 兜底）。 */
  label?: string;
  kind?: string;
  thinking?: string | boolean;
  fast?: string | boolean;
  verbose?: string | boolean;
  reasoning?: string | boolean;
  maxContextTokens?: number;
  routing?: Record<string, unknown>;
  route?: Record<string, unknown>;
  openclaw?: Record<string, unknown>;
  /**
   * OpenClaw `llm_input`：与会话 store 对齐的只读快照（`PluginHookOpenclawSessionSnapshot`）。
   * 由 `extractLlmInputRoutingMeta` 并入 `openclaw_routing`。
   */
  openclawSession?: Record<string, unknown>;
};

/** OpenClaw `before_model_resolve` — runs before provider/model resolution; no session messages yet. */
export type BeforeModelResolveEvent = {
  prompt: string;
};

/** OpenClaw `before_prompt_build` — session transcript + user prompt before plugin context injection. */
export type BeforePromptBuildEvent = {
  prompt: string;
  messages: unknown[];
};

/** OpenClaw 旧版 `before_agent_start`（与 before_prompt_build 同相位）；部分路径只触发其一。 */
export type BeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

/** OpenClaw `hook_contribution` — one row per modifying-hook handler return (plugin / tool intercept). */
export type HookContributionEvent = {
  sourceHook: string;
  pluginId: string;
  contribution: Record<string, unknown>;
  toolName?: string;
  toolCallId?: string;
};

/** OpenClaw `context_prune_applied` — Pi context extension mutated transcript. */
export type ContextPruneAppliedMessageChange = {
  index: number;
  role: string;
  toolName?: string;
  charsBefore: number;
  charsAfter: number;
  charDelta: number;
  phase: "soft_trim" | "hard_clear" | "unknown";
};

export type ContextPruneAppliedEvent = {
  mode: string;
  messageCountBefore: number;
  messageCountAfter: number;
  estimatedCharsBefore: number;
  estimatedCharsAfter: number;
  roleCountsBefore: Record<string, number>;
  roleCountsAfter: Record<string, number>;
  messageChanges?: ContextPruneAppliedMessageChange[];
  messageChangesTruncated?: boolean;
};

export type LlmOutputEvent = {
  runId: string;
  sessionId?: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  usage?: Record<string, unknown>;
  /** Gemini / 部分 provider 将计数放在顶层 `usageMetadata`。 */
  usageMetadata?: Record<string, unknown>;
};

export type AgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
  /** OpenClaw 有时把会话标识放在 payload 上而非 hook ctx；与 ctx 合并后才能对齐 pending。 */
  sessionId?: string;
  sessionKey?: string;
  conversationId?: string;
  channelId?: string;
  messageProvider?: string;
  agentId?: string;
  agentName?: string;
};

export type BeforeToolEvent = {
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  runId?: string;
};

export type AfterToolEvent = {
  toolName: string;
  toolCallId?: string;
  error?: string;
  durationMs?: number;
  runId?: string;
  /** Full tool return; mirrored in `crabagent.layers.tools` when OpenClaw sends it. */
  result?: unknown;
  /** Subset passed back to the model; mirrored when present. */
  resultForLlm?: unknown;
  retryCount?: number;
};

export type CompactionBeforeEvent = {
  messageCount: number;
  compactingCount?: number;
  sessionFile?: string;
};

export type CompactionAfterEvent = {
  messageCount: number;
  compactedCount: number;
  sessionFile?: string;
};

export type SubagentSpawnedEvent = {
  runId: string;
  childSessionKey: string;
  /** Child agent id (OpenClaw `subagent_spawned` payload). */
  agentId?: string;
  label?: string;
  mode: "run" | "session";
};

export type SubagentCtx = AgentCtx & {
  requesterSessionKey?: string;
  runId?: string;
};

export type SubagentEndedEvent = {
  runId?: string;
  targetSessionKey: string;
  targetKind: string;
  reason: string;
  outcome?: string;
};
