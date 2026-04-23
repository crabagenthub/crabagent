package alerts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"iseeagentc/model"
)

// Engine runs alert evaluations and webhooks with bounded concurrency.
type Engine struct {
	DB  *sql.DB
	sem chan struct{}
	mu  sync.Mutex
}

const maxConcurrent = 8

type pendingImmediateAlert struct {
	row     model.AlertRuleRow
	payload map[string]interface{}
	kind    string
	summary string
	value   float64
}

var (
	immediateNotifyMu      sync.Mutex
	immediateNotifyPending = map[string]map[string]pendingImmediateAlert{} // workspace -> ruleID -> candidate
	immediateNotifyTimer   = map[string]*time.Timer{}           // workspace -> flush timer
)

func (e *Engine) initSem() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.sem == nil {
		e.sem = make(chan struct{}, maxConcurrent)
	}
}

func (e *Engine) semAcquire() {
	e.initSem()
	e.sem <- struct{}{}
}

func (e *Engine) semRelease() { <-e.sem }

// StartEvaluateAsync loads rule, evaluates, optional webhook, persists event.
func (e *Engine) StartEvaluateAsync(workspace, ruleID, kind string, testOnly bool) {
	if e == nil || e.DB == nil {
		return
	}
	go e.run(context.Background(), workspace, ruleID, kind, testOnly)
}

func (e *Engine) run(ctx context.Context, workspace, ruleID, kind string, testOnly bool) {
	e.semAcquire()
	defer e.semRelease()
	ruleID = strings.TrimSpace(ruleID)
	ws := strings.TrimSpace(workspace)
	row, err := model.GetAlertRuleDB(e.DB, ruleID, ws)
	if err != nil || row == nil {
		_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
			ID:            newEventID(),
			WorkspaceName: ws,
			RuleID:        ruleID,
			Kind:          kind,
			FiredAtMs:     time.Now().UnixMilli(),
			Status:        "failed",
			ErrorText:     strPtr("rule not found"),
		})
		return
	}
	if testOnly {
		e.runTestWebhook(ctx, row, kind)
		return
	}
	ev, err := EvaluateRule(e.DB, row)
	summary := fmt.Sprintf("rule=%s metric=%s", row.Name, row.MetricKey)
	if err != nil {
		st := "failed"
		if err2 := model.InsertAlertEventDB(e.DB, model.AlertEventRow{
			ID:               newEventID(),
			WorkspaceName:    row.WorkspaceName,
			RuleID:           row.ID,
			Kind:             kind,
			FiredAtMs:        time.Now().UnixMilli(),
			Summary:          &summary,
			ConditionPreview: strPtr("evaluation error"),
			Status:           st,
			ErrorText:        strPtr(err.Error()),
		}); err2 != nil {
			log.Printf("alerts: insert event: %v", err2)
		}
		return
	}
	if ev.Details != "" {
		summary = summary + " | " + ev.Details
	}
	if !ev.Breached {
		return
	}
	payload := map[string]interface{}{
		"alert":          "crabagent",
		"rule_id":        row.ID,
		"rule_name":      row.Name,
		"metric_key":     row.MetricKey,
		"breached":       true,
		"value":          ev.Value,
		"threshold":      row.Threshold,
		"operator":       row.Operator,
		"window_minutes": row.WindowMinutes,
		"summary":        ev.Details,
		"fired_at_ms":    time.Now().UnixMilli(),
	}
	payload = alertWebhookPayload(row, payload)
	if kind == "ingest_immediate" {
		e.enqueueImmediateNotification(row, payload, kind, summary, ev.Value)
		return
	}
	e.sendAlert(ctx, row, payload, kind, summary)
}

