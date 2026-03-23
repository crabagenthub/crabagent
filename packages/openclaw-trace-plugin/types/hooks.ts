/** Minimal hook shapes for typing (mirror OpenClaw plugin hooks). */

export type AgentCtx = {
  sessionId?: string;
  sessionKey?: string;
  /** OpenClaw-configured agent id (e.g. `main`); also derivable from `sessionKey` when omitted. */
  agentId?: string;
  /** OpenClaw hook context: messaging channel when sessionKey is omitted (e.g. control UI hidden). */
  channelId?: string;
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
};

export type AgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
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
