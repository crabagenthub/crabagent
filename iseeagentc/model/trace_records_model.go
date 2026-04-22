package model

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"iseeagentc/model/sqltokens"
)

const listPreviewMaxChars = 16384

type TraceRecordsListQuery struct {
	Limit          int
	Offset         int
	Order          string
	Sort           string
	MinTotalTokens *int64
	MinLoopCount   *int64
	MinToolCalls   *int64
	Search         *string
	SinceMs        *int64
	UntilMs        *int64
	Channel        *string
	Agent          *string
	ListStatuses   []ObserveListStatus
	WorkspaceName  *string
}

var traceRecordsSelect = fmt.Sprintf(`
SELECT t.trace_id,
       NULL AS session_id,
       CAST(json_extract(t.metadata_json, '$.user_id') AS TEXT) AS user_id,
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
       SUBSTR(TRIM(COALESCE(NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.list_input_preview'), '')), ''), NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.prompt'), '')), ''), TRIM(COALESCE(t.input_json, t.name, '')))), 1, %d) AS last_message_preview,
       SUBSTR(TRIM(COALESCE(t.output_json, '')), 1, %d) AS output_preview,
       t.setting_json AS setting_json,
       t.trace_type AS trace_type,
       t.total_cost AS total_cost,
       t.duration_ms AS duration_ms,
       COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) AS thread_key,
       (SELECT COUNT(*) FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id AND s.span_type = 'llm') AS loop_count,
       (SELECT COUNT(*) FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') AS tool_call_count,
       CAST(COALESCE(json_extract(t.metadata_json, '$.saved_tokens_total'), 0) AS INTEGER) AS saved_tokens_total,
       th.agent_name AS thread_agent_name,
       th.channel_name AS thread_channel_name
FROM ` + CT.Traces + ` t
LEFT JOIN ` + CT.Threads + ` th ON th.thread_id = t.thread_id AND th.workspace_name = t.workspace_name AND th.project_name = t.project_name
`, sqltokens.TraceRowTimeoutLikeSQL, sqltokens.TraceRowTokenIntegerExpr, listPreviewMaxChars, listPreviewMaxChars)

func clampSearch(s string) *string {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	if len(t) > 200 {
		t = t[:200]
	}
	return &t
}

func ptrToStringRec(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func buildTraceRecordsWhere(q TraceRecordsListQuery) (string, []interface{}) {
	var parts []string
	var params []interface{}
	if q.SinceMs != nil && *q.SinceMs > 0 {
		parts = append(parts, "t.created_at_ms >= ?")
		params = append(params, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		parts = append(parts, "t.created_at_ms <= ?")
		params = append(params, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		parts = append(parts, "lower(t.workspace_name) = lower(?)")
		params = append(params, strings.TrimSpace(*q.WorkspaceName))
	}
	if q.MinTotalTokens != nil && *q.MinTotalTokens > 0 {
		parts = append(parts, fmt.Sprintf("(%s) >= ?", sqltokens.TraceRowTokenIntegerExpr))
		params = append(params, *q.MinTotalTokens)
	}
	if q.MinLoopCount != nil && *q.MinLoopCount > 0 {
		parts = append(parts, "(SELECT COUNT(*) FROM "+CT.Spans+" s WHERE s.trace_id = t.trace_id AND s.span_type = 'llm') >= ?")
		params = append(params, *q.MinLoopCount)
	}
	if q.MinToolCalls != nil && *q.MinToolCalls > 0 {
		parts = append(parts, "(SELECT COUNT(*) FROM "+CT.Spans+" s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') >= ?")
		params = append(params, *q.MinToolCalls)
	}
	if q.Search != nil {
		if s := clampSearch(*q.Search); s != nil {
			parts = append(parts, `(instr(lower(t.trace_id), lower(?)) > 0 OR instr(lower(COALESCE(t.thread_id, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.input_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.output_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.metadata_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.name, '')), lower(?)) > 0)`)
			for i := 0; i < 6; i++ {
				params = append(params, *s)
			}
		}
	}
	ch := ClampFacetFilter(ptrToStringRec(q.Channel))
	ag := ClampFacetFilter(ptrToStringRec(q.Agent))
	if ch != nil || ag != nil {
		sub := []string{"th.thread_id = t.thread_id", "th.workspace_name = t.workspace_name", "th.project_name = t.project_name"}
		if ch != nil {
			sub = append(sub, "th.channel_name = ?")
			params = append(params, *ch)
		}
		if ag != nil {
			sub = append(sub, "th.agent_name = ?")
			params = append(params, *ag)
		}
		parts = append(parts, fmt.Sprintf("EXISTS (SELECT 1 FROM "+CT.Threads+" th WHERE %s)", strings.Join(sub, " AND ")))
	}
	if len(q.ListStatuses) > 0 {
		var st []string
		for _, s := range q.ListStatuses {
			switch s {
			case StatusRunning:
				st = append(st, "t.is_complete = 0")
			case StatusSuccess:
				st = append(st, "t.is_complete = 1 AND COALESCE(t.success, 0) = 1")
			case StatusError:
				st = append(st, fmt.Sprintf("t.is_complete = 1 AND COALESCE(t.success, 0) = 0 AND NOT %s", sqltokens.TraceRowTimeoutLikeSQL))
			case StatusTimeout:
				st = append(st, fmt.Sprintf("t.is_complete = 1 AND COALESCE(t.success, 0) = 0 AND %s", sqltokens.TraceRowTimeoutLikeSQL))
			}
		}
		if len(st) == 1 {
			parts = append(parts, st[0])
		} else if len(st) > 1 {
			parts = append(parts, "("+strings.Join(st, " OR ")+")")
		}
	}
	if len(parts) == 0 {
		return "", params
	}
	return "WHERE " + strings.Join(parts, " AND "), params
}

func buildTraceRecordsSQL(q TraceRecordsListQuery) (string, []interface{}) {
	where, wp := buildTraceRecordsWhere(q)
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
		orderBy = fmt.Sprintf("(%s) %s, t.trace_id %s", sqltokens.TraceRowTokenIntegerExpr, dir, dir)
	}
	sqlStr := traceRecordsSelect + " " + where + "\nORDER BY " + orderBy + "\nLIMIT ? OFFSET ?"
	return sqlStr, append(append([]interface{}{}, wp...), q.Limit, q.Offset)
}

func buildTraceRecordsCountSQL(q TraceRecordsListQuery) (string, []interface{}) {
	where, params := buildTraceRecordsWhere(q)
	return "SELECT COUNT(*) AS c FROM " + CT.Traces + " t " + where, params
}

func normalizeTraceTypeForList(raw interface{}) string {
	v := strings.ToLower(strings.TrimSpace(fmt.Sprint(raw)))
	switch v {
	case "external", "subagent", "async_command", "system":
		return v
	default:
		return "external"
	}
}

func tagsFromSettingJSON(raw interface{}) []string {
	if raw == nil {
		return nil
	}
	s := strings.TrimSpace(fmt.Sprint(raw))
	if s == "" {
		return nil
	}
	var o map[string]interface{}
	if json.Unmarshal([]byte(s), &o) != nil || o == nil {
		return nil
	}
	var out []string
	if k, ok := o["kind"].(string); ok && strings.TrimSpace(k) != "" {
		out = append(out, strings.TrimSpace(k))
	}
	for _, k := range []string{"thinking", "verbose", "reasoning", "fast"} {
		if v := strings.TrimSpace(fmt.Sprint(o[k])); v != "" && strings.ToLower(v) != "inherit" {
			out = append(out, fmt.Sprintf("%s:%s", k, v))
		}
	}
	return out
}

func toInt64Rec(v interface{}) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case int:
		return int64(t)
	case float64:
		return int64(t)
	case []byte:
		var x int64
		_, _ = fmt.Sscan(string(t), &x)
		return x
	default:
		var x int64
		_, _ = fmt.Sscan(fmt.Sprint(v), &x)
		return x
	}
}

