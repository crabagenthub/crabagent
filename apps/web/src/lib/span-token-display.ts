import type { SemanticSpanRow } from "@/lib/semantic-spans";

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
