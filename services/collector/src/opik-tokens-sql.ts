/**
 * SQLite helpers for aggregating LLM usage tokens from `opik_traces.metadata_json` and `opik_spans.usage_json`.
 * Covers OpenAI-style (prompt/completion/total), Anthropic-style (input/output), and camelCase variants.
 */

/** `json_extract` on `metadata_json` under `$.usage.<key>` for trace alias `t`. */
function uMeta(key: string): string {
  return `json_extract(t.metadata_json, '$.usage.${key}')`;
}

/** `json_extract` on `usage_json` under `$.<key>` for span alias `s`. */
function uSpan(key: string): string {
  return `json_extract(s.usage_json, '$.${key}')`;
}

/** OpenAI-style shape: `usage_json` = `{ "usage": { "prompt_tokens": … } }`. */
function uSpanNested(key: string): string {
  return `json_extract(s.usage_json, '$.usage.${key}')`;
}

/** Span `output_json` may carry `usage` only on the completion payload. */
function uSpanOutput(key: string): string {
  return `json_extract(s.output_json, '$.usage.${key}')`;
}

/** `json_extract` on trace `output_json` under `$.usage.<key>` (some runtimes只把 usage 挂在 output 上). */
function uOut(key: string): string {
  return `json_extract(t.output_json, '$.usage.${key}')`;
}

/**
 * COALESCE body for one `opik_spans` row alias `s` (no outer CAST).
 * Used by span list ORDER BY and trace-row fallback SUM(span tokens).
 */
export const SPAN_ROW_TOKEN_COALESCE_INNER = `
        CAST(${uSpan("total")} AS INTEGER),
        CAST(${uSpan("total_tokens")} AS INTEGER),
        CAST(${uSpan("totalTokens")} AS INTEGER),
        CAST(${uSpan("totalTokenCount")} AS INTEGER),
        CAST(${uSpanNested("total_tokens")} AS INTEGER),
        CAST(${uSpanNested("totalTokens")} AS INTEGER),
        CAST(${uSpanNested("totalTokenCount")} AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokens') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.usageMetadata.totalTokens') AS INTEGER),
        NULLIF(
          COALESCE(
            CAST(${uSpan("prompt_tokens")} AS INTEGER),
            CAST(${uSpan("promptTokens")} AS INTEGER),
            CAST(${uSpan("prompt_token_count")} AS INTEGER),
            CAST(${uSpan("input_tokens")} AS INTEGER),
            CAST(${uSpan("inputTokens")} AS INTEGER),
            CAST(${uSpan("promptTokenCount")} AS INTEGER),
            CAST(${uSpan("inputTokenCount")} AS INTEGER),
            CAST(${uSpanNested("prompt_tokens")} AS INTEGER),
            CAST(${uSpanNested("promptTokens")} AS INTEGER),
            CAST(${uSpanNested("input_tokens")} AS INTEGER),
            CAST(${uSpanNested("inputTokens")} AS INTEGER),
            CAST(${uSpanNested("prompt_token_count")} AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),
            0
          )
          + COALESCE(
            CAST(${uSpan("completion_tokens")} AS INTEGER),
            CAST(${uSpan("completionTokens")} AS INTEGER),
            CAST(${uSpan("completion_token_count")} AS INTEGER),
            CAST(${uSpan("output_tokens")} AS INTEGER),
            CAST(${uSpan("outputTokens")} AS INTEGER),
            CAST(${uSpan("candidatesTokenCount")} AS INTEGER),
            CAST(${uSpan("outputTokenCount")} AS INTEGER),
            CAST(${uSpanNested("completion_tokens")} AS INTEGER),
            CAST(${uSpanNested("completionTokens")} AS INTEGER),
            CAST(${uSpanNested("output_tokens")} AS INTEGER),
            CAST(${uSpanNested("outputTokens")} AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),
            0
          ),
          0
        ),
        CAST(${uSpanOutput("total_tokens")} AS INTEGER),
        CAST(${uSpanOutput("totalTokens")} AS INTEGER),
        CAST(${uSpanOutput("totalTokenCount")} AS INTEGER),
        CAST(json_extract(s.output_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usageMetadata.totalTokens') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usage.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usage.usageMetadata.totalTokens') AS INTEGER),
        NULLIF(
          COALESCE(
            CAST(${uSpanOutput("prompt_tokens")} AS INTEGER),
            CAST(${uSpanOutput("promptTokens")} AS INTEGER),
            CAST(${uSpanOutput("input_tokens")} AS INTEGER),
            CAST(${uSpanOutput("inputTokens")} AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),
            0
          )
          + COALESCE(
            CAST(${uSpanOutput("completion_tokens")} AS INTEGER),
            CAST(${uSpanOutput("output_tokens")} AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),
            0
          ),
          0
        )
`;

/**
 * Integer token estimate for one trace row `t` (COALESCE chain; ends with span SUM).
 * Used inside `SELECT SUM(...) GROUP BY thread` and per-trace selects.
 */