func nullableFloatRec(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case float64:
		if !math.IsNaN(t) && !math.IsInf(t, 0) {
			return t
		}
	case int64:
		return float64(t)
	case []byte:
		var f float64
		if _, err := fmt.Sscan(string(t), &f); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return f
		}
	}
	n := toInt64Rec(v)
	if n != 0 {
		return float64(n)
	}
	return nil
}

func stringFromScanRec(v interface{}) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case []byte:
		return strings.TrimSpace(string(t))
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func mapTraceRecordRow(m map[string]interface{}) map[string]interface{} {
	meta := map[string]interface{}{}
	switch t := m["metadata"].(type) {
	case string:
		_ = json.Unmarshal([]byte(t), &meta)
	case []byte:
		_ = json.Unmarshal(t, &meta)
	}
	if ta := stringFromScanRec(m["thread_agent_name"]); ta != "" {
		meta["agent_name"] = ta
	}
	if tc := stringFromScanRec(m["thread_channel_name"]); tc != "" {
		meta["channel"] = tc
	}
	spent := toInt64Rec(m["total_tokens"])
	saved := toInt64Rec(m["saved_tokens_total"])
	var opt *float64
	if denom := spent + saved; denom > 0 {
		v := math.Round(float64(saved)/float64(denom)*1000) / 10
		opt = &v
	}
	return map[string]interface{}{
		"trace_id":              m["trace_id"],
		"session_id":            m["session_id"],
		"user_id":               m["user_id"],
		"start_time":            m["start_time"],
		"end_time":              m["end_time"],
		"status":                m["status"],
		"total_tokens":          m["total_tokens"],
		"updated_at":            m["updated_at"],
		"last_message_preview":  m["last_message_preview"],
		"output_preview":        m["output_preview"],
		"thread_key":            m["thread_key"],
		"metadata":              meta,
		"loop_count":            toInt64Rec(m["loop_count"]),
		"tool_call_count":       toInt64Rec(m["tool_call_count"]),
		"saved_tokens_total":    saved,
		"optimization_rate_pct": opt,
		"tags":                  tagsFromSettingJSON(m["setting_json"]),
		"trace_type":            normalizeTraceTypeForList(m["trace_type"]),
		"total_cost":            nullableFloatRec(m["total_cost"]),
		"duration_ms":           nullableFloatRec(m["duration_ms"]),
	}
}

func loadTraceRecords(db QueryDB, q TraceRecordsListQuery) ([]map[string]interface{}, error) {
	sqlStr, params := buildTraceRecordsSQL(q)
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

func countTraceRecordsModel(db QueryDB, q TraceRecordsListQuery) (int64, error) {
	sqlStr, params := buildTraceRecordsCountSQL(q)
	var n int64
	err := db.QueryRow(sqlStr, params...).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return n, err
}
