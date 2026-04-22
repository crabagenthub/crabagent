package controller

/*
   Author : lucbine
   DateTime : 2024/3/4
   Description :
*/
import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"iseeagentc/internal/config"
	"iseeagentc/internal/errors"
	"iseeagentc/internal/resource"
	"iseeagentc/model"
	"iseeagentc/service"
)

type TraceListRequest struct {
	Limit          int    `form:"limit"`
	Offset         int    `form:"offset"`
	Order          string `form:"order"`
	Sort           string `form:"sort"`
	Search         string `form:"search"`
	SinceMs        string `form:"since_ms"`
	UntilMs        string `form:"until_ms"`
	Channel        string `form:"channel"`
	Agent          string `form:"agent"`
	WorkspaceName  string `form:"workspace_name"`
	MinTotalTokens string `form:"min_total_tokens"`
	MinLoopCount   string `form:"min_loop_count"`
	MinToolCalls   string `form:"min_tool_calls"`
}

type ThreadListRequest struct {
	Limit         int    `form:"limit"`
	Offset        int    `form:"offset"`
	Order         string `form:"order"`
	Sort          string `form:"sort"`
	Search        string `form:"search"`
	SinceMs       string `form:"since_ms"`
	UntilMs       string `form:"until_ms"`
	Channel       string `form:"channel"`
	Agent         string `form:"agent"`
	WorkspaceName string `form:"workspace_name"`
}

type SpanListRequest struct {
	Limit         int    `form:"limit"`
	Offset        int    `form:"offset"`
	Order         string `form:"order"`
	Sort          string `form:"sort"`
	Search        string `form:"search"`
	SinceMs       string `form:"since_ms"`
	UntilMs       string `form:"until_ms"`
	Channel       string `form:"channel"`
	Agent         string `form:"agent"`
	SpanType      string `form:"span_type"`
	WorkspaceName string `form:"workspace_name"`
}

type TraceSpansRequest struct {
	TraceID string `form:"trace_id"`
}

type TraceMessagesRequest struct {
	Limit  int    `form:"limit"`
	Offset int    `form:"offset"`
	Order  string `form:"order"`
	Search string `form:"search"`
}

type TraceExecGraphRequest struct {
	TraceID  string `form:"trace_id"`
	MaxNodes string `form:"max_nodes"`
}

type ObserveFacetsRequest struct {
	WorkspaceName string `form:"workspace_name"`
}

type ShellExecSummaryRequest struct {
	SinceMs         string `form:"since_ms"`
	UntilMs         string `form:"until_ms"`
	TraceID         string `form:"trace_id"`
	Channel         string `form:"channel"`
	Agent           string `form:"agent"`
	CommandContains string `form:"command_contains"`
	WorkspaceName   string `form:"workspace_name"`
	MinDurationMs   string `form:"min_duration_ms"`
	MaxDurationMs   string `form:"max_duration_ms"`
}

type ShellExecListRequest struct {
	SinceMs         string `form:"since_ms"`
	UntilMs         string `form:"until_ms"`
	TraceID         string `form:"trace_id"`
	Channel         string `form:"channel"`
	Agent           string `form:"agent"`
	CommandContains string `form:"command_contains"`
	WorkspaceName   string `form:"workspace_name"`
	MinDurationMs   string `form:"min_duration_ms"`
	MaxDurationMs   string `form:"max_duration_ms"`
	Limit           int    `form:"limit"`
	Offset          int    `form:"offset"`
	Order           string `form:"order"`
}

type ShellExecDetailRequest struct {
	SpanID string `form:"span_id"`
}

type ShellExecReplayRequest struct {
	TraceID string `form:"trace_id"`
}

type ResourceAuditEventsRequest struct {
	Limit         int    `form:"limit"`
	Offset        int    `form:"offset"`
	Order         string `form:"order"`
	SinceMs       string `form:"since_ms"`
	UntilMs       string `form:"until_ms"`
	Search        string `form:"search"`
	URIPrefix     string `form:"uri_prefix"`
	TraceID       string `form:"trace_id"`
	SpanID        string `form:"span_id"`
	HintType      string `form:"hint_type"`
	PolicyID      string `form:"policy_id"`
	SpanName      string `form:"span_name"`
	WorkspaceName string `form:"workspace_name"`
	SortMode      string `form:"sort_mode"`
	SemanticClass string `form:"semantic_class"`
}

