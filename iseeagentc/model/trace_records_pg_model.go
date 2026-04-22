package model

import (
	"database/sql"
	"fmt"
	"strings"

	"iseeagentc/model/sqltokens"
)

var traceRecordsSelectPG = fmt.Sprintf(`
SELECT t.trace_id,
       NULL::text AS session_id,
       (jx.mj #>> '{user_id}') AS user_id,
       t.created_at_ms AS start_time,
       COALESCE(t.ended_at_ms, CASE WHEN COALESCE(t.duration_ms, 0) > 0 THEN t.created_at_ms + t.duration_ms ELSE NULL END, t.updated_at_ms, t.created_at_ms) AS end_time,
       CASE
         WHEN t.is_complete = 0 THEN 'running'
         WHEN COALESCE(t.success, 0) = 1 THEN 'success'
         WHEN COALESCE(t.success, 0) = 0 AND %s THEN 'timeout'
         WHEN COALESCE(t.success, 0) = 0 THEN 'error'
         ELSE 'running'
       END AS status,
       %s AS total_tokens,
       t.metadata_json AS metadata,
       t.created_at_ms AS updated_at,
       SUBSTRING(TRIM(COALESCE(NULLIF(TRIM(COALESCE(jx.ij #>> '{list_input_preview}', '')), ''), NULLIF(TRIM(COALESCE(jx.ij #>> '{prompt}', '')), ''), TRIM(COALESCE(t.input_json, t.name, '')))) FROM 1 FOR %d) AS last_message_preview,
       SUBSTRING(TRIM(COALESCE(t.output_json, '')) FROM 1 FOR %d) AS output_preview,
       t.setting_json AS setting_json,
       t.trace_type AS trace_type,
       t.total_cost AS total_cost,
       t.duration_ms AS duration_ms,
       COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) AS thread_key,
       (SELECT COUNT(*) FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id AND s.span_type = 'llm') AS loop_count,
       (SELECT COUNT(*) FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') AS tool_call_count,
       COALESCE((jx.mj #>> '{saved_tokens_total}')::bigint, 0) AS saved_tokens_total,
       th.agent_name AS thread_agent_name,
       th.channel_name AS thread_channel_name
FROM ` + CT.Traces + ` t
LEFT JOIN ` + CT.Threads + ` th ON th.thread_id = t.thread_id AND th.workspace_name = t.workspace_name AND th.project_name = t.project_name
CROSS JOIN LATERAL (
  SELECT
    (COALESCE(NULLIF(TRIM(COALESCE(t.metadata_json, '')), ''), '{}'))::jsonb AS mj,
    (COALESCE(NULLIF(TRIM(COALESCE(t.output_json, '')), ''), '{}'))::jsonb AS oj,
    (COALESCE(NULLIF(TRIM(COALESCE(t.input_json, '')), ''), '{}'))::jsonb AS ij
) jx
`, sqltokens.TraceRowTimeoutLikeSQLPG, sqltokens.TraceRowTokenIntegerExprPG, listPreviewMaxChars, listPreviewMaxChars)

