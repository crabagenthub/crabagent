package model

import (
	"database/sql"
	"fmt"
	"strings"

	"iseeagentc/internal/sqlutil"
)

type InvestigationTimelineQuery struct {
	Limit      int
	Offset     int
	Order      string
	SinceMs    *int64
	UntilMs    *int64
	TraceID    string
	Workspace  string
	EventType  string
	SourcePage string
	Keyword    string
}

type InvestigationTimelineRow struct {
	Key        string
	EventType  string
	TimeMs     int64
	TraceID    string
	SpanID     sql.NullString
	Subject    string
	Evidence   string
	Actor      string
	Target     string
	Result     string
	WhyFlagged string
	SourcePage string
}

func QueryInvestigationTimeline(db *sql.DB, q InvestigationTimelineQuery) ([]InvestigationTimelineRow, int64, error) {
	unionSQL, params := buildInvestigationTimelineUnionSQL(q)
	totalSQL := sqlutil.RebindIfPostgres(db, fmt.Sprintf("SELECT COUNT(*) FROM (%s) u", unionSQL))
	var total int64
	if err := db.QueryRow(totalSQL, params...).Scan(&total); err != nil {
		return nil, 0, err
	}
	order := "DESC"
	if strings.EqualFold(strings.TrimSpace(q.Order), "asc") {
		order = "ASC"
	}
	pageSQL := sqlutil.RebindIfPostgres(db, fmt.Sprintf(
		"SELECT key,event_type,time_ms,trace_id,span_id,subject,evidence,actor,target,result,why_flagged,source_page FROM (%s) u ORDER BY time_ms %s, key %s LIMIT ? OFFSET ?",
		unionSQL,
		order,
		order,
	))
	pageParams := append(append([]any{}, params...), q.Limit, q.Offset)
	rows, err := db.Query(pageSQL, pageParams...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]InvestigationTimelineRow, 0, q.Limit)
	for rows.Next() {
		var row InvestigationTimelineRow
		if err := rows.Scan(
			&row.Key, &row.EventType, &row.TimeMs, &row.TraceID, &row.SpanID,
			&row.Subject, &row.Evidence, &row.Actor, &row.Target, &row.Result, &row.WhyFlagged, &row.SourcePage,
		); err != nil {
			return nil, 0, err
		}
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func buildInvestigationTimelineUnionSQL(q InvestigationTimelineQuery) (string, []any) {
	eventType := strings.ToLower(strings.TrimSpace(q.EventType))
	source := strings.TrimSpace(q.SourcePage)
	parts := make([]string, 0, 3)
	params := make([]any, 0, 16)
	if shouldIncludeCommandSource(eventType, source) {
		sql, p := buildCommandTimelineSelectSQL(q)
		parts = append(parts, sql)
		params = append(params, p...)
	}
	if shouldIncludeResourceSource(eventType, source) {
		sql, p := buildResourceTimelineSelectSQL(q)
		parts = append(parts, sql)
		params = append(params, p...)
	}
	if shouldIncludePolicySource(eventType, source) {
		sql, p := buildPolicyTimelineSelectSQL(q)
		parts = append(parts, sql)
		params = append(params, p...)
	}
	if len(parts) == 0 {
		return "SELECT '' key,'' event_type,0 time_ms,'' trace_id,NULL span_id,'' subject,'' evidence,'' actor,'' target,'' result,'' why_flagged,'' source_page WHERE 1=0", nil
	}
	return strings.Join(parts, " UNION ALL "), params
}

func buildCommandTimelineSelectSQL(q InvestigationTimelineQuery) (string, []any) {
	w, params := buildTimelineBaseWhere("e", q)
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		w = append(w, "(LOWER(COALESCE(e.command,'')) LIKE LOWER(?) OR LOWER(COALESCE(e.trace_id,'')) LIKE LOWER(?))")
		like := "%" + kw + "%"
		params = append(params, like, like)
	}
	sql := `
SELECT
  ('cmd:' || COALESCE(NULLIF(TRIM(e.span_id), ''), (COALESCE(e.trace_id, '') || ':' || CAST(COALESCE(e.start_time_ms,0) AS TEXT)))) AS key,
  'command' AS event_type,
  COALESCE(e.start_time_ms, 0) AS time_ms,
  COALESCE(e.trace_id, '') AS trace_id,
  NULLIF(TRIM(e.span_id), '') AS span_id,
  COALESCE(NULLIF(TRIM(e.command), ''), 'command') AS subject,
  ('status=' || COALESCE(e.status, 'unknown') || CASE WHEN COALESCE(e.error_info, '') <> '' THEN ' / error=' || substr(e.error_info, 1, 50) ELSE '' END || ' / risk=' || CASE WHEN e.risk_flags LIKE '%token_risk%' THEN 'true' ELSE 'false' END) AS evidence,
  COALESCE(NULLIF(TRIM(e.agent_name), ''), 'unknown') AS actor,
  COALESCE(NULLIF(TRIM(e.command), ''), 'command') AS target,
  e.status AS result,
  CASE
    WHEN COALESCE(e.status, 'success') = 'error' THEN 'command_failed'
    WHEN e.risk_flags LIKE '%token_risk%' THEN 'token_risk'
    ELSE 'heuristic_risk'
  END AS why_flagged,
  '/command-analysis' AS source_page
FROM ` + CT.ExecCommands + ` e
WHERE ` + strings.Join(w, " AND ")
	return sql, params
}

