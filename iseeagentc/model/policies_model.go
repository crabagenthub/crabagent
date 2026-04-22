package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type InterceptionPolicy struct {
	ID            string  `json:"id"`
	WorkspaceName string  `json:"workspace_name"`
	Name          string  `json:"name"`
	Description   *string `json:"description,omitempty"`
	Pattern       string  `json:"pattern"`
	RedactType    string  `json:"redact_type"`
	TargetsJSON   string  `json:"targets_json"`
	Enabled       int     `json:"enabled"`
	Severity      string  `json:"severity"`
	PolicyAction  *string `json:"policy_action,omitempty"`
	InterceptMode *string `json:"intercept_mode,omitempty"`
	HintType      *string `json:"hint_type,omitempty"`
	DetectionKind *string `json:"detection_kind,omitempty"`
	CreatedAtMs   *int64  `json:"created_at_ms,omitempty"`
	PulledAtMs    *int64  `json:"pulled_at_ms"`
	UpdatedAtMs   int64   `json:"updated_at_ms"`
}

func normalizeWorkspaceName(s string) string {
	ws := strings.TrimSpace(s)
	if ws == "" {
		return "OpenClaw"
	}
	return ws
}

func trimNilString(v interface{}) *string {
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" || strings.EqualFold(s, "<nil>") {
		return nil
	}
	return &s
}

func CompareInterceptionPoliciesByRedactionOrder(a, b *InterceptionPolicy) int {
	priority := func(p *InterceptionPolicy) int {
		if p == nil {
			return 99
		}
		switch strings.ToLower(strings.TrimSpace(p.RedactType)) {
		case "block":
			return 0
		case "mask":
			return 1
		case "hash":
			return 2
		default:
			return 3
		}
	}
	ap, bp := priority(a), priority(b)
	if ap != bp {
		if ap < bp {
			return -1
		}
		return 1
	}
	an, bn := "", ""
	if a != nil {
		an = strings.ToLower(strings.TrimSpace(a.Name))
	}
	if b != nil {
		bn = strings.ToLower(strings.TrimSpace(b.Name))
	}
	if an < bn {
		return -1
	}
	if an > bn {
		return 1
	}
	return 0
}