type ResourceAuditStatsRequest struct {
	SinceMs       string `form:"since_ms"`
	UntilMs       string `form:"until_ms"`
	Search        string `form:"search"`
	URIPrefix     string `form:"uri_prefix"`
	TraceID       string `form:"trace_id"`
	SpanID        string `form:"span_id"`
	HintType      string `form:"hint_type"`
	PolicyID      string `form:"policy_id"`
	WorkspaceName string `form:"workspace_name"`
	SemanticClass string `form:"semantic_class"`
}

type SecurityAuditEventsRequest struct {
	Limit         int    `form:"limit"`
	Offset        int    `form:"offset"`
	Order         string `form:"order"`
	SinceMs       string `form:"since_ms"`
	UntilMs       string `form:"until_ms"`
	TraceID       string `form:"trace_id"`
	SpanID        string `form:"span_id"`
	PolicyID      string `form:"policy_id"`
	HintType      string `form:"hint_type"`
	WorkspaceName string `form:"workspace_name"`
}

type SecurityAuditPolicyCountsRequest struct {
	WorkspaceName string `form:"workspace_name"`
}

type PolicyPullReportRequest struct {
	PulledAtMs *float64 `json:"pulled_at_ms"`
}

func PoliciesList(c *gin.Context, req *struct{}) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	tracePolicyService := service.NewTracePolicyService(db)
	items, err := tracePolicyService.List(c.Query("workspace_name"))
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	// Only update pulled_at_ms when request is from plugin
	if c.Query("update_pulled") == "true" {
		_, _ = tracePolicyService.ReportPulled(time.Now().UnixMilli(), c.Query("workspace_name"))
	}
	AbortWithResultAndStatus(c, http.StatusOK, items)
}

func Health(c *gin.Context) {
	if resource.DB == nil {
		AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{
			"ok":            true,
			"service":       "crabagent-collector-go",
			"primary_ready": false,
		})
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{
		"ok":            true,
		"service":       "crabagent-collector-go",
		"primary_ready": true,
	})
}

func PoliciesUpsert(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("body", "invalid_json"))
		return
	}
	tracePolicyService := service.NewTracePolicyService(db)
	resp, err := tracePolicyService.Upsert(body, c.Query("workspace_name"))
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func PoliciesDelete(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("id", "required"))
		return
	}
	tracePolicyService := service.NewTracePolicyService(db)
	if err := tracePolicyService.Delete(id, c.Query("workspace_name")); err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]bool{"ok": true})
}

func PoliciesPullReport(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	req := &PolicyPullReportRequest{}
	_ = c.ShouldBindJSON(req)
	pulled := time.Now().UnixMilli()
	if req.PulledAtMs != nil && *req.PulledAtMs > 0 {
		pulled = int64(*req.PulledAtMs)
	}
	tracePolicyService := service.NewTracePolicyService(db)
	updated, err := tracePolicyService.ReportPulled(pulled, c.Query("workspace_name"))
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"ok": true, "updated": updated, "pulled_at_ms": pulled})
}

func OpikBatch(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	var body interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("body", "invalid_json"))
		return
	}
	traceSessionService := service.NewTraceSessionService(db)
	resp, err := traceSessionService.ApplyOpikBatch(body)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"ok": true, "accepted": resp.Accepted, "skipped": resp.Skipped})
}

func IngestGone(c *gin.Context) {
	AbortWithResultAndStatus(c, http.StatusGone, map[string]string{
		"error": "gone",
		"hint":  "Use POST /v1/opik/batch with opik-openclaw shaped JSON (threads, traces, spans, ...).",
	})
}

func TracesLegacy(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	limit := parseIntDefault(c.Query("limit"), 50)
	traceSessionService := service.NewTraceSessionService(db)
	items, err := traceSessionService.ListLegacyTraces(limit)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"items": items})
}

func TraceMessages(c *gin.Context, req *TraceMessagesRequest) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	if req == nil {
		req = &TraceMessagesRequest{}
	}
	traceMessagesService := service.NewTraceMessagesService(db)
	items := traceMessagesService.List(req.Limit, req.Offset, req.Order, req.Search)
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"items": items})
}

