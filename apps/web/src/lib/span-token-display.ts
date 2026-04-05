import type { SemanticSpanRow } from "@/lib/semantic-spans";
import type { TurnWindowMetrics } from "@/lib/user-turn-list";

/** 与语义树 / Collector `usage_json` 解析一致，用于侧栏、抽屉、Run 面板的 Token 展示。 */
export function spanTokenTotals(span: SemanticSpanRow): {
  prompt: number;
  completion: number;
  cacheRead: number;
  /** 仅当服务端显式返回 `total_tokens` 时有值（可与 displayTotal 不同，用于「总计来源」说明）。 */
  total: number | null;
  /** 界面展示的合计：优先 `total_tokens`，否则为 prompt+completion+cacheRead。 */
  displayTotal: number | null;
  hasAny: boolean;
} {
  const prompt = span.prompt_tokens ?? 0;
  const completion = span.completion_tokens ?? 0;
  const cacheRead = span.cache_read_tokens ?? 0;
  const sumParts = prompt + completion + cacheRead;
  const explicitTotal =
    span.total_tokens != null && Number.isFinite(span.total_tokens)
      ? Math.max(0, Math.trunc(span.total_tokens))
      : null;
  const displayTotal = explicitTotal ?? (sumParts > 0 ? sumParts : null);
  const bd =
    span.usage_breakdown &&
    typeof span.usage_breakdown === "object" &&
    !Array.isArray(span.usage_breakdown)
      ? (span.usage_breakdown as Record<string, number>)
      : {};
  const hasAny =
    span.total_tokens != null ||
    prompt > 0 ||
    completion > 0 ||
    cacheRead > 0 ||
    Object.keys(bd).length > 0;
  return {
    prompt,
    completion,
    cacheRead,
    total: explicitTotal,
    displayTotal,
    hasAny,
  };
}

/**
 * Popover 展示：`total_tokens` 与 `total` 统一为 **input + output**（或等价字段 `prompt_tokens` + `completion_tokens`），
 * 避免 API 返回的 total 与分项不一致。
 */
export function normalizeTokenUsageEntriesForDisplay(entries: Record<string, number>): Record<string, number> {
  const e = { ...entries };
  const hasPart =
    "prompt_tokens" in e ||
    "completion_tokens" in e ||
    "input" in e ||
    "output" in e;
  if (!hasPart) {
    return e;
  }
  const p = Math.max(0, Math.trunc(e.prompt_tokens ?? e.input ?? 0));
  const c = Math.max(0, Math.trunc(e.completion_tokens ?? e.output ?? 0));
  const sumIo = p + c;
  e.total_tokens = sumIo;
  if ("total" in e) {
    e.total = sumIo;
  }
  return e;
}

/** 合并 `usage_breakdown` 与 canonical 字段，供 Token 明细卡片与 Popover 统一展示（与语义树 mergeTokenDisplay 一致）。 */
export function semanticSpanTokenEntries(span: SemanticSpanRow): Record<string, number> {
  const bd =
    span.usage_breakdown && typeof span.usage_breakdown === "object" && !Array.isArray(span.usage_breakdown)
      ? (span.usage_breakdown as Record<string, number>)
      : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.trunc(v);
    }
  }
  const set = (k: string, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) {
      return;
    }
    if (out[k] === undefined) {
      out[k] = Math.trunc(v);
    }
  };
  set("prompt_tokens", span.prompt_tokens);
  set("completion_tokens", span.completion_tokens);
  set("cache_read_tokens", span.cache_read_tokens);
  set("total_tokens", span.total_tokens);
  return out;
}

/** 会话抽屉单轮 `TurnWindowMetrics` → 与 `semanticSpanTokenEntries` 同形的 `Record`，供 `TokenUsageDetailsCard` 使用。 */
export function turnWindowTokenEntries(m: TurnWindowMetrics): Record<string, number> {
  const out: Record<string, number> = {};
  const hasAny =
    (m.displayTotal != null && m.displayTotal > 0) ||
    m.promptTokens > 0 ||
    m.completionTokens > 0 ||
    m.cacheReadTokens > 0;
  if (!hasAny) {
    return out;
  }
  out.prompt_tokens = m.promptTokens;
  out.completion_tokens = m.completionTokens;
  if (m.cacheReadTokens > 0) {
    out.cache_read_tokens = m.cacheReadTokens;
  }
  return out;
}
