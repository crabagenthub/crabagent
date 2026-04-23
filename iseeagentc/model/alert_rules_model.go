package model

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"iseeagentc/internal/sqlutil"
)

// AlertRuleRow mirrors agent_alert_rules (and JSON fields for API).
type AlertRuleRow struct {
	ID               string   `json:"id"`
	WorkspaceName    string   `json:"workspace_name"`
	Name             string   `json:"name"`
	AlertCode        *string  `json:"alert_code,omitempty"`
	Severity         *string  `json:"severity,omitempty"`
	AggregateKey     *string  `json:"aggregate_key,omitempty"`
	ConditionSummary *string  `json:"condition_summary,omitempty"`
	Enabled          bool     `json:"enabled"`
	MetricKey        string   `json:"metric_key"`
	Operator         string   `json:"operator"`
	Threshold        float64  `json:"threshold"`
	WindowMinutes    int      `json:"window_minutes"`
	Delivery         string   `json:"delivery"`
	WebhookType      string   `json:"webhook_type"`
	WebhookURL       string   `json:"webhook_url"`
	AdvancedJSON     *string  `json:"advanced_json,omitempty"`
	CreatedAtMs      int64    `json:"created_at"`
	UpdatedAtMs      int64    `json:"updated_at"`
}

// AlertEventRow mirrors agent_alert_events.
type AlertEventRow struct {
	ID               string  `json:"id"`
	WorkspaceName    string  `json:"workspace_name"`
	RuleID           string  `json:"rule_id"`
	Kind             string  `json:"kind"`
	FiredAtMs        int64   `json:"fired_at"`
	Summary          *string `json:"summary,omitempty"`
	ConditionPreview *string `json:"condition_preview,omitempty"`
	Status           string  `json:"status"`
	ErrorText        *string `json:"error_text,omitempty"`
	Breached         bool    `json:"breached"`
	PayloadJSON      *string `json:"payload_json,omitempty"`
}

func normalizeWS(ws string) string {
	return strings.TrimSpace(ws)
}

