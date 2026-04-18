/**
 * Collector HTTP paths — 以 `iseeagentc/controller/router/router_trace.go` 为准。
 * SSE：`GET /v1/traces/:traceRootId/stream`（见 `streamUrl` in `@/lib/collector.ts`；非 JSON，不走 `readCollectorFetchResult`）。
 * JSON 响应：仅接受 Go 信封，用 `readCollectorFetchResult` / `readCollectorHealthResult` 解包。
 */
export const COLLECTOR_API = {
  conversationList: "/v1/conversation/list",
  traceList: "/v1/trace/list",
  /** Same handler as {@link COLLECTOR_API.traceList}; for clients migrating from `/v1/traces/agent`. */
  conversationTraces: "/v1/conversation/traces",
  traceSpans: "/v1/trace/spans",
  spanList: "/v1/span/list",
  resourceAuditEvents: "/v1/resource-audit/events",
  resourceAuditStats: "/v1/resource-audit/stats",
  securityAuditEvents: "/v1/security-audit/events",
  securityAuditPolicyEventCounts: "/v1/security-audit/policy-event-counts",
  shellExecSummary: "/v1/shell-exec/summary",
  shellExecList: "/v1/shell-exec/list",
  shellExecDetail: "/v1/shell-exec/detail",
} as const;

/** React Query cache key prefixes (not URLs; aligned with {@link COLLECTOR_API}). */
export const COLLECTOR_QUERY_SCOPE = {
  conversationList: "conversation-list",
  traceList: "trace-list",
  traceGraph: "trace-graph",
  executionGraph: "execution-graph",
  traceSpans: "trace-spans",
  spanList: "span-list",
  threadTokenBreakdown: "thread-token-breakdown",
  resourceAuditEvents: "resource-audit-events",
  resourceAuditStats: "resource-audit-stats",
  securityAuditEvents: "security-audit-events",
  securityAuditPolicyEventCounts: "security-audit-policy-event-counts",
  shellExecSummary: "shell-exec-summary",
  shellExecList: "shell-exec-list",
  shellExecDetail: "shell-exec-detail",
} as const;

/** `GET /v1/conversation/:threadId/trace-graph` — encode thread id for path segment. */
export function conversationTraceGraphPath(threadId: string): string {
  const id = threadId.trim();
  return `/v1/conversation/${encodeURIComponent(id)}/trace-graph`;
}

/** `GET /v1/conversation/:threadId/execution-graph` — span-level graph + trace headers. */
export function conversationExecutionGraphPath(threadId: string): string {
  const id = threadId.trim();
  return `/v1/conversation/${encodeURIComponent(id)}/execution-graph`;
}

/** `GET /v1/conversation/:threadId/token-breakdown` — LLM span usage 聚合（prompt/completion/cache）。 */
export function conversationThreadTokenBreakdownPath(threadId: string): string {
  const id = threadId.trim();
  return `/v1/conversation/${encodeURIComponent(id)}/token-breakdown`;
}

/** `GET /v1/trace/execution-graph?trace_id=` */
export function traceExecutionGraphPath(): string {
  return `/v1/trace/execution-graph`;
}
