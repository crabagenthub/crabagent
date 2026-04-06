/**
 * `opik_spans.usage_preview`：可选冗余列；**会话列表 token 为 `usage_json` 上 `SUM(input)+SUM(output)`**（见 `THREAD_LLM_SPAN_USAGE_JSON_TOKEN_EXPR`）。
 * 入库时仍可写入与 `usage_json` 同形的 `input` / `output` / `cacheRead` / `total` 便于排查。
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || String(raw).trim() === "") {
    return {};
  }
  try {
    const v = JSON.parse(String(raw)) as unknown;
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when `usage`-shaped object has any token counter. */
function usageHasTokenSignals(u: unknown): boolean {
  if (!isRecord(u)) {
    return false;
  }
  for (const k of [
    "total",
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

function usageNumericFields(u: Record<string, unknown>): {
  prompt: number;
  completion: number;
  cacheRead: number;
  explicitTotal: number | null;
} {
  const um = isRecord(u.usageMetadata) ? (u.usageMetadata as Record<string, unknown>) : undefined;
  const first = (obj: Record<string, unknown>, keys: string[]): number | null => {
    for (const k of keys) {
      const n = asNum(obj[k]);
      if (n !== null) {
        return n;
      }
    }
    return null;
  };
  const pt =
    first(u, [
      "prompt_tokens",
      "promptTokens",
      "input_tokens",
      "inputTokens",
      "prompt_token_count",
      "promptTokenCount",
      "inputTokenCount",
    ]) ?? (um ? first(um, ["promptTokenCount", "inputTokenCount"]) : null);
  const ct =
    first(u, [
      "completion_tokens",
      "completionTokens",
      "output_tokens",
      "outputTokens",
      "completion_token_count",
      "candidatesTokenCount",
      "outputTokenCount",
    ]) ?? (um ? first(um, ["candidatesTokenCount", "outputTokenCount"]) : null);
  const cr =
    first(u, [
      "cache_read_tokens",
      "cacheReadTokens",
      "cached_prompt_tokens",
      "cache_read_input_tokens",
      "cacheRead",
    ]) ?? (um ? first(um, ["cachedContentTokenCount", "cacheReadInputTokens"]) : null);
  const tt =
    first(u, ["total_tokens", "totalTokens", "totalTokenCount", "total"]) ??
    (um ? first(um, ["totalTokenCount", "totalTokens"]) : null);
  return {
    prompt: pt ?? 0,
    completion: ct ?? 0,
    cacheRead: cr ?? 0,
    explicitTotal: tt,
  };
}

function recordFromUsageLike(u: unknown): Record<string, unknown> {
  if (isRecord(u)) {
    return u;
  }
  if (typeof u === "string") {
    return parseJsonRecord(u);
  }
  return {};
}

/**
 * 从插件/Opik 的 `usage` 对象生成 `usage_preview` JSON（与上游
 * `{ input, output, cacheRead, total }` 对齐）；无可用 token 时返回 null。
 */
export function usagePreviewJsonFromUsage(u: unknown): string | null {
  const r = recordFromUsageLike(u);
  if (!usageHasTokenSignals(r)) {
    return null;
  }
  const { prompt, completion, cacheRead, explicitTotal } = usageNumericFields(r);
  const input = Math.max(0, Math.trunc(prompt));
  const output = Math.max(0, Math.trunc(completion));
  const cache = Math.max(0, Math.trunc(cacheRead));
  let total: number | null =
    explicitTotal != null && Number.isFinite(explicitTotal) ? Math.max(0, Math.trunc(explicitTotal)) : null;
  if (total == null) {
    const sum = input + output + cache;
    total = sum > 0 ? sum : null;
  }
  if (total == null || !Number.isFinite(total)) {
    return null;
  }
  return JSON.stringify({
    input,
    output,
    cacheRead: cache,
    total,
  });
}

/**
 * 解析入库行：优先 `usage_preview` / `usagePreview`，否则从 `usage` 推导。
 * 若本次未提供可解析的用量且存在旧行，保留 `prevPreview`。
 */
export function resolveSpanUsagePreviewJson(
  row: Record<string, unknown>,
  prevPreview: string | null,
): string | null {
  const explicit = row.usage_preview ?? row.usagePreview;
  if (explicit != null) {
    if (typeof explicit === "string") {
      const t = explicit.trim();
      return t.length > 0 ? t : null;
    }
    try {
      return JSON.stringify(explicit);
    } catch {
      return null;
    }
  }
  if (row.usage !== undefined) {
    const j = usagePreviewJsonFromUsage(row.usage);
    if (j != null) {
      return j;
    }
  }
  return prevPreview;
}
