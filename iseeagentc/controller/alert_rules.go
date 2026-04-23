package controller

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"iseeagentc/internal/alerts"
	"iseeagentc/internal/errors"
	"iseeagentc/internal/resource"
	"iseeagentc/model"
)

func alertDB(c *gin.Context) (*sql.DB, error) {
	if resource.DB == nil {
		return nil, errors.InternalError("database unavailable, ensure MustInit completed")
	}
	return resource.DB.DB()
}

// AlertRulesList GET /v1/alert-rules?workspace_name=
func AlertRulesList(c *gin.Context, _ *struct{}) {
	db, err := alertDB(c)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	ws := c.Query("workspace_name")
	items, err := model.ListAlertRulesDB(db, ws)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	out := make([]map[string]interface{}, 0, len(items))
	for i := range items {
		out = append(out, model.RuleRowToAPIJSON(&items[i]))
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"items": out})
}

// AlertRulesEventsList GET /v1/alert-events?workspace_name=
func AlertRulesEventsList(c *gin.Context, _ *struct{}) {
	db, err := alertDB(c)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	ws := c.Query("workspace_name")
	ev, err := model.ListAlertEventsDB(db, ws, 200)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"items": ev})
}

// AlertRulesUpsert POST /v1/alert-rules?workspace_name=
func AlertRulesUpsert(c *gin.Context) {
	db, err := alertDB(c)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("body", "invalid_json"))
		return
	}
	row, err := model.UpsertAlertRuleDB(db, c.Query("workspace_name"), body)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, model.RuleRowToAPIJSON(row))
}

// AlertRulesDelete DELETE /v1/alert-rules/:id
func AlertRulesDelete(c *gin.Context) {
	db, err := alertDB(c)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("id", "required"))
		return
	}
	if err := model.DeleteAlertRuleDB(db, id, c.Query("workspace_name")); err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]bool{"ok": true})
}

// AlertRulesTest POST /v1/alert-rules/:id/test — only webhook sample (async).
func AlertRulesTest(c *gin.Context) {
	db, err := alertDB(c)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("id", "required"))
		return
	}
	eng := &alerts.Engine{DB: db}
	eng.StartEvaluateAsync(c.Query("workspace_name"), id, "test", true)
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"ok": true, "queued": true})
}

// AlertRulesEvaluate POST /v1/alert-rules/:id/evaluate — full evaluation + webhook on breach (async).
func AlertRulesEvaluate(c *gin.Context) {
	db, err := alertDB(c)
	if err != nil {
		AbortWithWriteErrorResponse(c, err)
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("id", "required"))
		return
	}
	eng := &alerts.Engine{DB: db}
	eng.StartEvaluateAsync(c.Query("workspace_name"), id, "manual", false)
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"ok": true, "queued": true})
}
