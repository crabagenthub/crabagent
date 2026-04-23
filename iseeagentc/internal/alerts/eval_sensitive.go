package alerts

import (
	"database/sql"
	"fmt"
	"strings"

	"iseeagentc/internal/sqlutil"
	"iseeagentc/model"
)

func evalSensitive(db *sql.DB, ws string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	st := strings.ToLower(strings.TrimSpace(adv.SourceTable))
	if st == "" {
		st = "agent_security_audit_logs"
	}
	wn := strings.TrimSpace(ws)

	switch st {
	case "agent_security_audit_logs":
		return evalSecurityAuditCount(db, wn, since, until, r, adv)
	case "agent_resource_access":
		return evalResourceAccessCount(db, wn, since, until, r, adv)
	case "agent_exec_commands":
		// sensitive template sometimes maps token_risk here — reuse exec flag count
		cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
		if cf == "token_risk" {
			return execFlagCountEval(db, wn, since, until, "e.token_risk = 1", r, "token_risk count")
		}
		return execFlagCountEval(db, wn, since, until, "e.token_risk = 1", r, "token_risk count")
	default:
		// default: count security audit rows
		return evalSecurityAuditCount(db, wn, since, until, r, adv)
	}
}

func evalSecurityAuditCount(db *sql.DB, wn string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
	q := `SELECT COUNT(*) FROM ` + model.CT.SecurityAuditLogs + ` WHERE created_at_ms >= ? AND created_at_ms <= ?`
	var args []any
	args = append(args, since, until)
	if wn != "" {
		q += ` AND LOWER(TRIM(workspace_name)) = LOWER(TRIM(?))`
		args = append(args, wn)
	}
	switch cf {
	case "intercepted":
		q += ` AND intercepted = 1`
	case "observe_only":
		q += ` AND observe_only = 1`
	}
	var c int
	err := db.QueryRow(sqlutil.RebindIfPostgres(db, q), args...).Scan(&c)
	if err != nil {
		return EvalResult{}, err
	}
	v := float64(c)
	mt := strings.ToLower(strings.TrimSpace(adv.MatchType))
	thr := r.Threshold
	if adv.CountThreshold > 0 && (mt == "count_gte" || mt == "contains") {
		thr = adv.CountThreshold
	}
	preview := fmt.Sprintf("security_audit count=%d field=%s", c, cf)
	return EvalResult{
		Value:            v,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, v, thr),
		Details:          preview,
	}, nil
}

func evalResourceAccessCount(db *sql.DB, wn string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
	q := `SELECT COUNT(*) FROM ` + model.CT.AgentResourceAccess + ` r INNER JOIN ` + model.CT.Traces + ` t ON t.trace_id = r.trace_id
WHERE COALESCE(r.start_time_ms, t.created_at_ms, 0) >= ? AND COALESCE(r.start_time_ms, t.created_at_ms, 0) <= ?`
	var args []any
	args = append(args, since, until)
	if wn != "" {
		q += ` AND LOWER(TRIM(COALESCE(r.workspace_name, t.workspace_name, ''))) = LOWER(TRIM(?))`
		args = append(args, wn)
	}
	like := "%"
	if strings.Contains(cf, "sensitive") {
		like = "%sensitive%"
	} else if strings.Contains(cf, "redundant") {
		like = "%redundant_read%"
	} else if strings.Contains(cf, "large") {
		like = "%large_read%"
	} else if strings.Contains(cf, "secret") || strings.Contains(cf, "credential") {
		like = "%secret%" // token match weak; also try policy_hint
	}
	q += ` AND (LOWER(COALESCE(r.risk_flags,'')) LIKE ? OR LOWER(COALESCE(r.policy_hint_flags,'')) LIKE ?)`
	args = append(args, like, like)

	var c int
	err := db.QueryRow(sqlutil.RebindIfPostgres(db, q), args...).Scan(&c)
	if err != nil {
		return EvalResult{}, err
	}
	v := float64(c)
	thr := r.Threshold
	if adv.CountThreshold > 0 {
		thr = adv.CountThreshold
	}
	preview := fmt.Sprintf("resource_access count=%d (hint field=%s)", c, cf)
	return EvalResult{
		Value:            v,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, v, thr),
		Details:          preview,
	}, nil
}
