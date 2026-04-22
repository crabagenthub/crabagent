package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"iseeagentc/internal/sqltables"
)

// ResourceAccessListQuery defines filters for querying agent_resource_access
type ResourceAccessListQuery struct {
	Limit         int
	Offset        int
	Order         string // "asc" | "desc"
	SinceMs       *int64
	UntilMs       *int64
	Search        *string
	SemanticKind  *string
	ResourceURI   *string
	TraceID       *string
	SpanID        *string
	WorkspaceName *string
	RiskFlag      *string
	SortMode      *string // "time_desc" | "risk_first" | "chars_desc"
}

// ResourceAccessEventJson represents a resource access event from agent_resource_access table
type ResourceAccessEventJson struct {
	SpanID          string   `json:"span_id"`
	TraceID         string   `json:"trace_id"`
	ThreadKey       string   `json:"thread_key"`
	WorkspaceName   string   `json:"workspace_name"`
	ProjectName     string   `json:"project_name"`
	SpanName        string   `json:"span_name"`
	StartTimeMs     int64    `json:"start_time_ms"`
	EndTimeMs       *int64   `json:"end_time_ms"`
	DurationMs      *int64   `json:"duration_ms"`
	ResourceURI     string   `json:"resource_uri"`
	AccessMode      string   `json:"access_mode"`
	SemanticKind    string   `json:"semantic_kind"`
	Chars           int64    `json:"chars"`
	Snippet         *string  `json:"snippet"`
	URIRepeatCount  int64    `json:"uri_repeat_count"`
	RiskFlags       []string `json:"risk_flags"`
	PolicyHintFlags []string `json:"policy_hint_flags"`
}

// ResourceAccessStatsJson represents summary statistics for resource access
type ResourceAccessStatsJson struct {
	TotalEvents       int64 `json:"total_events"`
	DistinctTraces    int64 `json:"distinct_traces"`
	RiskSensitivePath int64 `json:"risk_sensitive_path"`
	RiskPIIHint       int64 `json:"risk_pii_hint"`
	RiskLargeRead     int64 `json:"risk_large_read"`
	RiskRedundantRead int64 `json:"risk_redundant_read"`
	RiskAny           int64 `json:"risk_any"`
}

// QueryResourceAccessList queries agent_resource_access table with filters
func QueryResourceAccessList(db *sql.DB, q ResourceAccessListQuery) ([]ResourceAccessEventJson, int64, error) {
	if db == nil {
		return nil, 0, nil
	}

	where, args := buildResourceAccessWhere(q)
	orderSQL := buildResourceAccessOrder(q)

	// Count query
	var total int64
	countSQL := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, sqltables.TableAgentResourceAccess, where)
	if err := db.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// List query
	listSQL := fmt.Sprintf(`SELECT 
		span_id, trace_id, parent_span_id, workspace_name, project_name, thread_key, agent_name, channel_name,
		span_name, start_time_ms, end_time_ms, duration_ms,
		resource_uri, access_mode, semantic_kind, chars, snippet, uri_repeat_count,
		risk_flags, policy_hint_flags
	FROM %s WHERE %s %s LIMIT ? OFFSET ?`, sqltables.TableAgentResourceAccess, where, orderSQL)

	queryArgs := append(args, q.Limit, q.Offset)
	rows, err := db.Query(listSQL, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var events []ResourceAccessEventJson
	for rows.Next() {
		var spanID, traceID, workspaceName, projectName, threadKey, agentName, channelName, spanName string
		var parentSpanID, resourceURI, accessMode, semanticKind, snippet, riskFlags, policyHintFlags sql.NullString
		var startTimeMs, chars, uriRepeatCount int64
		var endTimeMs, durationMs sql.NullInt64

		err := rows.Scan(
			&spanID, &traceID, &parentSpanID, &workspaceName, &projectName, &threadKey, &agentName, &channelName,
			&spanName, &startTimeMs, &endTimeMs, &durationMs,
			&resourceURI, &accessMode, &semanticKind, &chars, &snippet, &uriRepeatCount,
			&riskFlags, &policyHintFlags,
		)
		if err != nil {
			return nil, 0, err
		}

		event := ResourceAccessEventJson{
			SpanID:         spanID,
			TraceID:        traceID,
			ThreadKey:      threadKey,
			WorkspaceName:  workspaceName,
			ProjectName:    projectName,
			SpanName:       spanName,
			StartTimeMs:    startTimeMs,
			ResourceURI:    resourceURI.String,
			AccessMode:     accessMode.String,
			SemanticKind:   semanticKind.String,
			Chars:          chars,
			URIRepeatCount: uriRepeatCount,
		}

		if endTimeMs.Valid {
			event.EndTimeMs = &endTimeMs.Int64
		}
		if durationMs.Valid {
			event.DurationMs = &durationMs.Int64
		}
		if snippet.Valid {
			event.Snippet = &snippet.String
		}

		// Parse risk flags
		if riskFlags.Valid && riskFlags.String != "" {
			event.RiskFlags = strings.Split(riskFlags.String, ",")
			for i, f := range event.RiskFlags {
				event.RiskFlags[i] = strings.TrimSpace(f)
			}
		}

		// Parse policy hint flags
		if policyHintFlags.Valid && policyHintFlags.String != "" {
			event.PolicyHintFlags = strings.Split(policyHintFlags.String, ",")
			for i, f := range event.PolicyHintFlags {
				event.PolicyHintFlags[i] = strings.TrimSpace(f)
			}
		}

		events = append(events, event)
	}

	return events, total, nil
}

