package sqltokens

import (
	_ "embed"
	"strings"

	"iseeagentc/internal/sqltables"
)

// TraceRowTimeoutLikeSQLForAlias 与 observe-list-filters traceRowTimeoutLikeSqlForAlias 一致。
func TraceRowTimeoutLikeSQLForAlias(alias string) string {
	a := strings.TrimSpace(alias)
	if a == "" {
		a = "t"
	}
	return `(
  instr(lower(COALESCE(` + a + `.error_info_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(` + a + `.error_info_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(` + a + `.output_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(` + a + `.output_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(` + a + `.metadata_json, '')), 'timeout') > 0
)`
}

// 与 services/collector/src/observe-list-filters.ts 一致。
const TraceRowTimeoutLikeSQL = `(
  instr(lower(COALESCE(t.error_info_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(t.error_info_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(t.output_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(t.output_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(t.metadata_json, '')), 'timeout') > 0
)`

const SpanRowTimeoutLikeSQL = `(
  instr(lower(COALESCE(s.error_info_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(s.error_info_json, '')), 'timed out') > 0
  OR instr(lower(COALESCE(s.output_json, '')), 'timeout') > 0
  OR instr(lower(COALESCE(s.output_json, '')), 'timed out') > 0
)`

// SpanRowTokenCoalesceInner 与 opik-tokens-sql.ts 中 SPAN_ROW_TOKEN_COALESCE_INNER 等价（去首尾空白）。
const SpanRowTokenCoalesceInner = `
        CAST(json_extract(s.usage_json, '$.total') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.total_tokens') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.totalTokens') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.total_tokens') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.totalTokens') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usageMetadata.totalTokens') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.usage_json, '$.usage.usageMetadata.totalTokens') AS INTEGER),
        NULLIF(
          COALESCE(
            CAST(json_extract(s.usage_json, '$.prompt_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.promptTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.prompt_token_count') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.input_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.inputTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.inputTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.prompt_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.promptTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.input_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.inputTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.prompt_token_count') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),
            0
          )
          + COALESCE(
            CAST(json_extract(s.usage_json, '$.completion_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.completionTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.completion_token_count') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.output_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.outputTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.outputTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.completion_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.completionTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.output_tokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.outputTokens') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.usage_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),
            0
          ),
          0
        ),
        CAST(json_extract(s.output_json, '$.usage.total_tokens') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usage.totalTokens') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usage.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usageMetadata.totalTokens') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usage.usageMetadata.totalTokenCount') AS INTEGER),
        CAST(json_extract(s.output_json, '$.usage.usageMetadata.totalTokens') AS INTEGER),
        NULLIF(
          COALESCE(
            CAST(json_extract(s.output_json, '$.usage.prompt_tokens') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.promptTokens') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.input_tokens') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.inputTokens') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.inputTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),
            0
          )
          + COALESCE(
            CAST(json_extract(s.output_json, '$.usage.completion_tokens') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.output_tokens') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usageMetadata.outputTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),
            CAST(json_extract(s.output_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),
            0
          ),
          0
        )
`

