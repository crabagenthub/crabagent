package alerts

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"iseeagentc/internal/shellexec"
	"iseeagentc/internal/sqlutil"
	"iseeagentc/model"
)

// EvaluateRule computes metric value and breach for a loaded rule row.
func EvaluateRule(db *sql.DB, r *model.AlertRuleRow) (EvalResult, error) {
	if r == nil {
		return EvalResult{}, fmt.Errorf("nil rule")
	}
	ws := strings.TrimSpace(r.WorkspaceName)
	until := time.Now().UnixMilli()
	since := until - int64(r.WindowMinutes)*60*1000
	if since < 0 {
		since = 0
	}
	adv := parseAdvanced(r)
	mk := strings.TrimSpace(r.MetricKey)

	switch mk {
	case "p95_latency_ms":
		return evalP95(db, ws, since, until, r, adv)
	case "estimated_daily_cost_usd":
		return evalDailyCost(db, ws, since, until, r)
	case "sensitive_data_hits":
		return evalSensitive(db, ws, since, until, r, adv)
	case "error_rate_pct":
		return evalErrorFamily(db, ws, since, until, r, adv)
	default:
		return evalErrorFamily(db, ws, since, until, r, adv)
	}
}

func evalErrorFamily(db *sql.DB, ws string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	st := strings.ToLower(strings.TrimSpace(adv.SourceTable))
	cf := strings.ToLower(strings.TrimSpace(adv.ConditionField))

	if st == "agent_exec_commands" || st == "" {
		switch cf {
		case "permission_denied":
			return execFlagCountEval(db, ws, since, until, "e.permission_denied = 1", r, "permission_denied count", adv)
		case "command_not_found":
			return execFlagCountEval(db, ws, since, until, "e.command_not_found = 1", r, "command_not_found count", adv)
		case "token_risk":
			return execFlagCountEval(db, ws, since, until, "e.token_risk = 1", r, "token_risk count", adv)
		case "loop_alerts":
			return evalLoopFromShellSummary(db, ws, since, until, r)
		}
	}
	// default: command failure rate from shell summary
	return evalShellErrorRate(db, ws, since, until, r)
}

func baseExecQuery(db *sql.DB, ws string, since, until int64) model.ShellExecBaseQuery {
	s, u := since, until
	q := model.ShellExecBaseQuery{SinceMs: &s, UntilMs: &u}
	if strings.TrimSpace(ws) != "" {
		q.WorkspaceName = ws
	}
	return q
}

func evalShellErrorRate(db *sql.DB, ws string, since, until int64, r *model.AlertRuleRow) (EvalResult, error) {
	q := baseExecQuery(db, ws, since, until)
	rows, _, err := model.FetchShellSpanRowsForSummary(db, q)
	if err != nil {
		return EvalResult{}, err
	}
	cfg := shellexec.LoadResourceAuditConfig()
	opts := shellexec.ComputeSummaryOptions{Config: cfg, LoopAlertMinRepeat: cfg.ShellExec.LoopAlerts.MinRepeatCount, LoopAlertMaxItems: cfg.ShellExec.LoopAlerts.MaxItems, TokenRiskStdoutChars: cfg.ShellExec.TokenRisks.StdoutCharsThreshold, TokenRiskMaxItems: cfg.ShellExec.TokenRisks.MaxItems}
	summary := shellexec.ComputeShellSummaryFromRows(rows, opts)
	tot := summary.Totals
	denom := tot.Success + tot.Failed + tot.Unknown
	var pct float64
	if denom > 0 {
		pct = 100.0 * float64(tot.Failed) / float64(denom)
	}
	preview := fmt.Sprintf("error_rate_pct=%.2f (failed=%d / denom=%d)", pct, tot.Failed, denom)
	return EvalResult{
		Value:            pct,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, pct, r.Threshold),
		Details:          preview,
	}, nil
}

func evalLoopFromShellSummary(db *sql.DB, ws string, since, until int64, r *model.AlertRuleRow) (EvalResult, error) {
	q := baseExecQuery(db, ws, since, until)
	rows, _, err := model.FetchShellSpanRowsForSummary(db, q)
	if err != nil {
		return EvalResult{}, err
	}
	cfg := shellexec.LoadResourceAuditConfig()
	opts := shellexec.ComputeSummaryOptions{Config: cfg, LoopAlertMinRepeat: cfg.ShellExec.LoopAlerts.MinRepeatCount, LoopAlertMaxItems: cfg.ShellExec.LoopAlerts.MaxItems}
	summary := shellexec.ComputeShellSummaryFromRows(rows, opts)
	n := float64(len(summary.LoopAlerts))
	var acc float64
	for _, la := range summary.LoopAlerts {
		if la.RepeatCount > 0 {
			acc += float64(la.RepeatCount)
		}
	}
	if n == 0 && acc == 0 {
		n = 0
	}
	// use max(n, acc) for template threshold on "repeats"
	val := n
	if acc > val {
		val = acc
	}
	preview := fmt.Sprintf("loop_alerts items=%d repeat_sum=%.0f", len(summary.LoopAlerts), acc)
	return EvalResult{
		Value:            val,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, val, r.Threshold),
		Details:          preview,
	}, nil
}