// ListAlertRulesDB returns rules for workspace (empty workspace = all).
func ListAlertRulesDB(db *sql.DB, workspaceName string) ([]AlertRuleRow, error) {
	var q string
	var args []any
	ws := normalizeWS(workspaceName)
	if ws == "" {
		q = `SELECT id, workspace_name, name, alert_code, severity, aggregate_key, condition_summary, enabled,
 metric_key, operator, threshold, window_minutes, delivery, webhook_type, webhook_url, advanced_json, created_at_ms, updated_at_ms
 FROM ` + CT.AlertRules + ` ORDER BY updated_at_ms DESC`
	} else {
		q = `SELECT id, workspace_name, name, alert_code, severity, aggregate_key, condition_summary, enabled,
 metric_key, operator, threshold, window_minutes, delivery, webhook_type, webhook_url, advanced_json, created_at_ms, updated_at_ms
 FROM ` + CT.AlertRules + ` WHERE lower(trim(workspace_name)) = lower(trim(?)) ORDER BY updated_at_ms DESC`
		args = append(args, ws)
	}
	rows, err := db.Query(sqlutil.RebindIfPostgres(db, q), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AlertRuleRow
	for rows.Next() {
		r, err := scanAlertRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func scanAlertRule(sc interface {
	Scan(dest ...any) error
}) (AlertRuleRow, error) {
	var r AlertRuleRow
	var alertCode, sev, agg, cond, adv sql.NullString
	var en int
	err := sc.Scan(
		&r.ID, &r.WorkspaceName, &r.Name, &alertCode, &sev, &agg, &cond, &en,
		&r.MetricKey, &r.Operator, &r.Threshold, &r.WindowMinutes, &r.Delivery, &r.WebhookType, &r.WebhookURL, &adv, &r.CreatedAtMs, &r.UpdatedAtMs,
	)
	if err != nil {
		return r, err
	}
	r.Enabled = en != 0
	if alertCode.Valid {
		s := strings.TrimSpace(alertCode.String)
		r.AlertCode = &s
	}
	if sev.Valid {
		s := strings.TrimSpace(sev.String)
		r.Severity = &s
	}
	if agg.Valid {
		s := strings.TrimSpace(agg.String)
		r.AggregateKey = &s
	}
	if cond.Valid {
		s := strings.TrimSpace(cond.String)
		r.ConditionSummary = &s
	}
	if adv.Valid && strings.TrimSpace(adv.String) != "" {
		s := adv.String
		r.AdvancedJSON = &s
	}
	return r, nil
}

// GetAlertRuleDB loads one rule by id and workspace (optional filter).
func GetAlertRuleDB(db *sql.DB, id, workspaceName string) (*AlertRuleRow, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("alert rule id required")
	}
	ws := normalizeWS(workspaceName)
	q := `SELECT id, workspace_name, name, alert_code, severity, aggregate_key, condition_summary, enabled,
 metric_key, operator, threshold, window_minutes, delivery, webhook_type, webhook_url, advanced_json, created_at_ms, updated_at_ms
 FROM ` + CT.AlertRules + ` WHERE id = ?`
	args := []any{id}
	if ws != "" {
		q += ` AND lower(trim(workspace_name)) = lower(trim(?))`
		args = append(args, ws)
	}
	row := db.QueryRow(sqlutil.RebindIfPostgres(db, q), args...)
	r, err := scanAlertRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// UpsertAlertRuleDB inserts or updates a rule. Body JSON keys align with frontend.
func UpsertAlertRuleDB(db *sql.DB, workspaceName string, body map[string]interface{}) (*AlertRuleRow, error) {
	now := time.Now().UnixMilli()
	ws := normalizeWS(workspaceName)
	if ws == "" {
		ws = "default"
	}
	id := strings.TrimSpace(fmt.Sprint(body["id"]))
	if id == "" {
		id = fmt.Sprintf("ar-%d", now)
	}
	name := strings.TrimSpace(fmt.Sprint(body["name"]))
	if name == "" {
		name = "Untitled"
	}
	metricKey := strings.TrimSpace(fmt.Sprint(body["metric_key"]))
	if metricKey == "" {
		metricKey = "error_rate_pct"
	}
	operator := strings.TrimSpace(fmt.Sprint(body["operator"]))
	if operator == "" {
		operator = "gt"
	}
	threshold := parseFloat64(body["threshold"])
	windowMinutes := int(parseFloat64(body["window_minutes"]))
	if windowMinutes < 1 {
		windowMinutes = 5
	}
	enabled := 1
	if v, ok := body["enabled"]; ok {
		switch t := v.(type) {
		case bool:
			if !t {
				enabled = 0
			}
		case float64:
			if int(t) == 0 {
				enabled = 0
			}
		}
	}
	delivery := strings.TrimSpace(fmt.Sprint(body["delivery"]))
	if delivery == "" {
		delivery = "webhook"
	}
	webhookType := strings.TrimSpace(fmt.Sprint(body["webhook_type"]))
	if webhookType == "" {
		webhookType = "generic"
	}
	webhookURL := strings.TrimSpace(fmt.Sprint(body["webhook_url"]))

	adv := advancedJSONFromBody(body)
	var advStr *string
	if len(adv) > 0 {
		b, _ := json.Marshal(adv)
		s := string(b)
		advStr = &s
	}

	createdAt := now
	if v, ok := body["created_at"]; ok {
		if f := parseFloat64(v); f > 0 {
			createdAt = int64(f)
		}
	}

	_, err := db.Exec(
		`INSERT INTO `+CT.AlertRules+` (id, workspace_name, name, alert_code, severity, aggregate_key, condition_summary, enabled,
  metric_key, operator, threshold, window_minutes, delivery, webhook_type, webhook_url, advanced_json, created_at_ms, updated_at_ms)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 `+onConflictUpdateRules(db),
		id, ws, name,
		nullableString(body, "alert_code"),
		nullableString(body, "severity"),
		nullableString(body, "aggregate_key"),
		nullableString(body, "condition_summary"),
		enabled, metricKey, operator, threshold, windowMinutes, delivery, webhookType, webhookURL, optionalStringSQL(advStr),
		createdAt, now,
	)
	if err != nil {
		return nil, err
	}
	return GetAlertRuleDB(db, id, ws)
}

func onConflictUpdateRules(db *sql.DB) string {
	if sqlutil.IsSQLite(db) {
		return `ON CONFLICT (id) DO UPDATE SET
  workspace_name = excluded.workspace_name,
  name = excluded.name,
  alert_code = excluded.alert_code,
  severity = excluded.severity,
  aggregate_key = excluded.aggregate_key,
  condition_summary = excluded.condition_summary,
  enabled = excluded.enabled,
  metric_key = excluded.metric_key,
  operator = excluded.operator,
  threshold = excluded.threshold,
  window_minutes = excluded.window_minutes,
  delivery = excluded.delivery,
  webhook_type = excluded.webhook_type,
  webhook_url = excluded.webhook_url,
  advanced_json = excluded.advanced_json,
  updated_at_ms = excluded.updated_at_ms`
	}
	// postgres upsert
	return `ON CONFLICT (id) DO UPDATE SET
  workspace_name = EXCLUDED.workspace_name,
  name = EXCLUDED.name,
  alert_code = EXCLUDED.alert_code,
  severity = EXCLUDED.severity,
  aggregate_key = EXCLUDED.aggregate_key,
  condition_summary = EXCLUDED.condition_summary,
  enabled = EXCLUDED.enabled,
  metric_key = EXCLUDED.metric_key,
  operator = EXCLUDED.operator,
  threshold = EXCLUDED.threshold,
  window_minutes = EXCLUDED.window_minutes,
  delivery = EXCLUDED.delivery,
  webhook_type = EXCLUDED.webhook_type,
  webhook_url = EXCLUDED.webhook_url,
  advanced_json = EXCLUDED.advanced_json,
  updated_at_ms = EXCLUDED.updated_at_ms`
}

func optionalStringSQL(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

func nullableString(body map[string]interface{}, key string) *string {
	v, ok := body[key]
	if !ok || v == nil {
		return nil
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" {
		return nil
	}
	return &s
}

func advancedJSONFromBody(body map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{})
	if v, ok := firstString(body, "source_table", "sourceTable"); ok {
		out["sourceTable"] = v
	}
	if v, ok := firstString(body, "condition_field", "conditionField"); ok {
		out["conditionField"] = v
	}
	if v, ok := firstString(body, "match_type", "matchType"); ok {
		out["matchType"] = v
	}
	if v, ok := body["count_threshold"]; ok {
		out["countThreshold"] = parseFloat64(v)
	} else if v, ok := body["countThreshold"]; ok {
		out["countThreshold"] = parseFloat64(v)
	}
	if v, ok := firstString(body, "frequency_mode", "frequencyMode"); ok {
		out["frequencyMode"] = v
	}
	if v, ok := firstString(body, "rule_language", "ruleLanguage"); ok {
		out["ruleLanguage"] = v
	}
	if v, ok := firstString(body, "template_id", "templateId"); ok {
		out["templateId"] = v
	}
	if v, ok := body["sub_window_minutes"]; ok {
		out["subWindowMinutes"] = parseFloat64(v)
	} else if v, ok := body["subWindowMinutes"]; ok {
		out["subWindowMinutes"] = parseFloat64(v)
	}
	if v, ok := firstString(body, "sub_window_mode", "subWindowMode"); ok {
		out["subWindowMode"] = v
	}
	return out
}

func firstString(body map[string]interface{}, keys ...string) (string, bool) {
	for _, k := range keys {
		if v, ok := body[k]; ok && v != nil {
			s := strings.TrimSpace(fmt.Sprint(v))
			if s != "" {
				return s, true
			}
		}
	}
	return "", false
}

func parseFloat64(v interface{}) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		s := strings.TrimSpace(fmt.Sprint(t))
		if s == "" {
			return 0
		}
		var f float64
		_, _ = fmt.Sscanf(s, "%f", &f)
		return f
	}
}

// DeleteAlertRuleDB removes a rule.
func DeleteAlertRuleDB(db *sql.DB, id, workspaceName string) error {
	ws := normalizeWS(workspaceName)
	q := `DELETE FROM ` + CT.AlertRules + ` WHERE id = ?`
	args := []any{id}
	if ws != "" {
		q += ` AND lower(trim(workspace_name)) = lower(trim(?))`
		args = append(args, ws)
	}
	_, err := db.Exec(sqlutil.RebindIfPostgres(db, q), args...)
	return err
}

// ListAlertEventsDB lists recent events for workspace.
func ListAlertEventsDB(db *sql.DB, workspaceName string, limit int) ([]AlertEventRow, error) {
	if limit < 1 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	ws := normalizeWS(workspaceName)
	var q string
	var args []any
	if ws == "" {
		q = `SELECT id, workspace_name, rule_id, kind, fired_at_ms, summary, condition_preview, status, error_text, breached, payload_json
 FROM ` + CT.AlertEvents + ` ORDER BY fired_at_ms DESC LIMIT ?`
		args = []any{limit}
	} else {
		q = `SELECT id, workspace_name, rule_id, kind, fired_at_ms, summary, condition_preview, status, error_text, breached, payload_json
 FROM ` + CT.AlertEvents + ` WHERE lower(trim(workspace_name)) = lower(trim(?)) ORDER BY fired_at_ms DESC LIMIT ?`
		args = []any{ws, limit}
	}
	rows, err := db.Query(sqlutil.RebindIfPostgres(db, q), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AlertEventRow
	for rows.Next() {
		var r AlertEventRow
		var sum, cond, errT, pay sql.NullString
		var br int
		if err := rows.Scan(&r.ID, &r.WorkspaceName, &r.RuleID, &r.Kind, &r.FiredAtMs, &sum, &cond, &r.Status, &errT, &br, &pay); err != nil {
			return nil, err
		}
		r.Breached = br != 0
		if sum.Valid {
			s := sum.String
			r.Summary = &s
		}
		if cond.Valid {
			s := cond.String
			r.ConditionPreview = &s
		}
		if errT.Valid {
			s := errT.String
			r.ErrorText = &s
		}
		if pay.Valid && strings.TrimSpace(pay.String) != "" {
			s := pay.String
			r.PayloadJSON = &s
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// InsertAlertEventDB inserts a fired event.
func InsertAlertEventDB(db *sql.DB, r AlertEventRow) error {
	if r.ID == "" {
		r.ID = fmt.Sprintf("aev-%d", time.Now().UnixNano())
	}
	en := 0
	if r.Breached {
		en = 1
	}
	_, err := db.Exec(
		`INSERT INTO `+CT.AlertEvents+` (id, workspace_name, rule_id, kind, fired_at_ms, summary, condition_preview, status, error_text, breached, payload_json)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.WorkspaceName, r.RuleID, r.Kind, r.FiredAtMs, optionalStringSQL(r.Summary), optionalStringSQL(r.ConditionPreview), r.Status, optionalStringSQL(r.ErrorText), en, optionalStringSQL(r.PayloadJSON),
	)
	return err
}

// RuleRowToAPIJSON maps DB row to API map including camelCase advanced fields.
func RuleRowToAPIJSON(r *AlertRuleRow) map[string]interface{} {
	if r == nil {
		return nil
	}
	m := map[string]interface{}{
		"id":                r.ID,
		"workspace_name":    r.WorkspaceName,
		"name":              r.Name,
		"enabled":           r.Enabled,
		"metric_key":        r.MetricKey,
		"operator":          r.Operator,
		"threshold":         r.Threshold,
		"window_minutes":    r.WindowMinutes,
		"delivery":          r.Delivery,
		"webhook_type":      r.WebhookType,
		"webhook_url":       r.WebhookURL,
		"created_at":        r.CreatedAtMs,
		"updated_at":        r.UpdatedAtMs,
	}
	if r.AlertCode != nil {
		m["alert_code"] = *r.AlertCode
	}
	if r.Severity != nil {
		m["severity"] = *r.Severity
	}
	if r.AggregateKey != nil {
		m["aggregate_key"] = *r.AggregateKey
	}
	if r.ConditionSummary != nil {
		m["condition_summary"] = *r.ConditionSummary
	}
	if r.AdvancedJSON != nil {
		m["advanced_json"] = *r.AdvancedJSON
		var adv map[string]interface{}
		_ = json.Unmarshal([]byte(*r.AdvancedJSON), &adv)
		for k, v := range adv {
			m[k] = v
		}
	}
	return m
}