func TraceList(c *gin.Context, req *TraceListRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	if order != "asc" && order != "desc" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("order", "must be asc|desc"))
		return
	}
	req.Order = order

	sort := strings.ToLower(strings.TrimSpace(req.Sort))
	if sort != "" && sort != "time" && sort != "tokens" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("sort", "must be time|tokens"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}

	if req.Limit == 0 {
		req.Limit = 10
	}

	if req.Limit > 100 {
		req.Limit = 100
	}

	traceService := service.NewTraceService(
		resource.DB,
		config.NewCollectorProxyConfig().DefaultWindowMs,
	)

	resp, err := traceService.List(service.TraceListQuery{
		Limit:          req.Limit,
		Offset:         req.Offset,
		Order:          req.Order,
		Sort:           req.Sort,
		Search:         req.Search,
		SinceMs:        req.SinceMs,
		UntilMs:        req.UntilMs,
		Channel:        req.Channel,
		Agent:          req.Agent,
		WorkspaceName:  req.WorkspaceName,
		MinTotalTokens: req.MinTotalTokens,
		MinLoopCount:   req.MinLoopCount,
		MinToolCalls:   req.MinToolCalls,
	}, c.QueryArray("status"))

	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func ThreadList(c *gin.Context, req *ThreadListRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	if order != "" && order != "asc" && order != "desc" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("order", "must be asc|desc"))
		return
	}
	req.Order = order
	sort := strings.ToLower(strings.TrimSpace(req.Sort))
	if sort != "" && sort != "time" && sort != "tokens" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("sort", "must be time|tokens"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	traceService := service.NewTraceService(
		resource.DB,
		config.NewCollectorProxyConfig().DefaultWindowMs,
	)
	resp, err := traceService.ThreadList(service.ThreadListQuery{
		Limit:         req.Limit,
		Offset:        req.Offset,
		Order:         req.Order,
		Sort:          req.Sort,
		Search:        req.Search,
		SinceMs:       req.SinceMs,
		UntilMs:       req.UntilMs,
		Channel:       req.Channel,
		Agent:         req.Agent,
		WorkspaceName: req.WorkspaceName,
	})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func SpanList(c *gin.Context, req *SpanListRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	if order != "" && order != "asc" && order != "desc" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("order", "must be asc|desc"))
		return
	}
	req.Order = order
	sort := strings.ToLower(strings.TrimSpace(req.Sort))
	if sort != "" && sort != "time" && sort != "tokens" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("sort", "must be time|tokens"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	traceService := service.NewTraceService(
		resource.DB,
		config.NewCollectorProxyConfig().DefaultWindowMs,
	)
	resp, err := traceService.SpanList(service.SpanListQuery{
		Limit:         req.Limit,
		Offset:        req.Offset,
		Order:         req.Order,
		Sort:          req.Sort,
		Search:        req.Search,
		SinceMs:       req.SinceMs,
		UntilMs:       req.UntilMs,
		Channel:       req.Channel,
		Agent:         req.Agent,
		SpanType:      req.SpanType,
		WorkspaceName: req.WorkspaceName,
	}, c.QueryArray("status"))
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, resp)
}

func TraceSpans(c *gin.Context, req *TraceSpansRequest) {
	if req == nil || strings.TrimSpace(req.TraceID) == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("trace_id", "required"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	traceGraphService := service.NewTraceGraphService(db)
	canonical, items, ti, err := traceGraphService.TraceSpans(req.TraceID)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	raCfg := model.LoadResourceAuditQueryConfig()
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{
		"trace_id":                          canonical,
		"items":                             items,
		"trace_input":                       ti,
		"large_tool_result_threshold_chars": raCfg.LargeToolResult.ThresholdChars,
	})
}

func ThreadTraceEvents(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	key := strings.TrimSpace(c.Param("traceRootId"))
	if u, err := url.PathUnescape(key); err == nil {
		key = u
	}
	traceGraphService := service.NewTraceGraphService(db)
	items, err := traceGraphService.ThreadTraceEvents(key)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"thread_key": key, "items": items})
}

// ThreadTraceStream SSE：与 Node Collector `/v1/traces/:traceRootId/stream` 对齐（ready 事件 + 周期 ping）。
// 当前无服务端推送业务数据（与 Node 侧 ssePublish 未被调用一致）。
func ThreadTraceStream(c *gin.Context) {
	threadKey := strings.TrimSpace(c.Param("traceRootId"))
	if threadKey == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("traceRootId", "required"))
		return
	}
	if u, err := url.PathUnescape(threadKey); err == nil {
		threadKey = u
	}

	h := c.Writer.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		AbortWithWriteErrorResponse(c, errors.InternalError("streaming not supported"))
		return
	}

	writeChunk := func(chunk string) {
		_, _ = c.Writer.Write([]byte(chunk))
		flusher.Flush()
	}

	readyPayload, err := json.Marshal(map[string]string{"thread_key": threadKey})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	writeChunk("event: ready\ndata: " + string(readyPayload) + "\n\n")

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			writeChunk(": ping\n\n")
		}
	}
}