// execFlagCountForRange runs shell-exec count SQL for [since, until].
func execFlagCountForRange(db *sql.DB, ws string, since, until int64, extraSQL string) (int, error) {
	q := baseExecQuery(db, ws, since, until)
	sq, params := model.BuildShellExecCountSQLFromExec(db, q)
	sq = sq + " AND (" + extraSQL + ")"
	var c int
	err := db.QueryRow(sqlutil.RebindIfPostgres(db, sq), params...).Scan(&c)
	return c, err
}

func execFlagCountEval(db *sql.DB, ws string, since, until int64, extraSQL string, r *model.AlertRuleRow, label string, adv AdvancedFilter) (EvalResult, error) {
	subM := adv.SubWindowMinutes
	parentM := r.WindowMinutes
	if subM < 1 || parentM < 1 || subM >= parentM {
		return execFlagCountSingle(db, ws, since, until, extraSQL, r, label)
	}
	mode := strings.ToLower(strings.TrimSpace(adv.SubWindowMode))
	if mode == "" {
		mode = "any_max"
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
		c, err := execFlagCountForRange(db, ws, t, t2, extraSQL)
		if err != nil {
			return EvalResult{}, err
		}
		parts = append(parts, fmt.Sprintf("%d", c))
		if c > maxC {
			maxC = c
		}
	}
	thr := r.Threshold
	v := float64(maxC)
	preview := fmt.Sprintf("%s sub_%s sub=[%s] max=%d (parent=%dmin sub=%dmin)", label, mode, strings.Join(parts, ","), maxC, parentM, subM)
	if mode == "any_max" {
		return EvalResult{
			Value:            v,
			ConditionPreview: preview,
			Breached:         compare(r.Operator, v, thr),
			Details:          preview,
		}, nil
	}
	// only any_max in v1; treat unknown mode as any_max
	return EvalResult{
		Value:            v,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, v, thr),
		Details:          preview,
	}, nil
}

func execFlagCountSingle(db *sql.DB, ws string, since, until int64, extraSQL string, r *model.AlertRuleRow, label string) (EvalResult, error) {
	c, err := execFlagCountForRange(db, ws, since, until, extraSQL)
	if err != nil {
		return EvalResult{}, err
	}
	v := float64(c)
	preview := fmt.Sprintf("%s=%d in window", label, c)
	return EvalResult{
		Value:            v,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, v, r.Threshold),
		Details:          preview,
	}, nil
}

func evalP95(db *sql.DB, ws string, since, until int64, r *model.AlertRuleRow, adv AdvancedFilter) (EvalResult, error) {
	_ = adv
	span := model.CT.Spans
	tr := model.CT.Traces
	var args []any
	wn := strings.TrimSpace(ws)
	q := `SELECT COALESCE(s.duration_ms, 0) AS d FROM ` + span + ` s INNER JOIN ` + tr + ` t ON t.trace_id = s.trace_id
WHERE COALESCE(s.duration_ms, 0) > 0
AND COALESCE(s.start_time_ms, t.created_at_ms, 0) >= ? AND COALESCE(s.start_time_ms, t.created_at_ms, 0) <= ?`
	args = append(args, since, until)
	if wn != "" {
		q += ` AND LOWER(TRIM(COALESCE(t.workspace_name, ''))) = LOWER(TRIM(?))`
		args = append(args, wn)
	}
	rows, err := db.Query(sqlutil.RebindIfPostgres(db, q), args...)
	if err != nil {
		return EvalResult{}, err
	}
	defer rows.Close()
	var ds []float64
	for rows.Next() {
		var d float64
		if err := rows.Scan(&d); err != nil {
			return EvalResult{}, err
		}
		if d > 0 {
			ds = append(ds, d)
		}
	}
	if err := rows.Err(); err != nil {
		return EvalResult{}, err
	}
	if len(ds) == 0 {
		preview := "p95_latency_ms: no span durations in window"
		return EvalResult{Value: 0, ConditionPreview: preview, Breached: compare(r.Operator, 0, r.Threshold), Details: preview}, nil
	}
	sort.Float64s(ds)
	idx := int(math.Ceil(0.95*float64(len(ds)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(ds) {
		idx = len(ds) - 1
	}
	p95 := ds[idx]
	preview := fmt.Sprintf("p95_latency_ms=%.0f (n=%d)", p95, len(ds))
	return EvalResult{
		Value:            p95,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, p95, r.Threshold),
		Details:          preview,
	}, nil
}

func evalDailyCost(db *sql.DB, ws string, since, until int64, r *model.AlertRuleRow) (EvalResult, error) {
	q := baseExecQuery(db, ws, since, until)
	sq, params := model.BuildShellExecCountSQLFromExec(db, q)
	sq2 := strings.Replace(sq, "COUNT(*)", "COALESCE(SUM(e.est_usd),0)", 1)
	var sum float64
	err := db.QueryRow(sqlutil.RebindIfPostgres(db, sq2), params...).Scan(&sum)
	if err != nil {
		return EvalResult{}, err
	}
	wm := float64(r.WindowMinutes)
	if wm < 1 {
		wm = 5
	}
	daily := sum * (24.0 * 60.0 / wm)
	preview := fmt.Sprintf("est_daily≈$%.4f (window sum=$%.4f, %d min)", daily, sum, r.WindowMinutes)
	return EvalResult{
		Value:            daily,
		ConditionPreview: preview,
		Breached:         compare(r.Operator, daily, r.Threshold),
		Details:          preview,
	}, nil
}