// testWebhookPayload 飞书/钉钉等需按平台格式发测，否则对方返回 error code 或群中无消息。
func testWebhookPayload(row *model.AlertRuleRow) map[string]interface{} {
	u := strings.ToLower(strings.TrimSpace(row.WebhookURL))
	if strings.Contains(u, "open.feishu.cn") || strings.Contains(u, "open.larksuite.com") {
		text := fmt.Sprintf(
			"[Crabagent] 测试通知\n规则：%s（%s）\n说明：连通性测试，未评估阈值。",
			row.Name,
			row.ID,
		)
		return map[string]interface{}{
			"msg_type": "text",
			"content": map[string]interface{}{
				"text": text,
			},
		}
	}
	if strings.Contains(u, "oapi.dingtalk.com/robot") {
		text := fmt.Sprintf(
			"[Crabagent] 测试通知\n规则：%s（%s）\n说明：连通性测试，未评估阈值。",
			row.Name,
			row.ID,
		)
		return map[string]interface{}{
			"msgtype": "text",
			"text": map[string]interface{}{
				"content": text,
			},
		}
	}
	return map[string]interface{}{
		"alert":       "crabagent",
		"kind":        "test",
		"rule_id":     row.ID,
		"rule_name":   row.Name,
		"message":     "This is a connectivity test. No threshold was evaluated.",
		"fired_at_ms": time.Now().UnixMilli(),
	}
}

func (e *Engine) runTestWebhook(ctx context.Context, row *model.AlertRuleRow, kind string) {
	if row == nil {
		return
	}
	summary := fmt.Sprintf("test notify rule=%s", row.Name)
	payload := testWebhookPayload(row)
	u := strings.TrimSpace(row.WebhookURL)
	err := PostJSON(ctx, u, payload)
	if err != nil {
		em := err.Error()
		_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
			ID:            newEventID(),
			WorkspaceName: row.WorkspaceName,
			RuleID:        row.ID,
			Kind:          "test",
			FiredAtMs:     time.Now().UnixMilli(),
			Summary:       &summary,
			Status:        "failed",
			ErrorText:     &em,
		})
		return
	}
	pb, _ := json.Marshal(payload)
	s := string(pb)
	_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
		ID:            newEventID(),
		WorkspaceName: row.WorkspaceName,
		RuleID:        row.ID,
		Kind:          "test",
		FiredAtMs:     time.Now().UnixMilli(),
		Summary:       &summary,
		Status:        "sent",
		PayloadJSON:   &s,
	})
}

// RunWindowedIngestForWorkspace evaluates enabled rules whose frequency is not "immediate" (ingest path).
func (e *Engine) RunWindowedIngestForWorkspace(workspace string) {
	if e == nil || e.DB == nil {
		return
	}
	rules, err := model.ListAlertRulesDB(e.DB, workspace)
	if err != nil {
		log.Printf("alerts: list rules: %v", err)
		return
	}
	for i := range rules {
		if !rules[i].Enabled {
			continue
		}
		if RuleFrequencyMode(&rules[i]) == "immediate" {
			continue
		}
		r := rules[i]
		e.StartEvaluateAsync(r.WorkspaceName, r.ID, "ingest", false)
	}
}

// RunAllEnabledForWorkspace runs evaluation for all enabled rules (used by scheduler).
func (e *Engine) RunAllEnabledForWorkspace(workspace string) {
	e.RunAllEnabledForWorkspaceWithKind(workspace, "schedule")
}

// RunAllEnabledForWorkspaceWithKind uses kind for event rows ("schedule" | "ingest").
func (e *Engine) RunAllEnabledForWorkspaceWithKind(workspace, kind string) {
	if e == nil || e.DB == nil {
		return
	}
	if kind == "" {
		kind = "schedule"
	}
	rules, err := model.ListAlertRulesDB(e.DB, workspace)
	if err != nil {
		log.Printf("alerts: list rules: %v", err)
		return
	}
	for i := range rules {
		if !rules[i].Enabled {
			continue
		}
		r := rules[i]
		rid := r.ID
		e.StartEvaluateAsync(r.WorkspaceName, rid, kind, false)
	}
}

func newEventID() string {
	return fmt.Sprintf("aev-%d", time.Now().UnixNano())
}

