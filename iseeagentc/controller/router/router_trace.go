package router

import (
	"github.com/gin-gonic/gin"

	"iseeagentc/controller"
)

// RegisterTrace 注册 trace 相关路由（统一走 gin controller）。
func RegisterTrace(r *gin.Engine) {
	traceV1 := r.Group("/v1")
	{

		traceV1.GET("/policies", GetTypedHandler(controller.PoliciesList))
		traceV1.GET("/trace/list", GetTypedHandler(controller.TraceList))

		traceV1.POST("/policies", controller.PoliciesUpsert)
		traceV1.DELETE("/policies/:id", controller.PoliciesDelete)
		traceV1.POST("/policies/pull-report", controller.PoliciesPullReport)
		traceV1.POST("/opik/batch", controller.OpikBatch)
		traceV1.POST("/ingest", controller.IngestGone)

		traceV1.GET("/traces", controller.TracesLegacy)
		traceV1.GET("/trace-messages", GetTypedHandler(controller.TraceMessages))

		traceV1.GET("/conversation/traces", GetTypedHandler(controller.TraceList))
		traceV1.GET("/trace-records", GetTypedHandler(controller.TraceList))
		traceV1.GET("/traces/agent", GetTypedHandler(controller.TraceList))
		traceV1.GET("/conversation/list", GetTypedHandler(controller.ThreadList))
		traceV1.GET("/thread-records", GetTypedHandler(controller.ThreadList))
		traceV1.GET("/span/list", GetTypedHandler(controller.SpanList))
		traceV1.GET("/span-records", GetTypedHandler(controller.SpanList))
		traceV1.GET("/trace/spans", GetTypedHandler(controller.TraceSpans))
		traceV1.GET("/semantic-spans", GetTypedHandler(controller.TraceSpans))
		traceV1.GET("/traces/:traceRootId/stream", controller.ThreadTraceStream)
		traceV1.GET("/traces/:traceRootId/events", controller.ThreadTraceEvents)
		traceV1.GET("/conversation/:threadId/token-breakdown", controller.ThreadTokenBreakdown)
		traceV1.GET("/conversation/:threadId/turns", controller.ThreadTurns)
		traceV1.GET("/conversation/:threadId/trace-graph", controller.ThreadTraceGraph)
		traceV1.GET("/conversation/:threadId/execution-graph", controller.ThreadExecutionGraph)
		traceV1.GET("/trace/execution-graph", GetTypedHandler(controller.TraceExecutionGraph))
		traceV1.GET("/sessions/:id/trace-root", controller.SessionTraceRoot)
		traceV1.DELETE("/sessions/:id", controller.SessionDelete)

		traceV1.GET("/shell-exec/summary", GetTypedHandler(controller.ShellSummary))
		traceV1.GET("/shell-exec/list", GetTypedHandler(controller.ShellList))
		traceV1.GET("/shell-exec/detail", GetTypedHandler(controller.ShellDetail))
		traceV1.GET("/shell-exec/replay", GetTypedHandler(controller.ShellReplay))
		traceV1.GET("/resource-audit/events", GetTypedHandler(controller.ResourceAuditEvents))
		traceV1.GET("/resource-audit/stats", GetTypedHandler(controller.ResourceAuditStats))
		traceV1.GET("/security-audit/events", GetTypedHandler(controller.SecurityAuditEvents))
		traceV1.GET("/security-audit/policy-event-counts", GetTypedHandler(controller.SecurityAuditPolicyCounts))
		traceV1.GET("/observe-facets", GetTypedHandler(controller.ObserveFacets))

		traceV1.GET("/alert-rules", GetTypedHandler(controller.AlertRulesList))
		traceV1.GET("/alert-events", GetTypedHandler(controller.AlertRulesEventsList))
		traceV1.POST("/alert-rules", controller.AlertRulesUpsert)
		traceV1.DELETE("/alert-rules/:id", controller.AlertRulesDelete)
		traceV1.POST("/alert-rules/:id/test", controller.AlertRulesTest)
		traceV1.POST("/alert-rules/:id/evaluate", controller.AlertRulesEvaluate)
	}
}
