import type { LlmOutputEvent } from "./types/hooks.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when object has token counters (aligned with collector `usageHasTokenSignals` coverage). */
function looseUsageSignals(u: Record<string, unknown>): boolean {
  for (const k of [
    "total_tokens",
    "totalTokens",
    "totalTokenCount",
    "prompt_tokens",
    "completion_tokens",
    "input_tokens",
    "output_tokens",
    "prompt_token_count",
    "completion_token_count",
    "candidatesTokenCount",
    "promptTokenCount",
    "inputTokenCount",
    "outputTokenCount",
  ]) {
    const v = u[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return true;
    }
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return true;
    }
  }
  const um = u.usageMetadata;
  if (isRecord(um)) {
    for (const k of ["totalTokenCount", "totalTokens", "promptTokenCount", "candidatesTokenCount"]) {
      const v = um[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * OpenClaw 各路径下 usage 可能挂在 `usage`、`usageMetadata`（Gemini 等）或其它键上；
 * 聚合成单对象供 `onLlmOutput` / span.usage 使用（`readUsageTokenParts` 可读嵌套 `usageMetadata`）。
 */
export function pickLlmOutputUsage(ev: LlmOutputEvent | Record<string, unknown>): Record<string, unknown> | undefined {
  const e = ev as Record<string, unknown>;
  const direct = e.usage;
  if (isRecord(direct) && looseUsageSignals(direct)) {
    return direct;
  }
  const umTop = e.usageMetadata;
  if (isRecord(umTop) && looseUsageSignals(umTop)) {
    return { usageMetadata: umTop };
  }
  for (const k of ["response", "raw", "result", "message", "providerRaw"] as const) {
    const inner = e[k];
    if (!isRecord(inner)) {
      continue;
    }
    const iu = inner.usage;
    if (isRecord(iu) && looseUsageSignals(iu)) {
      return iu;
    }
    const ium = inner.usageMetadata;
    if (isRecord(ium) && looseUsageSignals(ium)) {
      return { usageMetadata: ium };
    }
  }
  if (isRecord(direct)) {
    return direct;
  }
  return undefined;
}
