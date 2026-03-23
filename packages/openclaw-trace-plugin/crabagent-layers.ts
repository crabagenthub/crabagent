/**
 * Structured observability layers (Task / Reasoning / Memory / Tools / State)
 * attached to ingest payloads under `payload.crabagent`.
 * OpenClaw may omit many fields; we forward whatever exists and truncate large blobs.
 */

export const CRABAGENT_LAYERS_SCHEMA = 1 as const;

const MAX_HISTORY_JSON_CHARS = 48_000;
const MAX_RAW_OUTPUT_CHARS = 64_000;
const MAX_TOOL_RESULT_CHARS = 256_000;
const MAX_CONTRIBUTION_JSON_CHARS = 24_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function pickStr(v: unknown): string | undefined {
  if (typeof v !== "string") {
    return undefined;
  }
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function pickNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function pickBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export function truncateTraceText(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n…[truncated ${String(s.length - max)} chars]`;
}

function jsonTruncate(value: unknown, maxChars: number): string | undefined {
  try {
    const s = JSON.stringify(value);
    if (typeof s !== "string") {
      return undefined;
    }
    return truncateTraceText(s, maxChars);
  } catch {
    return undefined;
  }
}

/** Known `llm_input` keys we already map explicitly; other small primitives may be model params. */
const LLM_INPUT_CORE_KEYS = new Set([
  "runId",
  "run_id",
  "sessionId",
  "session_id",
  "provider",
  "model",
  "prompt",
  "systemPrompt",
  "system_prompt",
  "promptBeforeHookPrepend",
  "prompt_before_hook_prepend",
  "historyMessages",
  "history_messages",
  "imagesCount",
  "images_count",
]);

const MODEL_PARAM_HINT_KEYS = [
  "temperature",
  "topP",
  "top_p",
  "maxTokens",
  "max_tokens",
  "maxOutputTokens",
  "max_output_tokens",
  "frequencyPenalty",
  "frequency_penalty",
  "presencePenalty",
  "presence_penalty",
  "stop",
  "seed",
  "reasoningEffort",
  "reasoning_effort",
];

function collectModelParamsFromLlmInputEvent(ev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MODEL_PARAM_HINT_KEYS) {
    if (k in ev && ev[k] !== undefined) {
      out[k] = ev[k] as unknown;
    }
  }
  for (const [k, v] of Object.entries(ev)) {
    if (LLM_INPUT_CORE_KEYS.has(k)) {
      continue;
    }
    if (MODEL_PARAM_HINT_KEYS.includes(k)) {
      continue;
    }
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      out[k] = v;
      continue;
    }
    if (typeof v === "string" && v.length <= 256) {
      out[k] = v;
    }
  }
  return out;
}

function metadataString(md: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const raw = md[k];
    const s = pickStr(raw);
    if (s) {
      return s;
    }
  }
  return undefined;
}

/** Task metadata layer: who / when / entry / intent hints (best-effort from message + ctx). */
export function buildTaskLayerFromMessage(params: {
  content: string;
  contentMaxChars: number;
  metadata: Record<string, unknown>;
  channelLabel?: string;
  messageProvider?: string;
  conversationId?: string;
  /** Hook ctx `accountId` when metadata omits user id. */
  accountId?: string;
  timestamp?: number;
}): Record<string, unknown> {
  const md = params.metadata;
  const userId =
    metadataString(md, [
      "userId",
      "user_id",
      "accountId",
      "account_id",
      "fromUserId",
      "telegramUserId",
    ]) ?? pickStr(params.accountId);
  const device = metadataString(md, ["device", "deviceInfo", "device_info", "client", "userAgent", "user_agent"]);
  const locale = metadataString(md, ["locale", "language", "lang"]);
  const geo =
    metadataString(md, ["geo", "geoLocation", "geo_location", "country", "region", "timezone", "tz"]) ??
    undefined;
  const entryPoint =
    params.channelLabel ||
    params.messageProvider ||
    metadataString(md, ["channel", "entryPoint", "entry_point", "source", "transport"]) ||
    undefined;

  const feedbackRating = pickNum(md.feedbackRating ?? md.feedback_rating ?? md.rating);
  const thumbsUp = pickBool(md.thumbsUp ?? md.thumbs_up);
  const thumbsDown = pickBool(md.thumbsDown ?? md.thumbs_down);
  const userFeedback =
    feedbackRating !== undefined || thumbsUp !== undefined || thumbsDown !== undefined
      ? stripUndefined({
          rating: feedbackRating,
          thumbsUp,
          thumbsDown,
        })
      : undefined;

  const layer: Record<string, unknown> = {
    initialIntentText: truncateTraceText(String(params.content ?? ""), params.contentMaxChars),
    receivedAtMs: typeof params.timestamp === "number" ? params.timestamp : undefined,
    userId,
    userContext: {
      device,
      locale,
      geo,
      conversationId: params.conversationId,
    },
    entryPoint,
    messageProvider: params.messageProvider,
    ...(userFeedback ? { userFeedback } : {}),
  };
  return stripUndefined(layer);
}

export function buildTaskLayerFromSessionStart(params: { resumedFrom?: string }): Record<string, unknown> {
  return stripUndefined({
    resumedFrom: params.resumedFrom,
    kind: "session_start",
  });
}

/** Reasoning: context assembled before model (transcript slice). */
export function buildReasoningContextBeforePrompt(params: {
  messages: unknown;
  promptPreview: string;
  promptCharCount: number;
}): Record<string, unknown> {
  const historySerializedTruncated = jsonTruncate(params.messages, MAX_HISTORY_JSON_CHARS);
  return stripUndefined({
    phase: "before_prompt_build",
    promptCharCount: params.promptCharCount,
    promptPreview: params.promptPreview,
    historySerializedTruncated,
  });
}

/** Reasoning: final LLM request snapshot. */
export function buildReasoningLayerFromLlmInput(params: {
  event: Record<string, unknown>;
  promptTruncated: string;
  systemPromptTruncated?: string;
  promptBeforeHookTruncated?: string;
  historyMessageCount: number;
  historyRoleCounts: Record<string, number>;
}): Record<string, unknown> {
  const modelParams = collectModelParamsFromLlmInputEvent(params.event);
  const historyFedTruncated = jsonTruncate(
    params.event.historyMessages ?? params.event.history_messages,
    MAX_HISTORY_JSON_CHARS,
  );
  return stripUndefined({
    phase: "llm_request",
    provider: pickStr(params.event.provider),
    model: pickStr(params.event.model),
    modelParams: Object.keys(modelParams).length > 0 ? modelParams : undefined,
    systemPromptMirror: params.systemPromptTruncated,
    contextWindow: {
      fedToModel: {
        promptText: params.promptTruncated,
        promptBeforeHookPrepend: params.promptBeforeHookTruncated,
        historyMessageCount: params.historyMessageCount,
        historyRoleCounts: params.historyRoleCounts,
        historyMessagesTruncatedJson: historyFedTruncated,
      },
    },
  });
}

function normalizeUsage(u: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(u)) {
    return undefined;
  }
  const prompt =
    pickNum(u.prompt_tokens) ?? pickNum(u.promptTokens) ?? pickNum(u.input_tokens) ?? pickNum(u.inputTokens);
  const completion =
    pickNum(u.completion_tokens) ??
    pickNum(u.completionTokens) ??
    pickNum(u.output_tokens) ??
    pickNum(u.outputTokens);
  const total = pickNum(u.total_tokens) ?? pickNum(u.totalTokens);
  const out = stripUndefined({
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    raw: u,
  });
  return Object.keys(out).length > 0 ? out : { raw: u };
}

/** Reasoning: model output + usage. */
export function buildReasoningLayerFromLlmOutput(params: {
  event: Record<string, unknown>;
  assistantTexts: string[];
}): Record<string, unknown> {
  const texts = params.assistantTexts.map((t) => String(t ?? ""));
  const combined = texts.join("\n---\n");
  return stripUndefined({
    phase: "llm_response",
    provider: pickStr(params.event.provider),
    model: pickStr(params.event.model),
    tokenMetrics: normalizeUsage(params.event.usage),
    rawOutputText: truncateTraceText(combined, MAX_RAW_OUTPUT_CHARS),
    assistantMessageCount: texts.length,
  });
}

/** Memory / RAG hints from hook_contribution (structure varies by plugin). */
export function buildMemoryLayerFromHookContribution(params: {
  sourceHook: string;
  pluginId: string;
  contribution: Record<string, unknown>;
  toolName?: string;
}): Record<string, unknown> {
  const blob = jsonTruncate(params.contribution, MAX_CONTRIBUTION_JSON_CHARS);
  const memoryHits = params.contribution.memoryHits ?? params.contribution.memory_hits;
  const searchQueries = params.contribution.searchQueries ?? params.contribution.search_queries;
  const relevance = params.contribution.relevanceScores ?? params.contribution.relevance_scores;
  const compression =
    params.contribution.contextCompressionRatio ?? params.contribution.context_compression_ratio;

  return stripUndefined({
    sourceHook: params.sourceHook,
    contributingPluginId: params.pluginId,
    toolName: params.toolName,
    memoryHits: Array.isArray(memoryHits) ? memoryHits : undefined,
    searchQueries: Array.isArray(searchQueries) ? searchQueries : undefined,
    relevanceScores: isPlainObject(relevance) || Array.isArray(relevance) ? relevance : undefined,
    contextCompressionRatio: pickNum(compression),
    contributionJsonTruncated: blob,
  });
}

/** Tool execution layer (before / after merge at ingest side per event). */
export function buildToolLayerBefore(params: {
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    phase: "before",
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    args: params.params,
  };
}

export function buildToolLayerAfter(params: {
  event: Record<string, unknown>;
  toolName: string;
  toolCallId?: string;
}): Record<string, unknown> {
  const result =
    params.event.result ??
    params.event.output ??
    params.event.returnValue ??
    params.event.return_value ??
    params.event.data;
  const trimmed =
    params.event.resultForLlm ??
    params.event.result_for_llm ??
    params.event.trimmedResult ??
    params.event.trimmed_result ??
    params.event.summaryForLlm ??
    params.event.summary_for_llm;

  let resultRawTruncated: string | undefined;
  if (typeof result === "string") {
    resultRawTruncated = truncateTraceText(result, MAX_TOOL_RESULT_CHARS);
  } else if (result !== undefined) {
    resultRawTruncated = jsonTruncate(result, MAX_TOOL_RESULT_CHARS);
  }

  let resultForLlmTruncated: string | undefined;
  if (typeof trimmed === "string") {
    resultForLlmTruncated = truncateTraceText(trimmed, MAX_TOOL_RESULT_CHARS);
  } else if (trimmed !== undefined) {
    resultForLlmTruncated = jsonTruncate(trimmed, MAX_TOOL_RESULT_CHARS);
  }

  const parentToolCallId = pickStr(
    params.event.parentToolCallId ?? params.event.parent_tool_call_id ?? params.event.parentCallId,
  );
  const retryCount = pickNum(params.event.retryCount ?? params.event.retry_count ?? params.event.attempt);

  return stripUndefined({
    phase: "after",
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    hasError: Boolean(params.event.error),
    error: pickStr(params.event.error),
    durationMs: pickNum(params.event.durationMs ?? params.event.duration_ms),
    executionLatencyMs: pickNum(params.event.durationMs ?? params.event.duration_ms),
    resultRawTruncated,
    resultForLlmTruncated,
    parentToolCallId,
    retryCount,
    callDepth: pickNum(params.event.depth ?? params.event.callDepth),
  });
}

/** State / errors from agent_end. */
export function buildStateLayerFromAgentEnd(params: {
  success: boolean;
  error?: string;
  durationMs?: number;
  messageCount?: number;
}): Record<string, unknown> {
  return stripUndefined({
    status: params.success ? "completed" : "failed",
    errorLog: params.error ? { message: params.error } : undefined,
    durationMs: params.durationMs,
    messageCount: params.messageCount,
  });
}

export function buildStateLayerFromToolError(params: {
  toolName: string;
  toolCallId?: string;
  error?: string;
  durationMs?: number;
  retryCount?: number;
}): Record<string, unknown> {
  return stripUndefined({
    kind: "tool_error",
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    errorLog: params.error ? { message: params.error } : undefined,
    durationMs: params.durationMs,
    retryCount: params.retryCount,
  });
}

/** Attach prune metrics under reasoning (context window compression). */
export function buildReasoningContextPruneRef(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    phase: "context_prune_applied",
    mode: payload.mode,
    messageCountBefore: payload.messageCountBefore,
    messageCountAfter: payload.messageCountAfter,
    estimatedCharsBefore: payload.estimatedCharsBefore,
    estimatedCharsAfter: payload.estimatedCharsAfter,
    charDelta: payload.charDelta,
    contextCompressionRatio:
      typeof payload.estimatedCharsBefore === "number" &&
      typeof payload.estimatedCharsAfter === "number" &&
      payload.estimatedCharsBefore > 0
        ? payload.estimatedCharsAfter / payload.estimatedCharsBefore
        : undefined,
  };
}

export function wrapCrabagentLayers(partial: {
  task?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  state?: Record<string, unknown>;
}): Record<string, unknown> {
  const layers = stripUndefined({ ...partial });
  if (Object.keys(layers).length === 0) {
    return {};
  }
  return {
    crabagent: {
      schema: CRABAGENT_LAYERS_SCHEMA,
      layers,
    },
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) {
      delete out[k];
    } else if (isPlainObject(out[k])) {
      const nested = stripUndefined(out[k] as Record<string, unknown>);
      if (Object.keys(nested).length === 0) {
        delete out[k];
      } else {
        out[k] = nested;
      }
    }
  }
  return out as T;
}
