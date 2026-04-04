/**
 * Collector HTTP paths — keep in sync with `services/collector/src/index.ts`.
 * Use these for all `fetch` URLs so the network tab matches the server routes.
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
