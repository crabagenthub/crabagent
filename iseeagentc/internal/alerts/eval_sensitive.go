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
		st = "agent_security_policy_hits"
	}
	if shouldExtendImmediateLookback(r, adv) {
		minSince := until - 3*60*1000
		if minSince < since {
			since = minSince
		}
	}
	wn := strings.TrimSpace(ws)

	switch st {
	case "agent_security_policy_hits":
		return evalSecurityAuditCount(db, wn, since, until, r, adv)
	case "agent_resource_access":
		return evalResourceAccessCount(db, wn, since, until, r, adv)
	case "agent_exec_commands":
		// sensitive template sometimes maps token_risk here — reuse exec flag count
		cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
		if cf == "token_risk" {
			return execFlagCountEval(db, wn, since, until, "e.token_risk = 1", r, "token_risk count", adv)
		}
		return execFlagCountEval(db, wn, since, until, "e.token_risk = 1", r, "token_risk count", adv)
	default:
		// default: count security audit rows
		return evalSecurityAuditCount(db, wn, since, until, r, adv)
	}
}

func shouldExtendImmediateLookback(r *model.AlertRuleRow, adv AdvancedFilter) bool {
	if r == nil {
		return false
	}
	fm := strings.ToLower(strings.TrimSpace(adv.FrequencyMode))
	if fm != "immediate" {
		return false
	}
	st := strings.ToLower(strings.TrimSpace(adv.SourceTable))
	return st == "agent_resource_access" || st == "agent_security_policy_hits"
}

func securityAuditCountInRange(db *sql.DB, wn string, since, until int64, adv AdvancedFilter) (int, error) {
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
	q := `SELECT COUNT(*) FROM ` + model.CT.SecurityPolicyHits + ` WHERE created_at_ms >= ? AND created_at_ms <= ?`
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
	return c, err
}

func evalSecurityAuditCount(db *sql.DB, wn string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
	subM := adv.SubWindowMinutes
	parentM := r.WindowMinutes
	mt := strings.ToLower(strings.TrimSpace(adv.MatchType))
	thr := r.Threshold
	if adv.CountThreshold > 0 && (mt == "count_gte" || mt == "contains") {
		thr = adv.CountThreshold
	}
	thr = normalizeImmediateCountThreshold(r, adv, thr)
	subMode := strings.ToLower(strings.TrimSpace(adv.SubWindowMode))
	if subMode == "" {
		subMode = "any_max"
	}
	if subM < 1 || subM >= parentM {
		c, err := securityAuditCountInRange(db, wn, since, until, adv)
		if err != nil {
			return EvalResult{}, err
		}
		v := float64(c)
		preview := fmt.Sprintf("security_audit count=%d field=%s", c, cf)
		return EvalResult{Value: v, ConditionPreview: preview, Breached: compare(r.Operator, v, thr), Details: preview}, nil
	}
	var maxC int
	var parts []string
	step := int64(subM) * 60 * 1000
	for t := since; t < until; t += step {
		t2 := t + step
		if t2 > until {
			t2 = until
		}
		if t2 <= t {
			break
		}
		c, err := securityAuditCountInRange(db, wn, t, t2, adv)
		if err != nil {
			return EvalResult{}, err
		}
		parts = append(parts, fmt.Sprintf("%d", c))
		if c > maxC {
			maxC = c
		}
	}
	v := float64(maxC)
	preview := fmt.Sprintf("security_audit sub_%s sub=[%s] max=%d field=%s (parent=%dmin sub=%dmin)", subMode, strings.Join(parts, ","), maxC, cf, parentM, subM)
	return EvalResult{Value: v, ConditionPreview: preview, Breached: compare(r.Operator, v, thr), Details: preview}, nil
}

