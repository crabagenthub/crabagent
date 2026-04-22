package model

import (
	"encoding/json"
	"fmt"
	"strings"

	"iseeagentc/model/sqltokens"
)

type ThreadRecordsListQuery struct {
	Limit         int
	Offset        int
	Order         string
	Sort          string
	Search        *string
	SinceMs       *int64
	UntilMs       *int64
	Channel       *string
	Agent         *string
	WorkspaceName *string
}

const threadPreviewMax = 16384

var threadLastMsgCreatedSQL = `(SELECT t.created_at_ms FROM ` + CT.Traces + ` t WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name ORDER BY t.created_at_ms DESC, t.trace_id DESC LIMIT 1)`
var threadLastTraceStatusSQL = `(SELECT CASE
  WHEN lt.is_complete = 0 THEN 'running'
  WHEN COALESCE(lt.success, 0) = 1 THEN 'success'
  WHEN COALESCE(lt.success, 0) = 0 AND ` + sqltokens.TraceRowTimeoutLikeSQLForAlias("lt") + ` THEN 'timeout'
  WHEN COALESCE(lt.success, 0) = 0 THEN 'error'
  ELSE 'running' END
FROM ` + CT.Traces + ` lt
WHERE lt.thread_id = th.thread_id AND lt.workspace_name = th.workspace_name AND lt.project_name = th.project_name
ORDER BY lt.created_at_ms DESC, lt.trace_id DESC LIMIT 1)`

var threadSelectSQL = `
SELECT th.thread_id, th.workspace_name, th.project_name, th.thread_type, th.first_seen_ms, th.last_seen_ms,
 th.metadata_json AS metadata, th.agent_name, th.channel_name,
 (SELECT COUNT(*) FROM ` + CT.Traces + ` t WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name) AS trace_count,
 (SELECT SUBSTR(TRIM(COALESCE(
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.list_input_preview'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.prompt'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.text'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.body'), '')), ''),
   TRIM(COALESCE(t.input_json, t.name, ''))
 )), 1, ` + fmt.Sprint(threadPreviewMax) + `) FROM ` + CT.Traces + ` t
 WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name
 ORDER BY t.created_at_ms ASC, t.trace_id ASC LIMIT 1) AS first_message_preview,
 (SELECT SUBSTR(TRIM(COALESCE(
   NULLIF(TRIM(COALESCE(json_extract(t.output_json, '$.assistantTexts[0]'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.metadata_json, '$.output_preview'), '')), ''),
   NULLIF(TRIM(COALESCE(t.output_json, '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.list_input_preview'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.prompt'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.text'), '')), ''),
   NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.body'), '')), ''),
   TRIM(COALESCE(t.input_json, t.name, ''))
 )), 1, ` + fmt.Sprint(threadPreviewMax) + `) FROM ` + CT.Traces + ` t
 WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name
 ORDER BY t.created_at_ms DESC, t.trace_id DESC LIMIT 1) AS last_message_preview,
 ` + threadLastMsgCreatedSQL + ` AS last_message_created_at_ms,
 ` + sqltokens.ThreadLLMSpanUsageTotalSumSQL + ` AS total_tokens,
 (SELECT SUM(COALESCE(t.total_cost, 0)) FROM ` + CT.Traces + ` t WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name) AS total_cost,
 COALESCE(
   (SELECT COALESCE(NULLIF(MAX(COALESCE(t.ended_at_ms, t.updated_at_ms, t.created_at_ms)) - MIN(t.created_at_ms), 0),
      NULLIF((SELECT SUM(COALESCE(t2.duration_ms, 0)) FROM ` + CT.Traces + ` t2 WHERE t2.thread_id = th.thread_id AND t2.workspace_name = th.workspace_name AND t2.project_name = th.project_name), 0))
    FROM ` + CT.Traces + ` t WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name),
   NULLIF(th.last_seen_ms - th.first_seen_ms, 0)
 ) AS duration_ms,
 ` + threadLastTraceStatusSQL + ` AS last_trace_status
FROM ` + CT.Threads + ` th`

