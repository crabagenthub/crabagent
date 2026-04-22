package model

import (
	"fmt"
	"strings"

	textparser "iseeagentc/internal/parser"
	"iseeagentc/model/sqltokens"
)

type SpanRecordsListQuery struct {
	Limit         int
	Offset        int
	Order         string
	Sort          string
	Search        *string
	SinceMs       *int64
	UntilMs       *int64
	Channel       *string
	Agent         *string
	SpanType      *ObserveSpanListType
	ListStatuses  []ObserveListStatus
	WorkspaceName *string
}

const spanPreview = 4096

var spanListFailureSQL = `TRIM(COALESCE(s.error_info_json, '')) <> ''`
var spanSelectSQL = `
SELECT s.span_id, s.trace_id, s.parent_span_id, s.name, s.span_type, s.start_time_ms, s.end_time_ms,
 CASE WHEN s.duration_ms IS NOT NULL AND s.duration_ms > 0 THEN s.duration_ms
      WHEN s.start_time_ms IS NOT NULL AND s.end_time_ms IS NOT NULL AND s.end_time_ms >= s.start_time_ms THEN s.end_time_ms - s.start_time_ms
      WHEN s.start_time_ms IS NOT NULL AND s.end_time_ms IS NOT NULL THEN ABS(s.end_time_ms - s.start_time_ms)
      ELSE NULL END AS duration_ms,
 s.model, s.provider, s.is_complete,
 SUBSTR(TRIM(COALESCE(s.input_json, '')), 1, ` + fmt.Sprint(spanPreview) + `) AS input_preview,
 SUBSTR(TRIM(COALESCE(s.output_json, '')), 1, ` + fmt.Sprint(spanPreview) + `) AS output_preview,
 COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) AS thread_key, t.workspace_name, t.project_name,
 th.agent_name, th.channel_name, s.usage_json,
 (` + sqltokens.SpanRowTokenIntegerExpr + `) AS total_tokens,
 CASE
   WHEN s.is_complete = 0 THEN 'running'
   WHEN s.is_complete = 1 AND TRIM(COALESCE(s.error_info_json, '')) = '' THEN 'success'
   WHEN s.is_complete = 1 AND ` + sqltokens.SpanRowTimeoutLikeSQL + ` THEN 'timeout'
   ELSE 'error' END AS list_status
FROM ` + CT.Spans + ` s
LEFT JOIN ` + CT.Traces + ` t ON t.trace_id = s.trace_id
LEFT JOIN ` + CT.Threads + ` th ON th.thread_id = t.thread_id AND th.workspace_name = t.workspace_name AND th.project_name = t.project_name`

