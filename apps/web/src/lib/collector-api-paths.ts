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
} as const;

/** React Query cache key prefixes (not URLs; aligned with {@link COLLECTOR_API}). */
export const COLLECTOR_QUERY_SCOPE = {
  conversationList: "conversation-list",
  traceList: "trace-list",
  traceSpans: "trace-spans",
  spanList: "span-list",
} as const;