func buildThreadRecordsWhere(q ThreadRecordsListQuery) (string, []interface{}) {
	var parts []string
	var params []interface{}
	if q.SinceMs != nil && *q.SinceMs > 0 {
		parts = append(parts, "th.last_seen_ms >= ?")
		params = append(params, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		parts = append(parts, "th.last_seen_ms <= ?")
		params = append(params, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		parts = append(parts, "lower(th.workspace_name) = lower(?)")
		params = append(params, strings.TrimSpace(*q.WorkspaceName))
	}
	if ch := ClampFacetFilter(ptrToStringRec(q.Channel)); ch != nil {
		parts = append(parts, "th.channel_name = ?")
		params = append(params, *ch)
	}
	if ag := ClampFacetFilter(ptrToStringRec(q.Agent)); ag != nil {
		parts = append(parts, "th.agent_name = ?")
		params = append(params, *ag)
	}
	if q.Search != nil {
		if s := clampSearch(*q.Search); s != nil {
			parts = append(parts, `(instr(lower(th.thread_id), lower(?)) > 0 OR instr(lower(COALESCE(th.metadata_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(th.agent_name, '')), lower(?)) > 0 OR instr(lower(COALESCE(th.channel_name, '')), lower(?)) > 0 OR instr(lower(th.workspace_name), lower(?)) > 0 OR instr(lower(th.project_name), lower(?)) > 0 OR EXISTS (SELECT 1 FROM ` + CT.Traces + ` t WHERE t.thread_id = th.thread_id AND t.workspace_name = th.workspace_name AND t.project_name = th.project_name AND (instr(lower(COALESCE(t.input_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.output_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(t.name, '')), lower(?)) > 0)))`)
			for i := 0; i < 9; i++ {
				params = append(params, *s)
			}
		}
	}
	if len(parts) == 0 {
		return "", params
	}
	return "WHERE " + strings.Join(parts, " AND "), params
}

func buildThreadRecordsSQL(q ThreadRecordsListQuery) (string, []interface{}) {
	where, wp := buildThreadRecordsWhere(q)
	dir := "DESC"
	if strings.ToLower(q.Order) == "asc" {
		dir = "ASC"
	}
	sort := strings.ToLower(q.Sort)
	if sort != "tokens" {
		sort = "time"
	}
	orderBy := fmt.Sprintf("COALESCE(%s, th.last_seen_ms, th.first_seen_ms) %s, th.thread_id %s", threadLastMsgCreatedSQL, dir, dir)
	if sort == "tokens" {
		orderBy = fmt.Sprintf("COALESCE(%s, 0) %s, th.thread_id %s", sqltokens.ThreadLLMSpanUsageTotalSumSQL, dir, dir)
	}
	sqlStr := threadSelectSQL + " " + where + "\nORDER BY " + orderBy + "\nLIMIT ? OFFSET ?"
	return sqlStr, append(append([]interface{}{}, wp...), q.Limit, q.Offset)
}

func buildThreadRecordsCountSQL(q ThreadRecordsListQuery) (string, []interface{}) {
	where, params := buildThreadRecordsWhere(q)
	return "SELECT COUNT(*) AS c FROM " + CT.Threads + " th " + where, params
}

func stringOrDefaultRec(v interface{}, def string) string {
	s := stringFromScanRec(v)
	if s == "" {
		return def
	}
	return s
}

func nullStrRec(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func mapThreadRecordRow(m map[string]interface{}) map[string]interface{} {
	meta := map[string]interface{}{}
	switch t := m["metadata"].(type) {
	case string:
		_ = json.Unmarshal([]byte(t), &meta)
	case []byte:
		_ = json.Unmarshal(t, &meta)
	}
	lts := stringFromScanRec(m["last_trace_status"])
	var status interface{}
	if lts == "running" || lts == "success" || lts == "error" || lts == "timeout" {
		status = lts
	}
	tt := stringFromScanRec(m["thread_type"])
	if tt != "main" && tt != "subagent" {
		tt = "main"
	}
	var lm *int64
	if v := toInt64Rec(m["last_message_created_at_ms"]); v > 0 {
		lm = &v
	}
	return map[string]interface{}{
		"thread_id":                  m["thread_id"],
		"workspace_name":             stringOrDefaultRec(m["workspace_name"], "default"),
		"project_name":               stringOrDefaultRec(m["project_name"], "openclaw"),
		"thread_type":                tt,
		"first_seen_ms":              m["first_seen_ms"],
		"last_seen_ms":               m["last_seen_ms"],
		"metadata":                   meta,
		"agent_name":                 nullStrRec(stringFromScanRec(m["agent_name"])),
		"channel_name":               nullStrRec(stringFromScanRec(m["channel_name"])),
		"trace_count":                toInt64Rec(m["trace_count"]),
		"first_message_preview":      stringFromScanRec(m["first_message_preview"]),
		"last_message_preview":       stringFromScanRec(m["last_message_preview"]),
		"last_message_created_at_ms": lm,
		"total_tokens":               toInt64Rec(m["total_tokens"]),
		"total_cost":                 nullableFloatRec(m["total_cost"]),
		"duration_ms":                nullableFloatRec(m["duration_ms"]),
		"status":                     status,
	}
}

func loadThreadRecords(db QueryDB, q ThreadRecordsListQuery) ([]map[string]interface{}, error) {
	sqlStr, params := buildThreadRecordsSQL(q)
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
		out = append(out, mapThreadRecordRow(m))
	}
	return out, rows.Err()
}

func countThreadRecordsModel(db QueryDB, q ThreadRecordsListQuery) (int64, error) {
	sqlStr, params := buildThreadRecordsCountSQL(q)
	var n int64
	err := db.QueryRow(sqlStr, params...).Scan(&n)
	return n, err
}