func buildSpanRecordsWhere(q SpanRecordsListQuery) (string, []interface{}) {
	var parts []string
	var params []interface{}
	if q.SinceMs != nil && *q.SinceMs > 0 {
		parts = append(parts, "COALESCE(s.start_time_ms, t.created_at_ms, 0) >= ?")
		params = append(params, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		parts = append(parts, "COALESCE(s.start_time_ms, t.created_at_ms, 0) <= ?")
		params = append(params, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		parts = append(parts, "lower(t.workspace_name) = lower(?)")
		params = append(params, strings.TrimSpace(*q.WorkspaceName))
	}
	if q.Search != nil {
		if s := clampSearch(*q.Search); s != nil {
			parts = append(parts, `(instr(lower(s.span_id), lower(?)) > 0 OR instr(lower(s.trace_id), lower(?)) > 0 OR instr(lower(COALESCE(s.name, '')), lower(?)) > 0 OR instr(lower(COALESCE(s.input_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(s.output_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.thread_id, '')), lower(?)) > 0)`)
			for i := 0; i < 6; i++ {
				params = append(params, *s)
			}
		}
	}
	if ch := ClampFacetFilter(ptrToStringRec(q.Channel)); ch != nil {
		parts = append(parts, "th.channel_name = ?")
		params = append(params, *ch)
	}
	if ag := ClampFacetFilter(ptrToStringRec(q.Agent)); ag != nil {
		parts = append(parts, "th.agent_name = ?")
		params = append(params, *ag)
	}
	if q.SpanType != nil {
		parts = append(parts, "lower(s.span_type) = ?")
		params = append(params, string(*q.SpanType))
	}
	if len(q.ListStatuses) > 0 {
		var st []string
		for _, s := range q.ListStatuses {
			switch s {
			case StatusRunning:
				st = append(st, "s.is_complete = 0")
			case StatusSuccess:
				st = append(st, "s.is_complete = 1 AND TRIM(COALESCE(s.error_info_json, '')) = ''")
			case StatusError:
				st = append(st, fmt.Sprintf("s.is_complete = 1 AND %s AND NOT %s", spanListFailureSQL, sqltokens.SpanRowTimeoutLikeSQL))
			case StatusTimeout:
				st = append(st, fmt.Sprintf("s.is_complete = 1 AND %s AND %s", spanListFailureSQL, sqltokens.SpanRowTimeoutLikeSQL))
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

func buildSpanRecordsSQL(q SpanRecordsListQuery) (string, []interface{}) {
	where, wp := buildSpanRecordsWhere(q)
	dir := "DESC"
	if strings.ToLower(q.Order) == "asc" {
		dir = "ASC"
	}
	sort := strings.ToLower(q.Sort)
	if sort != "tokens" {
		sort = "time"
	}
	orderBy := fmt.Sprintf("(s.start_time_ms IS NULL) ASC, COALESCE(s.start_time_ms, t.created_at_ms, 0) %s, s.span_id %s", dir, dir)
	if sort == "tokens" {
		orderBy = fmt.Sprintf("(%s) %s, s.span_id %s", sqltokens.SpanRowTokenIntegerExpr, dir, dir)
	}
	sqlStr := spanSelectSQL + " " + where + "\nORDER BY " + orderBy + "\nLIMIT ? OFFSET ?"
	return sqlStr, append(append([]interface{}{}, wp...), q.Limit, q.Offset)
}

func buildSpanRecordsCountSQL(q SpanRecordsListQuery) (string, []interface{}) {
	where, params := buildSpanRecordsWhere(q)
	return `SELECT COUNT(*) AS c FROM ` + CT.Spans + ` s
LEFT JOIN ` + CT.Traces + ` t ON t.trace_id = s.trace_id
LEFT JOIN ` + CT.Threads + ` th ON th.thread_id = t.thread_id AND th.workspace_name = t.workspace_name AND th.project_name = t.project_name ` + where, params
}

func coalesceSpanDurationMs(rawDur, startMs, endMs interface{}) *int64 {
	if f := nullableFloatRec(rawDur); f != nil {
		if fv, ok := f.(float64); ok && fv >= 0 {
			v := int64(fv)
			return &v
		}
	}
	a := toInt64Rec(startMs)
	b := toInt64Rec(endMs)
	if a > 0 && b >= a {
		v := b - a
		return &v
	}
	return nil
}

func mathMaxTrunc(f float64) float64 {
	if f < 0 {
		return 0
	}
	return float64(int64(f))
}

func mapSpanRecordRow(m map[string]interface{}) map[string]interface{} {
	usageStr := stringFromScanRec(m["usage_json"])
	var uj *string
	if usageStr != "" {
		uj = &usageStr
	}
	u := textparser.ParseUsageExtended(uj)
	pt, ct, cr := 0, 0, 0
	if u.PromptTokens != nil {
		pt = int(mathMaxTrunc(*u.PromptTokens))
	}
	if u.CompletionTokens != nil {
		ct = int(mathMaxTrunc(*u.CompletionTokens))
	}
	if u.CacheReadTokens != nil {
		cr = int(mathMaxTrunc(*u.CacheReadTokens))
	}
	ls := strings.ToLower(stringFromScanRec(m["list_status"]))
	if ls != "running" && ls != "success" && ls != "error" && ls != "timeout" {
		ls = "success"
	}
	tk := stringFromScanRec(m["thread_key"])
	if tk == "" {
		tk = stringFromScanRec(m["trace_id"])
	}
	var dur interface{}
	if d := coalesceSpanDurationMs(m["duration_ms"], m["start_time_ms"], m["end_time_ms"]); d != nil {
		dur = *d
	}
	return map[string]interface{}{
		"span_id":           m["span_id"],
		"trace_id":          m["trace_id"],
		"parent_span_id":    nullStrRec(stringFromScanRec(m["parent_span_id"])),
		"name":              stringOrDefaultRec(m["name"], ""),
		"span_type":         stringOrDefaultRec(m["span_type"], "general"),
		"start_time_ms":     m["start_time_ms"],
		"end_time_ms":       m["end_time_ms"],
		"duration_ms":       dur,
		"model":             nullStrRec(stringFromScanRec(m["model"])),
		"provider":          nullStrRec(stringFromScanRec(m["provider"])),
		"is_complete":       toInt64Rec(m["is_complete"]) == 1,
		"input_preview":     stringFromScanRec(m["input_preview"]),
		"output_preview":    stringFromScanRec(m["output_preview"]),
		"thread_key":        tk,
		"workspace_name":    stringOrDefaultRec(m["workspace_name"], "default"),
		"project_name":      stringOrDefaultRec(m["project_name"], "openclaw"),
		"agent_name":        nullStrRec(stringFromScanRec(m["agent_name"])),
		"channel_name":      nullStrRec(stringFromScanRec(m["channel_name"])),
		"total_tokens":      toInt64Rec(m["total_tokens"]),
		"prompt_tokens":     pt,
		"completion_tokens": ct,
		"cache_read_tokens": cr,
		"list_status":       ls,
	}
}

func loadSpanRecords(db QueryDB, q SpanRecordsListQuery) ([]map[string]interface{}, error) {
	sqlStr, params := buildSpanRecordsSQL(q)
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
		out = append(out, mapSpanRecordRow(m))
	}
	return out, rows.Err()
}

func countSpanRecordsModel(db QueryDB, q SpanRecordsListQuery) (int64, error) {
	sqlStr, params := buildSpanRecordsCountSQL(q)
	var n int64
	err := db.QueryRow(sqlStr, params...).Scan(&n)
	return n, err
}