func ThreadTokenBreakdown(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	tid := c.Param("threadId")
	traceGraphService := service.NewTraceGraphService(db)
	body, err := traceGraphService.ThreadTokenBreakdown(tid)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ThreadTurns(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	tid := c.Param("threadId")
	if u, err := url.PathUnescape(tid); err == nil {
		tid = u
	}
	traceGraphService := service.NewTraceGraphService(db)
	body, err := traceGraphService.ThreadTurnsTree(tid)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ThreadTraceGraph(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	tid := c.Param("threadId")
	if u, err := url.PathUnescape(tid); err == nil {
		tid = u
	}
	maxN := 0
	if v := strings.TrimSpace(c.Query("max_nodes")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxN = n
		}
	}
	traceGraphService := service.NewTraceGraphService(db)
	body, err := traceGraphService.ThreadTraceGraph(tid, maxN)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ThreadExecutionGraph(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	tid := c.Param("threadId")
	if u, err := url.PathUnescape(tid); err == nil {
		tid = u
	}
	maxN := 0
	if v := strings.TrimSpace(c.Query("max_nodes")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxN = n
		}
	}
	traceGraphService := service.NewTraceGraphService(db)
	body, err := traceGraphService.ConversationExecutionGraph(tid, maxN)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func TraceExecutionGraph(c *gin.Context, req *TraceExecGraphRequest) {
	if req == nil || strings.TrimSpace(req.TraceID) == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("trace_id", "required"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	maxN := 0
	if v := strings.TrimSpace(req.MaxNodes); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxN = n
		}
	}
	traceGraphService := service.NewTraceGraphService(db)
	body, err := traceGraphService.TraceExecutionGraph(req.TraceID, maxN)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ObserveFacets(c *gin.Context, req *ObserveFacetsRequest) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	var ws *string
	if req != nil {
		v := strings.TrimSpace(req.WorkspaceName)
		if v != "" {
			ws = &v
		}
	}
	traceGraphService := service.NewTraceGraphService(db)
	body, err := traceGraphService.ObserveFacets(ws)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func SessionTraceRoot(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	sessionID := strings.TrimSpace(c.Param("id"))
	if sessionID == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("id", "required"))
		return
	}
	traceSessionService := service.NewTraceSessionService(db)
	traceID, err := traceSessionService.ResolveSessionTraceRoot(sessionID)
	if err == sql.ErrNoRows || strings.TrimSpace(traceID) == "" {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/NotFound"))
		return
	}
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"trace_root_id": traceID})
}

func SessionDelete(c *gin.Context) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable, ensure MustInit completed"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	sessionID := strings.TrimSpace(c.Param("id"))
	if sessionID == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("id", "required"))
		return
	}
	traceSessionService := service.NewTraceSessionService(db)
	deleted, err := traceSessionService.DeleteSession(sessionID)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"ok": true, "deleted": deleted})
}