// TraceRowTokenIntegerExpr 与 opik-tokens-sql.ts TRACE_ROW_TOKEN_INTEGER_EXPR 对齐。
var TraceRowTokenIntegerExpr = "CAST(COALESCE(\n" +
	"  json_extract(t.metadata_json, '$.usage.total_tokens'),\n" +
	"  json_extract(t.metadata_json, '$.usage.totalTokens'),\n" +
	"  json_extract(t.metadata_json, '$.usage.totalTokenCount'),\n" +
	"  json_extract(t.metadata_json, '$.usage.usageMetadata.totalTokenCount'),\n" +
	"  json_extract(t.metadata_json, '$.usage.usageMetadata.totalTokens'),\n" +
	"  json_extract(t.metadata_json, '$.total_tokens'),\n" +
	"  CAST(json_extract(t.metadata_json, '$.usageMetadata.totalTokenCount') AS INTEGER),\n" +
	"  CAST(json_extract(t.metadata_json, '$.usageMetadata.totalTokens') AS INTEGER),\n" +
	"  NULLIF(\n" +
	"    COALESCE(\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.prompt_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.promptTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.prompt_token_count') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.input_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.inputTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.promptTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.inputTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),\n" +
	"      0\n" +
	"    )\n" +
	"    + COALESCE(\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.completion_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.completionTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.completion_token_count') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.output_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.outputTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.candidatesTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.outputTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.metadata_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),\n" +
	"      0\n" +
	"    ),\n" +
	"    0\n" +
	"  ),\n" +
	"  CAST(json_extract(t.output_json, '$.usage.total_tokens') AS INTEGER),\n" +
	"  CAST(json_extract(t.output_json, '$.usage.totalTokens') AS INTEGER),\n" +
	"  CAST(json_extract(t.output_json, '$.usage.totalTokenCount') AS INTEGER),\n" +
	"  CAST(json_extract(t.output_json, '$.usage.usageMetadata.totalTokenCount') AS INTEGER),\n" +
	"  CAST(json_extract(t.output_json, '$.usage.usageMetadata.totalTokens') AS INTEGER),\n" +
	"  CAST(json_extract(t.output_json, '$.usageMetadata.totalTokenCount') AS INTEGER),\n" +
	"  CAST(json_extract(t.output_json, '$.usageMetadata.totalTokens') AS INTEGER),\n" +
	"  NULLIF(\n" +
	"    COALESCE(\n" +
	"      CAST(json_extract(t.output_json, '$.usage.prompt_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.promptTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.prompt_token_count') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.input_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.inputTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.promptTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.inputTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.usageMetadata.promptTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.usageMetadata.inputTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usageMetadata.promptTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usageMetadata.inputTokenCount') AS INTEGER),\n" +
	"      0\n" +
	"    )\n" +
	"    + COALESCE(\n" +
	"      CAST(json_extract(t.output_json, '$.usage.completion_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.completionTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.completion_token_count') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.output_tokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.outputTokens') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.candidatesTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.outputTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.usageMetadata.candidatesTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usage.usageMetadata.outputTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usageMetadata.candidatesTokenCount') AS INTEGER),\n" +
	"      CAST(json_extract(t.output_json, '$.usageMetadata.outputTokenCount') AS INTEGER),\n" +
	"      0\n" +
	"    ),\n" +
	"    0\n" +
	"  ),\n" +
	"  (\n" +
	"    SELECT SUM(COALESCE(" + trimSQL(SpanRowTokenCoalesceInner) + ", 0))\n" +
	"    FROM " + sqltables.TableAgentSpans + " s\n" +
	"    WHERE s.trace_id = t.trace_id\n" +
	"  )\n" +
	") AS INTEGER)"

func trimSQL(s string) string {
	// 去掉首尾空白与换行，与 TS .trim() 用于子查询拼接一致。
	i, j := 0, len(s)
	for i < j && (s[i] == ' ' || s[i] == '\n' || s[i] == '\t' || s[i] == '\r') {
		i++
	}
	for j > i && (s[j-1] == ' ' || s[j-1] == '\n' || s[j-1] == '\t' || s[j-1] == '\r') {
		j--
	}
	return s[i:j]
}

// SpanRowTokenIntegerExpr 用于 span 列表 ORDER BY。
var SpanRowTokenIntegerExpr = "CAST(COALESCE(" + trimSQL(SpanRowTokenCoalesceInner) + ", 0) AS INTEGER)"

const ThreadLLMSpanUsageJSONTokenExpr = `(
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
)`

var ThreadLLMSpanUsageTotalSumSQL = "(SELECT COALESCE(SUM(" + ThreadLLMSpanUsageJSONTokenExpr + "), 0)\n" +
	"FROM " + sqltables.TableAgentSpans + " s\n" +
	"INNER JOIN " + sqltables.TableAgentTraces + " t ON t.trace_id = s.trace_id\n" +
	"  AND t.thread_id = th.thread_id\n" +
	"  AND t.workspace_name = th.workspace_name\n" +
	"  AND t.project_name = th.project_name\n" +
	"WHERE s.span_type = 'llm')"

//go:embed pg_trace_timeout.gen.txt
var pgTraceTimeout string

//go:embed pg_trace_tokens.gen.txt
var pgTraceTokens string

// TraceRowTimeoutLikeSQLPG 为 PostgreSQL 版 timeout 判定（与 observe-list-filters 语义一致）。
var TraceRowTimeoutLikeSQLPG = strings.TrimSpace(pgTraceTimeout)

// TraceRowTokenIntegerExprPG 为 PostgreSQL 版 token 汇总；要求查询中带 LATERAL jx（mj/oj），见 pg_trace_tokens.gen.txt。
var TraceRowTokenIntegerExprPG = strings.TrimSpace(pgTraceTokens)