// QueryResourceAccessStats returns summary statistics for resource access
func QueryResourceAccessStats(db *sql.DB, sinceMs, untilMs *int64, workspaceName *string) (*ResourceAccessStatsJson, error) {
	if db == nil {
		return &ResourceAccessStatsJson{}, nil
	}

	where := "1=1"
	args := []interface{}{}

	if sinceMs != nil {
		where += " AND start_time_ms >= ?"
		args = append(args, *sinceMs)
	}
	if untilMs != nil {
		where += " AND start_time_ms <= ?"
		args = append(args, *untilMs)
	}
	if workspaceName != nil && *workspaceName != "" {
		where += " AND workspace_name = ?"
		args = append(args, *workspaceName)
	}

	sql := fmt.Sprintf(`
		SELECT 
			COUNT(*) as total_events,
			COUNT(DISTINCT trace_id) as distinct_traces,
			SUM(CASE WHEN risk_flags LIKE '%%sensitive_path%%' THEN 1 ELSE 0 END) as risk_sensitive_path,
			SUM(CASE WHEN risk_flags LIKE '%%pii_hint%%' THEN 1 ELSE 0 END) as risk_pii_hint,
			SUM(CASE WHEN risk_flags LIKE '%%large_read%%' THEN 1 ELSE 0 END) as risk_large_read,
			SUM(CASE WHEN risk_flags LIKE '%%redundant_read%%' THEN 1 ELSE 0 END) as risk_redundant_read,
			SUM(CASE WHEN risk_flags != '' THEN 1 ELSE 0 END) as risk_any
		FROM %s WHERE %s`, sqltables.TableAgentResourceAccess, where)

	var stats ResourceAccessStatsJson
	err := db.QueryRow(sql, args...).Scan(
		&stats.TotalEvents,
		&stats.DistinctTraces,
		&stats.RiskSensitivePath,
		&stats.RiskPIIHint,
		&stats.RiskLargeRead,
		&stats.RiskRedundantRead,
		&stats.RiskAny,
	)
	if err != nil {
		return nil, err
	}

	return &stats, nil
}

func buildResourceAccessWhere(q ResourceAccessListQuery) (string, []interface{}) {
	conditions := []string{"1=1"}
	args := []interface{}{}

	if q.SinceMs != nil {
		conditions = append(conditions, "start_time_ms >= ?")
		args = append(args, *q.SinceMs)
	}
	if q.UntilMs != nil {
		conditions = append(conditions, "start_time_ms <= ?")
		args = append(args, *q.UntilMs)
	}
	if q.WorkspaceName != nil && *q.WorkspaceName != "" {
		conditions = append(conditions, "workspace_name = ?")
		args = append(args, *q.WorkspaceName)
	}
	if q.TraceID != nil && *q.TraceID != "" {
		conditions = append(conditions, "trace_id = ?")
		args = append(args, *q.TraceID)
	}
	if q.SpanID != nil && *q.SpanID != "" {
		conditions = append(conditions, "span_id = ?")
		args = append(args, *q.SpanID)
	}
	if q.SemanticKind != nil && *q.SemanticKind != "" {
		conditions = append(conditions, "semantic_kind = ?")
		args = append(args, *q.SemanticKind)
	}
	if q.ResourceURI != nil && *q.ResourceURI != "" {
		conditions = append(conditions, "resource_uri LIKE ?")
		args = append(args, *q.ResourceURI+"%")
	}
	if q.RiskFlag != nil && *q.RiskFlag != "" {
		conditions = append(conditions, "risk_flags LIKE ?")
		args = append(args, "%"+*q.RiskFlag+"%")
	}
	if q.Search != nil && *q.Search != "" {
		conditions = append(conditions, "(resource_uri LIKE ? OR span_name LIKE ?)")
		searchPattern := "%" + *q.Search + "%"
		args = append(args, searchPattern, searchPattern)
	}

	return strings.Join(conditions, " AND "), args
}

