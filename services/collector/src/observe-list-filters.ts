/** Shared facet/status helpers for thread / trace / span list APIs. */

export function clampFacetFilter(s: string | undefined): string | undefined {
  if (typeof s !== "string") {
    return undefined;
  }
  const t = s.trim();
  if (t.length === 0) {
    return undefined;
  }
  return t.length > 200 ? t.slice(0, 200) : t;
}

export type ObserveListStatus = "running" | "success" | "error" | "timeout";

export function parseObserveListStatus(raw: string | undefined): ObserveListStatus | undefined {
  if (raw === "running" || raw === "success" || raw === "error" || raw === "timeout") {
    return raw;
  }
  return undefined;
}

/** `alias` = SQLite table alias for `opik_traces`; failed complete traces that look like timeout. */
export function traceRowTimeoutLikeSqlForAlias(alias: string): string {
  const a = alias.trim() || "t";
  return `(
  instr(lower(COALESCE(${a}.error_info_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(${a}.error_info_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(${a}.output_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(${a}.output_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(${a}.metadata_json, '')), 'timeout') > 0
)`;
}

/** `t` = opik_traces row; failed complete traces that look like timeout. */
export const TRACE_ROW_TIMEOUT_LIKE_SQL = traceRowTimeoutLikeSqlForAlias("t");

/** `s` = opik_spans row. */
export const SPAN_ROW_TIMEOUT_LIKE_SQL = `(
  instr(lower(COALESCE(s.error_info_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(s.error_info_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(s.output_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(s.output_json, '')), 'timed out') > 0
)`;
