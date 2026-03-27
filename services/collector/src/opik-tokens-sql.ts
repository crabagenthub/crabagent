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

/** `json_extract` on trace `output_json` under `$.usage.<key>` (some runtimes只把 usage 挂在 output 上). */
function uOut(key: string): string {
  return `json_extract(t.output_json, '$.usage.${key}')`;
}

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
    SELECT SUM(
      COALESCE(
        CAST(${uSpan("total_tokens")} AS INTEGER),
        CAST(${uSpan("totalTokens")} AS INTEGER),
        CAST(${uSpan("totalTokenCount")} AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokens') AS INTEGER),
        NULLIF(
          COALESCE(
            CAST(${uSpan("prompt_tokens")} AS INTEGER),
            CAST(${uSpan("promptTokens")} AS INTEGER),
            CAST(${uSpan("prompt_token_count")} AS INTEGER),
            CAST(${uSpan("input_tokens")} AS INTEGER),
            CAST(${uSpan("inputTokens")} AS INTEGER),
            CAST(${uSpan("promptTokenCount")} AS INTEGER),
            CAST(${uSpan("inputTokenCount")} AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
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
            CAST(json_extract(s.usage_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
            0
          ),
          0
        ),
        0
      )
    )
    FROM opik_spans s
    WHERE s.trace_id = t.trace_id
  )
) AS INTEGER)`;

/** Integer token estimate for one span row `s` (for ORDER BY on span lists). */
export const SPAN_ROW_TOKEN_INTEGER_EXPR = `CAST(COALESCE(
        CAST(${uSpan("total_tokens")} AS INTEGER),
        CAST(${uSpan("totalTokens")} AS INTEGER),
        CAST(${uSpan("totalTokenCount")} AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokens') AS INTEGER),
        NULLIF(
          COALESCE(
            CAST(${uSpan("prompt_tokens")} AS INTEGER),
            CAST(${uSpan("promptTokens")} AS INTEGER),
            CAST(${uSpan("prompt_token_count")} AS INTEGER),
            CAST(${uSpan("input_tokens")} AS INTEGER),
            CAST(${uSpan("inputTokens")} AS INTEGER),
            CAST(${uSpan("promptTokenCount")} AS INTEGER),
            CAST(${uSpan("inputTokenCount")} AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
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
            CAST(json_extract(s.usage_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
            0
          ),
          0
        ),
        0
      ) AS INTEGER)`;
