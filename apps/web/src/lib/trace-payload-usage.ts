import { parseCrabagentPayload } from "@/lib/trace-crabagent-layers";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function pickNonNegativeNum(u: unknown): number {
  if (typeof u === "number" && Number.isFinite(u) && u >= 0) {
    return u;
  }
  return 0;
}

function promptFromUsageShape(u: Record<string, unknown>): number {
  return (
    pickNonNegativeNum(u.prompt_tokens) ||
    pickNonNegativeNum(u.promptTokens) ||
    pickNonNegativeNum(u.input_tokens) ||
    pickNonNegativeNum(u.inputTokens) ||
    pickNonNegativeNum(u.prompt_token_count) ||
    pickNonNegativeNum(u.promptTokenCount) ||
    pickNonNegativeNum(u.inputTokenCount)
  );
}

function completionFromUsageShape(u: Record<string, unknown>): number {
  return (
    pickNonNegativeNum(u.completion_tokens) ||
    pickNonNegativeNum(u.completionTokens) ||
    pickNonNegativeNum(u.output_tokens) ||
    pickNonNegativeNum(u.outputTokens) ||
    pickNonNegativeNum(u.completion_token_count) ||
    pickNonNegativeNum(u.candidatesTokenCount) ||
    pickNonNegativeNum(u.outputTokenCount)
  );
}

function totalFromUsageShape(u: Record<string, unknown>): number | null {
  const tRaw =
    pickNonNegativeNum(u.total_tokens) ||
    pickNonNegativeNum(u.totalTokens) ||
    pickNonNegativeNum(u.totalTokenCount);
  return tRaw > 0 ? tRaw : null;
}

function cacheReadFromUsageShape(u: Record<string, unknown>): number {
  const direct =
    pickNonNegativeNum(u.cache_read_tokens) ||
    pickNonNegativeNum(u.cacheReadTokens) ||
    pickNonNegativeNum(u.cached_prompt_tokens) ||
    pickNonNegativeNum(u.prompt_cache_hit_tokens);
  const ptd = u.prompt_tokens_details;
  if (isPlainObject(ptd)) {
    return direct || pickNonNegativeNum(ptd.cached_tokens);
  }
  return direct;
}

function mergeFromUsageMetadata(um: Record<string, unknown>): {
  prompt: number;
  completion: number;
  total: number | null;
  cacheRead: number;
} {
  const prompt =
    pickNonNegativeNum(um.promptTokenCount) ||
    pickNonNegativeNum(um.inputTokenCount) ||
    pickNonNegativeNum(um.promptTokens);
  const completion =
    pickNonNegativeNum(um.candidatesTokenCount) ||
    pickNonNegativeNum(um.outputTokenCount) ||
    pickNonNegativeNum(um.completionTokens);
  const tRaw =
    pickNonNegativeNum(um.totalTokenCount) ||
    pickNonNegativeNum(um.totalTokens) ||
    pickNonNegativeNum(um.total_tokens);
  const total = tRaw > 0 ? tRaw : null;
  const cacheRead =
    pickNonNegativeNum(um.cachedContentTokenCount) ||
    pickNonNegativeNum(um.cacheReadInputTokens) ||
    pickNonNegativeNum(um.cached_content_token_count);
  return { prompt, completion, total, cacheRead };
}

/**
 * 与 Collector / OpenClaw 各路径对齐：从 `llm_output` 等事件的 payload 中读取 usage（含 Gemini `usageMetadata`）。
 */
export function usageFromTracePayload(payload: Record<string, unknown>): {
  prompt: number;
  completion: number;
  total: number | null;
  cacheRead: number;
} {
  let prompt = 0;
  let completion = 0;
  let total: number | null = null;
  let cacheRead = 0;

  const u = payload.usage;
  if (isPlainObject(u)) {
    prompt = promptFromUsageShape(u);
    completion = completionFromUsageShape(u);
    total = totalFromUsageShape(u);
    cacheRead = cacheReadFromUsageShape(u);
  }

  const umTop = payload.usageMetadata;
  if (isPlainObject(umTop)) {
    const m = mergeFromUsageMetadata(umTop);
    if (!prompt) {
      prompt = m.prompt;
    }
    if (!completion) {
      completion = m.completion;
    }
    if (total == null && m.total != null) {
      total = m.total;
    }
    if (!cacheRead) {
      cacheRead = m.cacheRead;
    }
  }

  const crab = parseCrabagentPayload(payload);
  const tm = crab?.reasoning?.tokenMetrics;
  if (isPlainObject(tm)) {
    if (!prompt) {
      prompt =
        pickNonNegativeNum(tm.prompt_tokens) ||
        pickNonNegativeNum(tm.promptTokens) ||
        pickNonNegativeNum(tm.input_tokens) ||
        pickNonNegativeNum(tm.inputTokens);
    }
    if (!completion) {
      completion =
        pickNonNegativeNum(tm.completion_tokens) ||
        pickNonNegativeNum(tm.completionTokens) ||
        pickNonNegativeNum(tm.output_tokens) ||
        pickNonNegativeNum(tm.outputTokens);
    }
    if (!cacheRead) {
      cacheRead =
        pickNonNegativeNum(tm.cache_read_tokens) ||
        pickNonNegativeNum(tm.cacheReadTokens) ||
        pickNonNegativeNum(tm.cached_prompt_tokens);
    }
  }

  return { prompt, completion, total, cacheRead };
}

export type ThreadLlmUsageAggregate = {
  llmOutputCount: number;
  prompt: number;
  completion: number;
  cacheRead: number;
  /** 与回合窗口一致：有分项合优先；否则累加各条显式 total */
  displayTotal: number | null;
};

/** 会话级：汇总时间线上全部 `llm_output` 的 usage（用于会话抽屉侧栏）。 */
export function aggregateThreadLlmOutputUsage(
  events: readonly { type?: string | null; payload?: unknown }[],
): ThreadLlmUsageAggregate {
  let promptSum = 0;
  let completionSum = 0;
  let cacheSum = 0;
  let explicitTotalSum = 0;
  let explicitTotalRows = 0;
  let llmOutputCount = 0;

  for (const e of events) {
    if ((e.type ?? "") !== "llm_output") {
      continue;
    }
    llmOutputCount += 1;
    const payload =
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : {};
    const u = usageFromTracePayload(payload);
    promptSum += u.prompt;
    completionSum += u.completion;
    cacheSum += u.cacheRead;
    if (u.total != null && u.total > 0) {
      explicitTotalSum += u.total;
      explicitTotalRows += 1;
    }
  }

  const sumParts = promptSum + completionSum + cacheSum;
  const displayTotal =
    sumParts > 0 ? sumParts : explicitTotalRows > 0 ? explicitTotalSum : null;

  return {
    llmOutputCount,
    prompt: promptSum,
    completion: completionSum,
    cacheRead: cacheSum,
    displayTotal,
  };
}