export const TRACE_ROW_TOKEN_INTEGER_EXPR = `CAST(COALESCE(
  ${uMeta("total_tokens")},
  ${uMeta("totalTokens")},
  ${uMeta("totalTokenCount")},
  ${uMeta("usageMetadata.totalTokenCount")},
  ${uMeta("usageMetadata.totalTokens")},
  json_extract(t.metadata_json, '$.total_tokens'),
  CAST(json_extract(t.metadata_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
  CAST(json_extract(t.metadata_json, '$.usageMetadata.totalTokens') AS INTEGER),
  NULLIF(
    COALESCE(
      CAST(${uMeta("prompt_tokens")} AS INTEGER),
      CAST(${uMeta("promptTokens")} AS INTEGER),
      CAST(${uMeta("prompt_token_count")} AS INTEGER),
      CAST(${uMeta("input_tokens")} AS INTEGER),
      CAST(${uMeta("inputTokens")} AS INTEGER),
      CAST(${uMeta("promptTokenCount")} AS INTEGER),
      CAST(${uMeta("inputTokenCount")} AS INTEGER),
      CAST(${uMeta("usageMetadata.promptTokenCount")} AS INTEGER),
      CAST(${uMeta("usageMetadata.inputTokenCount")} AS INTEGER),
      0
    )
    + COALESCE(
      CAST(${uMeta("completion_tokens")} AS INTEGER),
      CAST(${uMeta("completionTokens")} AS INTEGER),
      CAST(${uMeta("completion_token_count")} AS INTEGER),
      CAST(${uMeta("output_tokens")} AS INTEGER),
      CAST(${uMeta("outputTokens")} AS INTEGER),
      CAST(${uMeta("candidatesTokenCount")} AS INTEGER),
      CAST(${uMeta("outputTokenCount")} AS INTEGER),
      CAST(${uMeta("usageMetadata.candidatesTokenCount")} AS INTEGER),
      CAST(${uMeta("usageMetadata.outputTokenCount")} AS INTEGER),
      0
    ),
    0
  ),
  CAST(${uOut("total_tokens")} AS INTEGER),
  CAST(${uOut("totalTokens")} AS INTEGER),
  CAST(${uOut("totalTokenCount")} AS INTEGER),
  CAST(json_extract(t.output_json, '$.usage.usageMetadata.totalTokenCount') AS INTEGER),
  CAST(json_extract(t.output_json, '$.usage.usageMetadata.totalTokens') AS INTEGER),
  CAST(json_extract(t.output_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
  CAST(json_extract(t.output_json, '$.usageMetadata.totalTokens') AS INTEGER),
  NULLIF(
    COALESCE(
      CAST(${uOut("prompt_tokens")} AS INTEGER),
      CAST(${uOut("promptTokens")} AS INTEGER),
      CAST(${uOut("prompt_token_count")} AS INTEGER),
      CAST(${uOut("input_tokens")} AS INTEGER),
      CAST(${uOut("inputTokens")} AS INTEGER),
      CAST(${uOut("promptTokenCount")} AS INTEGER),
      CAST(${uOut("inputTokenCount")} AS INTEGER),
      CAST(json_extract(t.output_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),
      CAST(json_extract(t.output_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),
      CAST(json_extract(t.output_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
      CAST(json_extract(t.output_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
      0
    )
    + COALESCE(
      CAST(${uOut("completion_tokens")} AS INTEGER),
      CAST(${uOut("completionTokens")} AS INTEGER),
      CAST(${uOut("completion_token_count")} AS INTEGER),
      CAST(${uOut("output_tokens")} AS INTEGER),
      CAST(${uOut("outputTokens")} AS INTEGER),
      CAST(${uOut("candidatesTokenCount")} AS INTEGER),
      CAST(${uOut("outputTokenCount")} AS INTEGER),
      CAST(json_extract(t.output_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),
      CAST(json_extract(t.output_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),
      CAST(json_extract(t.output_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
      CAST(json_extract(t.output_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
      0
    ),
    0
  ),
  (
    SELECT SUM(COALESCE(${SPAN_ROW_TOKEN_COALESCE_INNER.trim()}, 0))
    FROM opik_spans s
    WHERE s.trace_id = t.trace_id
  )
) AS INTEGER)`;

/** Integer token estimate for one span row `s` (for ORDER BY on span lists). */
export const SPAN_ROW_TOKEN_INTEGER_EXPR = `CAST(COALESCE(${SPAN_ROW_TOKEN_COALESCE_INNER.trim()}, 0) AS INTEGER)`;

/**
 * 会话列表：对 `usage_json` 按 span **分别**取 input / output（含常见别名），再
 * `SUM(input) + SUM(output)`，**不使用** `total` / `cacheRead`。
 */
export const THREAD_LLM_SPAN_USAGE_JSON_TOKEN_EXPR = `(
  COALESCE(
    CAST(json_extract(s.usage_json, '$.input') AS INTEGER),
    CAST(json_extract(s.usage_json, '$.prompt_tokens') AS INTEGER),
    CAST(json_extract(s.usage_json, '$.input_tokens') AS INTEGER),
    0
  ) +
  COALESCE(
    CAST(json_extract(s.usage_json, '$.output') AS INTEGER),
    CAST(json_extract(s.usage_json, '$.completion_tokens') AS INTEGER),
    CAST(json_extract(s.usage_json, '$.output_tokens') AS INTEGER),
    0
  )
)`;

export const THREAD_LLM_SPAN_USAGE_TOTAL_SUM_SQL = `(SELECT COALESCE(SUM(${THREAD_LLM_SPAN_USAGE_JSON_TOKEN_EXPR}), 0)
FROM opik_spans s
INNER JOIN opik_traces t ON t.trace_id = s.trace_id
  AND t.thread_id = th.thread_id
  AND t.workspace_name = th.workspace_name
  AND t.project_name = th.project_name
WHERE s.span_type = 'llm')`;