func buildResourceAccessOrder(q ResourceAccessListQuery) string {
	order := "ORDER BY start_time_ms DESC"

	if q.SortMode != nil {
		switch *q.SortMode {
		case "time_desc":
			order = "ORDER BY start_time_ms DESC"
		case "chars_desc":
			order = "ORDER BY chars DESC"
		case "risk_first":
			order = "ORDER BY CASE WHEN risk_flags != '' THEN 0 ELSE 1 END, start_time_ms DESC"
		}
	} else if q.Order == "asc" {
		order = "ORDER BY start_time_ms ASC"
	}

	return order
}

// isSensitivePath checks if a URI matches sensitive path patterns
func isSensitivePath(uri string, cfg ResourceAuditQueryConfig) bool {
	if uri == "" {
		return false
	}
	u := strings.ToLower(uri)

	// Check POSIX prefixes
	for _, prefix := range cfg.DangerousPathRules.PosixPrefixes {
		if strings.Contains(u, strings.ToLower(prefix)) || strings.HasPrefix(u, strings.ToLower(prefix)) {
			return true
		}
	}

	// Check Windows prefixes
	for _, prefix := range cfg.DangerousPathRules.WindowsPrefixes {
		if strings.Contains(u, strings.ToLower(prefix)) || strings.HasPrefix(u, strings.ToLower(prefix)) {
			return true
		}
	}

	// Check specific patterns
	if strings.Contains(u, ".env") || strings.HasSuffix(u, ".pem") || strings.Contains(u, "private.key") {
		return true
	}

	return false
}

// ResyncResourceAccessRiskFlags recalculates and updates risk flags for all rows in agent_resource_access
// This should be called after configuration changes to ensure risk flags are up-to-date
func ResyncResourceAccessRiskFlags(db *sql.DB, cfg ResourceAuditQueryConfig) (int, error) {
	if db == nil {
		return 0, nil
	}

	// Fetch all rows
	q := fmt.Sprintf(`SELECT span_id, resource_uri, chars, uri_repeat_count, policy_hint_flags FROM %s`, sqltables.TableAgentResourceAccess)
	rows, err := db.Query(q)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	now := time.Now().UnixMilli()
	updated := 0
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	for rows.Next() {
		var spanID, resourceURI, policyHintFlags string
		var chars, uriRepeatCount int64

		if err := rows.Scan(&spanID, &resourceURI, &chars, &uriRepeatCount, &policyHintFlags); err != nil {
			return updated, err
		}

		// Calculate risk flags
		var flags []string
		if isSensitivePath(resourceURI, cfg) {
			flags = append(flags, "sensitive_path")
		}
		if chars >= int64(cfg.LargeRead.ThresholdChars) {
			flags = append(flags, "large_read")
		}
		if uriRepeatCount > 3 {
			flags = append(flags, "redundant_read")
		}
		if policyHintFlags != "" {
			for _, hint := range strings.Split(policyHintFlags, ",") {
				hint = strings.TrimSpace(hint)
				if hint != "" {
					flags = append(flags, hint)
				}
			}
		}

		riskFlagsStr := strings.Join(flags, ",")

		// Update the row
		updateQ := fmt.Sprintf(`UPDATE %s SET risk_flags = ?, updated_at_ms = ? WHERE span_id = ?`, sqltables.TableAgentResourceAccess)
		if _, err := tx.Exec(updateQ, riskFlagsStr, now, spanID); err != nil {
			return updated, err
		}
		updated++
	}

	if err := tx.Commit(); err != nil {
		return updated, err
	}
	return updated, nil
}