func buildResourceTimelineSelectSQL(q InvestigationTimelineQuery) (string, []any) {
	w, params := buildTimelineBaseWhere("ra", q)
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		w = append(w, "(LOWER(COALESCE(ra.resource_uri,'')) LIKE LOWER(?) OR LOWER(COALESCE(ra.span_name,'')) LIKE LOWER(?) OR LOWER(COALESCE(ra.trace_id,'')) LIKE LOWER(?))")
		like := "%" + kw + "%"
		params = append(params, like, like, like)
	}
	sql := `
SELECT
  ('res:' || COALESCE(NULLIF(TRIM(ra.span_id), ''), (COALESCE(ra.trace_id, '') || ':' || CAST(COALESCE(ra.start_time_ms,0) AS TEXT)))) AS key,
  'resource' AS event_type,
  COALESCE(ra.start_time_ms, 0) AS time_ms,
  COALESCE(ra.trace_id, '') AS trace_id,
  NULLIF(TRIM(ra.span_id), '') AS span_id,
  COALESCE(NULLIF(TRIM(ra.resource_uri), ''), NULLIF(TRIM(ra.span_name), ''), 'resource event') AS subject,
  ('flags=' || COALESCE(NULLIF(TRIM(ra.policy_hint_flags), ''), '-')) AS evidence,
  'unknown' AS actor,
  COALESCE(NULLIF(TRIM(ra.resource_uri), ''), NULLIF(TRIM(ra.span_name), ''), 'resource') AS target,
  CASE WHEN COALESCE(NULLIF(TRIM(ra.policy_hint_flags), ''), '') <> '' THEN 'risk_hit' ELSE 'normal' END AS result,
  CASE
    WHEN COALESCE(NULLIF(TRIM(ra.policy_hint_flags), ''), '') <> '' THEN TRIM(ra.policy_hint_flags)
    WHEN COALESCE(ra.uri_repeat_count, 0) > 3 THEN 'redundant_read'
    ELSE 'normal_resource_access'
  END AS why_flagged,
  '/resource-audit' AS source_page
FROM ` + CT.AgentResourceAccess + ` ra
WHERE ` + strings.Join(w, " AND ")
	return sql, params
}

func buildPolicyTimelineSelectSQL(q InvestigationTimelineQuery) (string, []any) {
	w, params := buildTimelineBaseWhere("s", q)
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		w = append(w, "(LOWER(COALESCE(s.findings_json,'')) LIKE LOWER(?) OR LOWER(COALESCE(s.trace_id,'')) LIKE LOWER(?) OR LOWER(COALESCE(s.project_name,'')) LIKE LOWER(?))")
		like := "%" + kw + "%"
		params = append(params, like, like, like)
	}
	sql := `
SELECT
  ('pol:' || COALESCE(NULLIF(TRIM(s.id), ''), (COALESCE(s.trace_id, '') || ':' || CAST(COALESCE(s.created_at_ms,0) AS TEXT)))) AS key,
  'policy_hit' AS event_type,
  COALESCE(s.created_at_ms, 0) AS time_ms,
  COALESCE(s.trace_id, '') AS trace_id,
  NULLIF(TRIM(s.span_id), '') AS span_id,
  ('policy hits: ' || CAST(COALESCE(s.total_findings, 0) AS TEXT)) AS subject,
  ('intercepted=' || CASE WHEN COALESCE(s.intercepted, 0) <> 0 THEN 'true' ELSE 'false' END) AS evidence,
  COALESCE(NULLIF(TRIM(s.project_name), ''), 'unknown') AS actor,
  ('findings=' || CAST(COALESCE(s.total_findings, 0) AS TEXT)) AS target,
  CASE WHEN COALESCE(s.intercepted, 0) <> 0 THEN 'intercepted' ELSE 'observe_only' END AS result,
  CASE WHEN COALESCE(s.intercepted, 0) <> 0 THEN 'policy_intercepted' ELSE 'policy_observe_only' END AS why_flagged,
  '/data-security-audit' AS source_page
FROM ` + CT.SecurityPolicyHits + ` s
WHERE ` + strings.Join(w, " AND ")
	return sql, params
}

func buildTimelineBaseWhere(alias string, q InvestigationTimelineQuery) ([]string, []any) {
	w := []string{"1=1"}
	params := make([]any, 0, 8)
	if q.SinceMs != nil && *q.SinceMs > 0 {
		tsCol := timelineTimeCol(alias)
		w = append(w, tsCol+" >= ?")
		params = append(params, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		tsCol := timelineTimeCol(alias)
		w = append(w, tsCol+" <= ?")
		params = append(params, *q.UntilMs)
	}
	if tid := strings.TrimSpace(q.TraceID); tid != "" {
		w = append(w, alias+".trace_id = ?")
		params = append(params, tid)
	}
	if ws := strings.TrimSpace(q.Workspace); ws != "" {
		w = append(w, "LOWER(COALESCE("+alias+".workspace_name,'')) = LOWER(?)")
		params = append(params, ws)
	}
	return w, params
}

func timelineTimeCol(alias string) string {
	switch alias {
	case "e":
		return "COALESCE(e.start_time_ms, 0)"
	case "ra":
		return "COALESCE(ra.start_time_ms, 0)"
	default:
		return "COALESCE(s.created_at_ms, 0)"
	}
}

func shouldIncludeCommandSource(eventType, source string) bool {
	return (eventType == "" || eventType == "all" || eventType == "command") &&
		(source == "" || source == "all" || source == "/command-analysis")
}

func shouldIncludeResourceSource(eventType, source string) bool {
	return (eventType == "" || eventType == "all" || eventType == "resource") &&
		(source == "" || source == "all" || source == "/resource-audit")
}

func shouldIncludePolicySource(eventType, source string) bool {
	return (eventType == "" || eventType == "all" || eventType == "policy_hit") &&
		(source == "" || source == "all" || source == "/data-security-audit")
}