func ShellSummary(c *gin.Context, req *ShellExecSummaryRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	traceShellService := service.NewTraceShellService(db)
	body, err := traceShellService.Summary(service.ShellSummaryQuery{
		SinceMs:         req.SinceMs,
		UntilMs:         req.UntilMs,
		TraceID:         req.TraceID,
		Channel:         req.Channel,
		Agent:           req.Agent,
		CommandContains: req.CommandContains,
		WorkspaceName:   req.WorkspaceName,
		MinDurationMs:   req.MinDurationMs,
		MaxDurationMs:   req.MaxDurationMs,
	})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ShellList(c *gin.Context, req *ShellExecListRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	if order != "asc" && order != "desc" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("order", "must be asc|desc"))
		return
	}
	traceShellService := service.NewTraceShellService(db)
	body, err := traceShellService.List(service.ShellListQuery{
		SinceMs:         req.SinceMs,
		UntilMs:         req.UntilMs,
		TraceID:         req.TraceID,
		Channel:         req.Channel,
		Agent:           req.Agent,
		CommandContains: req.CommandContains,
		WorkspaceName:   req.WorkspaceName,
		MinDurationMs:   req.MinDurationMs,
		MaxDurationMs:   req.MaxDurationMs,
		Limit:           req.Limit,
		Offset:          req.Offset,
		Order:           order,
	})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ShellDetail(c *gin.Context, req *ShellExecDetailRequest) {
	if req == nil || strings.TrimSpace(req.SpanID) == "" || resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("span_id", "required"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	traceShellService := service.NewTraceShellService(db)
	row, err := traceShellService.Detail(req.SpanID)
	if err != nil || row == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/NotFound"))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, row)
}

func ShellReplay(c *gin.Context, req *ShellExecReplayRequest) {
	if req == nil || strings.TrimSpace(req.TraceID) == "" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("trace_id", "required"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	traceShellService := service.NewTraceShellService(db)
	items, err := traceShellService.Replay(req.TraceID)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	if items == nil {
		items = []model.ShellReplayItem{}
	}
	AbortWithResultAndStatus(c, http.StatusOK, map[string]interface{}{"trace_id": strings.TrimSpace(req.TraceID), "items": items})
}

func ResourceAuditEvents(c *gin.Context, req *ResourceAuditEventsRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order != "" && order != "asc" && order != "desc" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("order", "must be asc|desc"))
		return
	}
	traceAuditService := service.NewTraceAuditService(db)
	body, err := traceAuditService.ResourceAuditEvents(service.ResourceAuditEventsQuery{
		Limit:         req.Limit,
		Offset:        req.Offset,
		Order:         order,
		SinceMs:       req.SinceMs,
		UntilMs:       req.UntilMs,
		Search:        req.Search,
		URIPrefix:     req.URIPrefix,
		TraceID:       req.TraceID,
		SpanID:        req.SpanID,
		HintType:      req.HintType,
		PolicyID:      req.PolicyID,
		SpanName:      req.SpanName,
		WorkspaceName: req.WorkspaceName,
		SortMode:      req.SortMode,
		SemanticClass: req.SemanticClass,
	})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func ResourceAuditStats(c *gin.Context, req *ResourceAuditStatsRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	traceAuditService := service.NewTraceAuditService(db)
	body, err := traceAuditService.ResourceAuditStats(service.ResourceAuditStatsQuery{
		SinceMs:       req.SinceMs,
		UntilMs:       req.UntilMs,
		Search:        req.Search,
		URIPrefix:     req.URIPrefix,
		TraceID:       req.TraceID,
		SpanID:        req.SpanID,
		HintType:      req.HintType,
		PolicyID:      req.PolicyID,
		WorkspaceName: req.WorkspaceName,
		SemanticClass: req.SemanticClass,
	})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func SecurityAuditEvents(c *gin.Context, req *SecurityAuditEventsRequest) {
	if req == nil {
		AbortWithWriteErrorResponse(c, errors.FormatError("Common/ParamsError"))
		return
	}
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order != "" && order != "asc" && order != "desc" {
		AbortWithWriteErrorResponse(c, errors.ParamFieldError("order", "must be asc|desc"))
		return
	}
	traceAuditService := service.NewTraceAuditService(db)
	body, err := traceAuditService.SecurityAuditEvents(service.SecurityAuditEventsQuery{
		Limit:         req.Limit,
		Offset:        req.Offset,
		Order:         order,
		SinceMs:       req.SinceMs,
		UntilMs:       req.UntilMs,
		TraceID:       req.TraceID,
		SpanID:        req.SpanID,
		PolicyID:      req.PolicyID,
		HintType:      req.HintType,
		WorkspaceName: req.WorkspaceName,
	})
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func SecurityAuditPolicyCounts(c *gin.Context, req *SecurityAuditPolicyCountsRequest) {
	if resource.DB == nil {
		AbortWithWriteErrorResponse(c, errors.InternalError("database unavailable"))
		return
	}
	db, err := resource.DB.DB()
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	traceAuditService := service.NewTraceAuditService(db)
	workspaceName := ""
	if req != nil {
		workspaceName = req.WorkspaceName
	}
	body, err := traceAuditService.SecurityAuditPolicyCounts(workspaceName)
	if err != nil {
		AbortWithWriteErrorResponse(c, errors.InternalError(err.Error()))
		return
	}
	AbortWithResultAndStatus(c, http.StatusOK, body)
}

func parseEpochMs(v string) *int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n <= 0 {
		return nil
	}
	return &n
}

func strPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

func clampIntDefault(v, def, min, max int) int {
	if v < min {
		v = def
	}
	if v > max {
		v = max
	}
	return v
}

func parseIntDefault(v string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return n
}