func strPtr(s string) *string { return &s }

func (e *Engine) enqueueImmediateNotification(row *model.AlertRuleRow, payload map[string]interface{}, kind, summary string, value float64) {
	if row == nil {
		return
	}
	ws := strings.TrimSpace(row.WorkspaceName)
	if ws == "" {
		ws = "__unknown__"
	}
	cand := pendingImmediateAlert{
		row:     *row,
		payload: payload,
		kind:    kind,
		summary: summary,
		value:   value,
	}
	immediateNotifyMu.Lock()
	if _, ok := immediateNotifyPending[ws]; !ok {
		immediateNotifyPending[ws] = map[string]pendingImmediateAlert{}
	}
	immediateNotifyPending[ws][row.ID] = cand
	if t, ok := immediateNotifyTimer[ws]; ok && t != nil {
		immediateNotifyMu.Unlock()
		return
	}
	immediateNotifyTimer[ws] = time.AfterFunc(400*time.Millisecond, func() {
		e.flushImmediateNotification(ws)
	})
	immediateNotifyMu.Unlock()
}

func (e *Engine) flushImmediateNotification(workspace string) {
	immediateNotifyMu.Lock()
	candsByRule, ok := immediateNotifyPending[workspace]
	delete(immediateNotifyPending, workspace)
	delete(immediateNotifyTimer, workspace)
	immediateNotifyMu.Unlock()
	if !ok || len(candsByRule) == 0 {
		return
	}
	cands := make([]pendingImmediateAlert, 0, len(candsByRule))
	for _, v := range candsByRule {
		cands = append(cands, v)
	}
	if len(cands) == 1 {
		row := cands[0].row
		e.sendAlert(context.Background(), &row, cands[0].payload, cands[0].kind, cands[0].summary)
		return
	}
	e.sendMergedImmediateAlerts(context.Background(), cands)
}

func (e *Engine) sendMergedImmediateAlerts(ctx context.Context, cands []pendingImmediateAlert) {
	if len(cands) == 0 {
		return
	}
	first := cands[0]
	row := first.row
	ruleParts := make([]string, 0, len(cands))
	summaryParts := make([]string, 0, len(cands))
	for _, c := range cands {
		ruleParts = append(ruleParts, c.row.Name)
		summaryParts = append(summaryParts, fmt.Sprintf("- %s: %s", c.row.Name, c.summary))
	}
	mergedText := fmt.Sprintf(
		"[Crabagent] 合并告警提醒\n工作区：%s\n命中规则（%d）：%s\n详情：\n%s",
		strings.TrimSpace(row.WorkspaceName),
		len(cands),
		strings.Join(ruleParts, "、"),
		strings.Join(summaryParts, "\n"),
	)
	payload := map[string]interface{}{
		"msg_type": "text",
		"content": map[string]interface{}{
			"text": mergedText,
		},
	}
	u := strings.ToLower(strings.TrimSpace(row.WebhookURL))
	if strings.Contains(u, "oapi.dingtalk.com/robot") {
		payload = map[string]interface{}{
			"msgtype": "text",
			"text": map[string]interface{}{
				"content": mergedText,
			},
		}
	}
	webhookErr := PostJSON(ctx, strings.TrimSpace(row.WebhookURL), payload)
	pb, _ := json.Marshal(payload)
	payloadJSON := string(pb)
	if webhookErr != nil {
		em := webhookErr.Error()
		for _, c := range cands {
			s := "merged immediate alert failed: " + c.summary
			_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
				ID:            newEventID(),
				WorkspaceName: c.row.WorkspaceName,
				RuleID:        c.row.ID,
				Kind:          c.kind,
				FiredAtMs:     time.Now().UnixMilli(),
				Summary:       &s,
				Status:        "failed",
				ErrorText:     &em,
				Breached:      true,
				PayloadJSON:   &payloadJSON,
			})
		}
		return
	}
	for _, c := range cands {
		s := "merged immediate alert sent: " + c.summary
		_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
			ID:            newEventID(),
			WorkspaceName: c.row.WorkspaceName,
			RuleID:        c.row.ID,
			Kind:          c.kind,
			FiredAtMs:     time.Now().UnixMilli(),
			Summary:       &s,
			Status:        "sent",
			Breached:      true,
			PayloadJSON:   &payloadJSON,
		})
	}
}

