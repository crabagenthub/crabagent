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
			ConditionPreview: &ev.ConditionPreview,
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
		ConditionPreview: &ev.ConditionPreview,
		Status:           "sent",
		Breached:         true,
		PayloadJSON:      &s,
	})
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