func loadAllPolicies(db QueryDB, workspaceName string) ([]InterceptionPolicy, error) {
	ws := normalizeWorkspaceName(workspaceName)
	rows, err := db.Query(`
SELECT id, workspace_name, name, description, pattern, redact_type, targets_json, enabled,
       severity, policy_action, intercept_mode, hint_type, detection_kind, created_at_ms, pulled_at_ms, updated_at_ms
FROM `+CT.SecurityPolicies+`
WHERE lower(workspace_name) = lower(?)
ORDER BY updated_at_ms DESC`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]InterceptionPolicy, 0)
	for rows.Next() {
		var item InterceptionPolicy
		var desc, pa, im, ht, dk sql.NullString
		var created, pulled sql.NullInt64
		if err := rows.Scan(
			&item.ID, &item.WorkspaceName, &item.Name, &desc, &item.Pattern, &item.RedactType, &item.TargetsJSON, &item.Enabled,
			&item.Severity, &pa, &im, &ht, &dk, &created, &pulled, &item.UpdatedAtMs,
		); err != nil {
			return nil, err
		}
		if desc.Valid {
			s := desc.String
			item.Description = &s
		}
		if pa.Valid {
			s := pa.String
			item.PolicyAction = &s
		}
		if im.Valid {
			s := im.String
			item.InterceptMode = &s
		}
		if ht.Valid {
			s := ht.String
			item.HintType = &s
		}
		if dk.Valid {
			s := dk.String
			item.DetectionKind = &s
		}
		if created.Valid {
			v := created.Int64
			item.CreatedAtMs = &v
		}
		if pulled.Valid {
			v := pulled.Int64
			item.PulledAtMs = &v
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func upsertPolicyModel(db QueryDB, body map[string]interface{}, workspaceName string) (*InterceptionPolicy, error) {
	now := time.Now().UnixMilli()
	ws := normalizeWorkspaceName(workspaceName)
	id := strings.TrimSpace(fmt.Sprint(body["id"]))
	if id == "" || strings.EqualFold(id, "<nil>") {
		id = fmt.Sprintf("pol-%d", now)
	}
	name := strings.TrimSpace(fmt.Sprint(body["name"]))
	if name == "" || strings.EqualFold(name, "<nil>") {
		name = "Unnamed Policy"
	}
	pattern := strings.TrimSpace(fmt.Sprint(body["pattern"]))
	if strings.EqualFold(pattern, "<nil>") {
		pattern = ""
	}
	redactType := strings.ToLower(strings.TrimSpace(fmt.Sprint(body["redact_type"])))
	if redactType == "" || strings.EqualFold(redactType, "<nil>") {
		redactType = "mask"
	}
	if redactType != "mask" && redactType != "hash" && redactType != "block" {
		redactType = "mask"
	}
	enabled := 1
	if v, ok := body["enabled"]; ok && v != nil {
		switch t := v.(type) {
		case float64:
			if int(t) == 0 {
				enabled = 0
			}
		case int:
			if t == 0 {
				enabled = 0
			}
		case bool:
			if !t {
				enabled = 0
			}
		}
	}
	targets := strings.TrimSpace(fmt.Sprint(body["targets_json"]))
	if targets == "" || strings.EqualFold(targets, "<nil>") {
		targets = "[]"
	}
	severity := strings.TrimSpace(fmt.Sprint(body["severity"]))
	if severity == "" || strings.EqualFold(severity, "<nil>") {
		severity = "high"
	}
	policyAction := trimNilString(body["policy_action"])
	if policyAction == nil {
		v := "data_mask"
		policyAction = &v
	}
	interceptMode := trimNilString(body["intercept_mode"])
	if interceptMode == nil {
		v := "enforce"
		interceptMode = &v
	}
	detectionKind := trimNilString(body["detection_kind"])
	if detectionKind == nil {
		v := "regex"
		detectionKind = &v
	}
	hintType := trimNilString(body["hint_type"])
	desc := trimNilString(body["description"])

	_, err := db.Exec(`
INSERT INTO `+CT.SecurityPolicies+` (
  id, workspace_name, name, description, pattern, redact_type, targets_json, enabled,
  severity, policy_action, intercept_mode, hint_type, detection_kind, created_at_ms, pulled_at_ms, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  workspace_name = excluded.workspace_name,
  name = excluded.name,
  description = excluded.description,
  pattern = excluded.pattern,
  redact_type = excluded.redact_type,
  targets_json = excluded.targets_json,
  enabled = excluded.enabled,
  severity = excluded.severity,
  policy_action = excluded.policy_action,
  intercept_mode = excluded.intercept_mode,
  hint_type = excluded.hint_type,
  detection_kind = excluded.detection_kind,
  updated_at_ms = excluded.updated_at_ms`,
		id, ws, name, desc, pattern, redactType, targets, enabled,
		severity, policyAction, interceptMode, hintType, detectionKind, now, nil, now,
	)
	if err != nil {
		return nil, err
	}
	items, err := loadAllPolicies(db, ws)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].ID == id {
			return &items[i], nil
		}
	}
	return &InterceptionPolicy{
		ID: id, WorkspaceName: ws, Name: name, Description: desc, Pattern: pattern, RedactType: redactType,
		TargetsJSON: targets, Enabled: enabled, Severity: severity, PolicyAction: policyAction,
		InterceptMode: interceptMode, HintType: hintType, DetectionKind: detectionKind, UpdatedAtMs: now,
	}, nil
}

func deletePolicyModel(db QueryDB, id, workspaceName string) error {
	_, err := db.Exec(`DELETE FROM `+CT.SecurityPolicies+` WHERE id = ? AND lower(workspace_name) = lower(?)`, strings.TrimSpace(id), normalizeWorkspaceName(workspaceName))
	return err
}

func reportPoliciesPulledModel(db QueryDB, pulledAtMs int64, workspaceName string) (int64, error) {
	if pulledAtMs <= 0 {
		pulledAtMs = time.Now().UnixMilli()
	}
	ws := normalizeWorkspaceName(workspaceName)
	// First try to update policies matching the workspace
	res, err := db.Exec(`UPDATE `+CT.SecurityPolicies+` SET pulled_at_ms = ? WHERE lower(workspace_name) = lower(?)`, pulledAtMs, ws)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	// If no rows were updated, try updating all policies (fallback)
	if n == 0 {
		res, err = db.Exec(`UPDATE `+CT.SecurityPolicies+` SET pulled_at_ms = ?`, pulledAtMs)
		if err != nil {
			return 0, err
		}
		n, _ = res.RowsAffected()
	}
	return n, nil
}