func resourceAccessCountInRange(db *sql.DB, wn string, since, until int64, adv AdvancedFilter) (int, error) {
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
	matchExpr := ` AND (LOWER(COALESCE(r.risk_flags,'')) LIKE ? OR LOWER(COALESCE(r.policy_hint_flags,'')) LIKE ?)`
	if strings.Contains(cf, "sensitive") {
		like = "%sensitive%"
	} else if strings.Contains(cf, "redundant") {
		like = "%redundant_read%"
	} else if strings.Contains(cf, "large") {
		like = "%large_read%"
	} else if strings.Contains(cf, "secret") || strings.Contains(cf, "credential") {
		like = "%secret%" // token match weak; also try policy_hint
	} else if cf == "risk_flags" {
		// risk_flags 模板不应等价于“任意资源访问”；仅匹配明确风险标记或敏感路径前缀。
		matchExpr = ` AND (
LOWER(COALESCE(r.risk_flags,'')) LIKE ? OR LOWER(COALESCE(r.policy_hint_flags,'')) LIKE ?
OR LOWER(COALESCE(r.resource_uri,'')) LIKE '/etc/%'
OR LOWER(COALESCE(r.resource_uri,'')) LIKE '/root/%'
OR LOWER(COALESCE(r.resource_uri,'')) LIKE '/var/lib/%'
OR LOWER(COALESCE(r.resource_uri,'')) LIKE '%/.ssh/%'
OR LOWER(COALESCE(r.resource_uri,'')) LIKE '%.env%'
OR LOWER(COALESCE(r.resource_uri,'')) LIKE '%private.key%'
)`
		like = "%sensitive%"
	}
	q += matchExpr
	args = append(args, like, like)
	var c int
	err := db.QueryRow(sqlutil.RebindIfPostgres(db, q), args...).Scan(&c)
	return c, err
}

func evalResourceAccessCount(db *sql.DB, wn string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
	subM := adv.SubWindowMinutes
	parentM := r.WindowMinutes
	thr := r.Threshold
	if adv.CountThreshold > 0 {
		thr = adv.CountThreshold
	}
	thr = normalizeImmediateCountThreshold(r, adv, thr)
	subMode := strings.ToLower(strings.TrimSpace(adv.SubWindowMode))
	if subMode == "" {
		subMode = "any_max"
	}
	if subM < 1 || subM >= parentM {
		c, err := resourceAccessCountInRange(db, wn, since, until, adv)
		if err != nil {
			return EvalResult{}, err
		}
		v := float64(c)
		preview := fmt.Sprintf("resource_access count=%d (hint field=%s)", c, cf)
		return EvalResult{Value: v, ConditionPreview: preview, Breached: compare(r.Operator, v, thr), Details: preview}, nil
	}
	var maxC int
	var parts []string
	step := int64(subM) * 60 * 1000
	for t := since; t < until; t += step {
		t2 := t + step
		if t2 > until {
			t2 = until
		}
		if t2 <= t {
			break
		}
		c, err := resourceAccessCountInRange(db, wn, t, t2, adv)
		if err != nil {
			return EvalResult{}, err
		}
		parts = append(parts, fmt.Sprintf("%d", c))
		if c > maxC {
			maxC = c
		}
	}
	v := float64(maxC)
	preview := fmt.Sprintf("resource_access sub_%s sub=[%s] max=%d (hint field=%s parent=%dmin sub=%dmin)", subMode, strings.Join(parts, ","), maxC, cf, parentM, subM)
	return EvalResult{Value: v, ConditionPreview: preview, Breached: compare(r.Operator, v, thr), Details: preview}, nil
}

func normalizeImmediateCountThreshold(r *model.AlertRuleRow, adv AdvancedFilter, thr float64) float64 {
	if r == nil {
		return thr
	}
	op := strings.ToLower(strings.TrimSpace(r.Operator))
	fm := strings.ToLower(strings.TrimSpace(adv.FrequencyMode))
	st := strings.ToLower(strings.TrimSpace(adv.SourceTable))
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))
	isSecurityImmediate := st == "agent_security_policy_hits" && (cf == "intercepted" || cf == "observe_only")
	isResourceImmediate := st == "agent_resource_access" && cf == "risk_flags"
	// immediate 计数型规则在阈值=1、operator=gt 时，统一按“命中一次即触发”（>0）处理。
	if fm == "immediate" && op == "gt" && thr <= 1 && (isSecurityImmediate || isResourceImmediate) {
		return 0
	}
	return thr
}