func buildTraceRecordsWherePostgres(q TraceRecordsListQuery, argStart int) (string, []interface{}, int) {
	nextArg := argStart
	var parts []string
	var args []interface{}
	if q.SinceMs != nil && *q.SinceMs > 0 {
		parts = append(parts, fmt.Sprintf("t.created_at_ms >= $%d", nextArg))
		args = append(args, *q.SinceMs)
		nextArg++
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		parts = append(parts, fmt.Sprintf("t.created_at_ms <= $%d", nextArg))
		args = append(args, *q.UntilMs)
		nextArg++
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		parts = append(parts, fmt.Sprintf("lower(t.workspace_name) = lower($%d::text)", nextArg))
		args = append(args, strings.TrimSpace(*q.WorkspaceName))
		nextArg++
	}
	if q.MinTotalTokens != nil && *q.MinTotalTokens > 0 {
		parts = append(parts, fmt.Sprintf("(%s) >= $%d", sqltokens.TraceRowTokenIntegerExprPG, nextArg))
		args = append(args, *q.MinTotalTokens)
		nextArg++
	}
	if q.MinLoopCount != nil && *q.MinLoopCount > 0 {
		parts = append(parts, fmt.Sprintf("(SELECT COUNT(*) FROM "+CT.Spans+" s WHERE s.trace_id = t.trace_id AND s.span_type = 'llm') >= $%d", nextArg))
		args = append(args, *q.MinLoopCount)
		nextArg++
	}
	if q.MinToolCalls != nil && *q.MinToolCalls > 0 {
		parts = append(parts, fmt.Sprintf("(SELECT COUNT(*) FROM "+CT.Spans+" s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') >= $%d", nextArg))
		args = append(args, *q.MinToolCalls)
		nextArg++
	}
	if q.Search != nil {
		if s := clampSearch(*q.Search); s != nil {
			low := strings.ToLower(*s)
			parts = append(parts, fmt.Sprintf(`(
  position($%d::text in lower(t.trace_id)) > 0
  OR position($%d::text in lower(COALESCE(t.thread_id, ''))) > 0
  OR position($%d::text in lower(COALESCE(t.input_json, ''))) > 0
  OR position($%d::text in lower(COALESCE(t.output_json, ''))) > 0
  OR position($%d::text in lower(COALESCE(t.metadata_json, ''))) > 0
  OR position($%d::text in lower(COALESCE(t.name, ''))) > 0
)`, nextArg, nextArg, nextArg, nextArg, nextArg, nextArg))
			args = append(args, low)
			nextArg++
		}
	}
	ch := ClampFacetFilter(ptrToStringRec(q.Channel))
	ag := ClampFacetFilter(ptrToStringRec(q.Agent))
	if ch != nil || ag != nil {
		sub := []string{"th.thread_id = t.thread_id", "th.workspace_name = t.workspace_name", "th.project_name = t.project_name"}
		if ch != nil {
			sub = append(sub, fmt.Sprintf("th.channel_name = $%d::text", nextArg))
			args = append(args, *ch)
			nextArg++
		}
		if ag != nil {
			sub = append(sub, fmt.Sprintf("th.agent_name = $%d::text", nextArg))
			args = append(args, *ag)
			nextArg++
		}
		parts = append(parts, fmt.Sprintf("EXISTS (SELECT 1 FROM "+CT.Threads+" th WHERE %s)", strings.Join(sub, " AND ")))
	}
	if len(parts) == 0 {
		return "", args, nextArg
	}
	return "WHERE " + strings.Join(parts, " AND "), args, nextArg
}

func buildTraceRecordsSQLPostgres(q TraceRecordsListQuery) (string, []interface{}) {
	where, wp, limitArg := buildTraceRecordsWherePostgres(q, 1)
	dir := "DESC"
	if strings.ToLower(q.Order) == "asc" {
		dir = "ASC"
	}
	sort := strings.ToLower(q.Sort)
	if sort != "tokens" {
		sort = "time"
	}
	orderBy := fmt.Sprintf("t.created_at_ms %s, t.trace_id %s", dir, dir)
	if sort == "tokens" {
		orderBy = fmt.Sprintf("(%s) %s, t.trace_id %s", sqltokens.TraceRowTokenIntegerExprPG, dir, dir)
	}
	sqlStr := traceRecordsSelectPG + " " + where + "\nORDER BY " + orderBy + fmt.Sprintf("\nLIMIT $%d OFFSET $%d", limitArg, limitArg+1)
	return sqlStr, append(append([]interface{}{}, wp...), q.Limit, q.Offset)
}

func buildTraceRecordsCountSQLPostgres(q TraceRecordsListQuery) (string, []interface{}) {
	where, params, _ := buildTraceRecordsWherePostgres(q, 1)
	from := `
FROM ` + CT.Traces + ` t
LEFT JOIN ` + CT.Threads + ` th ON th.thread_id = t.thread_id AND th.workspace_name = t.workspace_name AND th.project_name = t.project_name
CROSS JOIN LATERAL (
  SELECT
    (COALESCE(NULLIF(TRIM(COALESCE(t.metadata_json, '')), ''), '{}'))::jsonb AS mj,
    (COALESCE(NULLIF(TRIM(COALESCE(t.output_json, '')), ''), '{}'))::jsonb AS oj,
    (COALESCE(NULLIF(TRIM(COALESCE(t.input_json, '')), ''), '{}'))::jsonb AS ij
) jx`
	return "SELECT COUNT(*) AS c " + from + " " + where, params
}

func loadTraceRecordsPostgres(db QueryDB, q TraceRecordsListQuery) ([]map[string]interface{}, error) {
	sqlStr, params := buildTraceRecordsSQLPostgres(q)
	rows, err := db.Query(sqlStr, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var out []map[string]interface{}
	for rows.Next() {
		raw := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := map[string]interface{}{}
		for i, c := range cols {
			m[c] = raw[i]
		}
		out = append(out, mapTraceRecordRow(m))
	}
	return out, rows.Err()
}

func countTraceRecordsPostgresModel(db QueryDB, q TraceRecordsListQuery) (int64, error) {
	sqlStr, params := buildTraceRecordsCountSQLPostgres(q)
	var n int64
	err := db.QueryRow(sqlStr, params...).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return n, err
}