func (e *Engine) sendAlert(ctx context.Context, row *model.AlertRuleRow, payload map[string]interface{}, kind, summary string) {
	webhookErr := PostJSON(ctx, strings.TrimSpace(row.WebhookURL), payload)
	if webhookErr != nil {
		em := webhookErr.Error()
		_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
			ID:               newEventID(),
			WorkspaceName:    row.WorkspaceName,
			RuleID:           row.ID,
			Kind:             kind,
			FiredAtMs:        time.Now().UnixMilli(),
			Summary:          &summary,
			ConditionPreview: nil,
			Status:           "failed",
			ErrorText:        &em,
			Breached:         true,
		})
		return
	}
	pb, _ := json.Marshal(payload)
	s := string(pb)
	_ = model.InsertAlertEventDB(e.DB, model.AlertEventRow{
		ID:               newEventID(),
		WorkspaceName:    row.WorkspaceName,
		RuleID:           row.ID,
		Kind:             kind,
		FiredAtMs:        time.Now().UnixMilli(),
		Summary:          &summary,
		ConditionPreview: nil,
		Status:           "sent",
		Breached:         true,
		PayloadJSON:      &s,
	})
}

func alertWebhookPayload(row *model.AlertRuleRow, generic map[string]interface{}) map[string]interface{} {
	if row == nil {
		return generic
	}
	lang := ruleLanguage(row)
	text := buildReadableAlertText(row, generic, lang)
	u := strings.ToLower(strings.TrimSpace(row.WebhookURL))
	if strings.Contains(u, "open.feishu.cn") || strings.Contains(u, "open.larksuite.com") {
		return map[string]interface{}{
			"msg_type": "text",
			"content": map[string]interface{}{
				"text": text,
			},
		}
	}
	if strings.Contains(u, "oapi.dingtalk.com/robot") {
		return map[string]interface{}{
			"msgtype": "text",
			"text": map[string]interface{}{
				"content": text,
			},
		}
	}
	return generic
}

func ruleLanguage(row *model.AlertRuleRow) string {
	if row == nil || row.AdvancedJSON == nil {
		return "zh-CN"
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(*row.AdvancedJSON)), &raw); err != nil {
		return "zh-CN"
	}
	for _, k := range []string{"ruleLanguage", "rule_language", "locale", "lang"} {
		v, ok := raw[k].(string)
		if ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return "zh-CN"
}

func buildReadableAlertText(row *model.AlertRuleRow, generic map[string]interface{}, lang string) string {
	ruleName := strings.TrimSpace(row.Name)
	if ruleName == "" {
		ruleName = row.ID
	}
	value := parseAnyFloat(generic["value"])
	summary := fmt.Sprintf("%v", generic["summary"])
	if summary == "" || summary == "<nil>" {
		summary = "-"
	}
	isZh := strings.HasPrefix(strings.ToLower(strings.TrimSpace(lang)), "zh")
	if isZh {
		return fmt.Sprintf(
			"[Crabagent] 告警提醒\n规则：%s\n检测到异常，当前值 %.4g（阈值 %s %.4g）\n说明：%s",
			ruleName,
			value,
			row.Operator,
			row.Threshold,
			summary,
		)
	}
	return fmt.Sprintf(
		"[Crabagent] Alert\nRule: %s\nAn anomaly was detected. Current value %.4g (threshold %s %.4g)\nNote: %s",
		ruleName,
		value,
		row.Operator,
		row.Threshold,
		summary,
	)
}

func parseAnyFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}
