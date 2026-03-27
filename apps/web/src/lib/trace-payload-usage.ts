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

function mergeFromUsageMetadata(um: Record<string, unknown>): {
  prompt: number;
  completion: number;
  total: number | null;
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
  return { prompt, completion, total };
}

/**
 * 与 Collector / OpenClaw 各路径对齐：从 `llm_output` 等事件的 payload 中读取 usage（含 Gemini `usageMetadata`）。
 */
export function usageFromTracePayload(payload: Record<string, unknown>): {
  prompt: number;
  completion: number;
  total: number | null;
} {
  let prompt = 0;
  let completion = 0;
  let total: number | null = null;

  const u = payload.usage;
  if (isPlainObject(u)) {
    prompt = promptFromUsageShape(u);
    completion = completionFromUsageShape(u);
    total = totalFromUsageShape(u);
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
  }

  return { prompt, completion, total };
}
