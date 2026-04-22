package model

import (
	"database/sql"
	"strings"
)

type SecurityAuditListQuery struct {
	Limit         int
	Offset        int
	Order         string
	SinceMs       *int64
	UntilMs       *int64
	TraceID       *string
	SpanID        *string
	PolicyID      *string
	HintType      *string
	WorkspaceName *string
}

type SecurityAuditPolicyEventCount struct {
	PolicyID   string `json:"policy_id"`
	EventCount int64  `json:"event_count"`
}

func buildSecurityAuditWhere(q SecurityAuditListQuery) (string, []interface{}) {
	var parts []string
	var params []interface{}
	if q.SinceMs != nil {
		parts = append(parts, "created_at_ms >= ?")
		params = append(params, *q.SinceMs)
	}
	if q.UntilMs != nil {
		parts = append(parts, "created_at_ms <= ?")
		params = append(params, *q.UntilMs)
	}
	if q.TraceID != nil && strings.TrimSpace(*q.TraceID) != "" {
		parts = append(parts, "trace_id = ?")
		params = append(params, strings.TrimSpace(*q.TraceID))
	}
	if q.SpanID != nil && strings.TrimSpace(*q.SpanID) != "" {
		parts = append(parts, "(span_id IS NOT NULL AND span_id = ?)")
		params = append(params, strings.TrimSpace(*q.SpanID))
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		parts = append(parts, "lower(workspace_name) = lower(?)")
		params = append(params, strings.TrimSpace(*q.WorkspaceName))
	}
	if q.PolicyID != nil && strings.TrimSpace(*q.PolicyID) != "" {
		parts = append(parts, `EXISTS (SELECT 1 FROM json_each(findings_json) WHERE json_extract(json_each.value, '$.policy_id') = ?)`)
		params = append(params, strings.TrimSpace(*q.PolicyID))
	}
	if q.HintType != nil && strings.TrimSpace(*q.HintType) != "" {
		parts = append(parts, `EXISTS (SELECT 1 FROM json_each(findings_json) WHERE lower(COALESCE(json_extract(json_each.value, '$.hint_type'), '')) = lower(?))`)
		params = append(params, strings.TrimSpace(*q.HintType))
	}
	if len(parts) == 0 {
		return "", params
	}
	return "WHERE " + strings.Join(parts, " AND "), params
}

func loadSecurityAuditEvents(db QueryDB, q SecurityAuditListQuery) ([]map[string]interface{}, error) {
	where, params := buildSecurityAuditWhere(q)
	dir := "DESC"
	if strings.ToLower(q.Order) == "asc" {
		dir = "ASC"
	}
	sqlStr := `SELECT id, created_at_ms, trace_id, span_id, workspace_name, project_name, findings_json,
 COALESCE(total_findings, 0) AS total_findings, hit_count, intercepted, observe_only
 FROM ` + CT.SecurityAuditLogs + ` ` + where + ` ORDER BY created_at_ms ` + dir + ` LIMIT ? OFFSET ?`
	params = append(params, q.Limit, q.Offset)
	rows, err := db.Query(sqlStr, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var id, traceID, ws, proj, findings string
		var spanID sql.NullString
		var created, tf, hits, inter, obs int64
		if err := rows.Scan(&id, &created, &traceID, &spanID, &ws, &proj, &findings, &tf, &hits, &inter, &obs); err != nil {
			return nil, err
		}
		row := map[string]interface{}{
			"id": id, "created_at_ms": created, "trace_id": traceID, "workspace_name": ws, "project_name": proj,
			"findings_json": findings, "total_findings": tf, "hit_count": hits, "intercepted": inter, "observe_only": obs,
		}
		if spanID.Valid {
			row["span_id"] = spanID.String
		} else {
			row["span_id"] = nil
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func countSecurityAuditEventsModel(db QueryDB, q SecurityAuditListQuery) (int64, error) {
	where, params := buildSecurityAuditWhere(q)
	var n int64
	err := db.QueryRow("SELECT COUNT(*) AS n FROM "+CT.SecurityAuditLogs+" "+where, params...).Scan(&n)
	return n, err
}

func loadSecurityAuditPolicyEventCounts(db QueryDB, workspaceName *string) ([]SecurityAuditPolicyEventCount, error) {
	wsWhere := ""
	var args []interface{}
	if workspaceName != nil && strings.TrimSpace(*workspaceName) != "" {
		wsWhere = "AND lower(s.workspace_name) = lower(?)"
		args = append(args, strings.TrimSpace(*workspaceName))
	}
	sqlStr := `SELECT json_extract(j.value, '$.policy_id') AS policy_id, COUNT(DISTINCT s.id) AS event_count
 FROM ` + CT.SecurityAuditLogs + ` AS s, json_each(s.findings_json) AS j
 WHERE COALESCE(TRIM(json_extract(j.value, '$.policy_id')), '') <> '' ` + wsWhere + `
 GROUP BY json_extract(j.value, '$.policy_id')`
	rows, err := db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecurityAuditPolicyEventCount
	for rows.Next() {
		var r SecurityAuditPolicyEventCount
		if err := rows.Scan(&r.PolicyID, &r.EventCount); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
