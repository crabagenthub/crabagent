import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { loadDeploymentConfig, validateDeploymentConfig } from "./deployment-mode.js";
import { runHealthProbes } from "./health-probes.js";
import { initializeRuntimeStorage } from "./storage-runtime.js";
import { sseSubscribe } from "./sse-hub.js";
import {
  querySemanticSpansByTraceId,
  queryTraceInputByTraceId,
  resolveCanonicalTraceIdForSpanQuery,
} from "./semantic-spans-query.js";
import { queryTraceMessages } from "./trace-messages-query.js";
import {
  parseObserveListStatusesFromSearchParams,
  parseObserveSpanListType,
} from "./observe-list-filters.js";
import {
  countResourceAuditEvents,
  queryResourceAuditEvents,
  queryResourceAuditStats,
  type ResourceAuditSemanticFilter,
} from "./resource-audit-query.js";
import {
  countSecurityAuditEvents,
  parseSecurityAuditListQuery,
  querySecurityAuditEvents,
  querySecurityAuditPolicyEventCounts,
} from "./security-audit-query.js";
import { countSpanRecords, querySpanRecords } from "./span-records-query.js";
import {
  queryShellExecDetail,
  queryShellExecList,
  queryShellExecSummary,
} from "./shell-exec-query.js";
import { countThreadRecords, queryThreadRecords } from "./thread-records-query.js";
import { queryThreadTraceEvents } from "./thread-trace-events-query.js";
import { queryConversationExecutionGraph, queryTraceExecutionGraph } from "./execution-graph-query.js";
import { queryThreadTraceGraph } from "./trace-graph-query.js";
import { queryThreadTokenBreakdown } from "./thread-token-breakdown-query.js";
import { queryThreadTurnsTree } from "./thread-turns-query.js";
import { countTraceRecords, queryTraceRecords } from "./trace-records-query.js";
import { queryObserveFacets } from "./observe-facets-query.js";
import { applyOpikBatch } from "./opik-batch-ingest.js";
import { queryAllPolicies, reportPoliciesPulled, upsertPolicy, deletePolicy } from "./policy-query.js";

const PORT = Number(process.env.CRABAGENT_PORT ?? "8787");
const API_KEY = process.env.CRABAGENT_API_KEY?.trim() ?? "";
const AUTH_BYPASS_LOCAL =
  ["1", "true", "yes"].includes((process.env.CRABAGENT_DISABLE_API_KEY_AUTH ?? "").trim().toLowerCase());
const collectorPackageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = path.join(collectorPackageRoot, "data", "crabagent.db");
const deployment = loadDeploymentConfig(defaultDbPath);
const deploymentErrors = validateDeploymentConfig(deployment);
if (deploymentErrors.length > 0) {
  throw new Error(
    `[crabagent-collector] invalid deployment config:\n- ${deploymentErrors.join("\n- ")}`,
  );
}
const storage = initializeRuntimeStorage(deployment);
const isSqlitePrimary = storage.primary.kind === "sqlite";
const db = isSqlitePrimary ? storage.primary.db : null;
const DB_PATH_LOG = storage.primary.locationLabel;

const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.CRABAGENT_CORS_ORIGIN?.trim() || "*",
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "Cache-Control"],
    exposeHeaders: ["Content-Type"],
  }),
);

type KeyCtx = {
  req: {
    header: (n: string) => string | undefined;
    query: (n: string) => string | undefined;
  };
};

function optionalQueryString(c: KeyCtx, key: string): string | undefined {
  const v = c.req.query(key);
  return typeof v === "string" ? v : undefined;
}

/** 缺省查询键勿用 `Number("")`，否则会得到 0 并误触发 `max_duration_ms <= 0` 等过滤。 */
function optionalNonNegativeIntQuery(c: KeyCtx, key: string): number | undefined {
  const raw = c.req.query(key);
  if (raw == null || String(raw).trim() === "") {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function parseEpochMs(raw: string | undefined): number | undefined {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return Math.floor(n);
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function resolveTimeRangeWithDefault(c: Context): { sinceMs?: number; untilMs?: number } {
  const sinceMs = parseEpochMs(c.req.query("since_ms"));
  const untilMs = parseEpochMs(c.req.query("until_ms"));
  const now = Date.now();
  const maxWindowMs = Math.min(
    parsePositiveIntEnv("CRABAGENT_MAX_TIME_WINDOW_MS", 30 * 24 * 60 * 60 * 1000),
    365 * 24 * 60 * 60 * 1000,
  );
  const defaultRange = {
    sinceMs: now - storage.capabilities.defaultTimeWindowMs,
    untilMs: now,
  };
  const out = sinceMs != null || untilMs != null ? { sinceMs, untilMs } : defaultRange;
  const s = out.sinceMs;
  const u = out.untilMs;
  if (s != null && u != null && u > 0 && s > 0 && u - s > maxWindowMs) {
    return { sinceMs: u - maxWindowMs, untilMs: u };
  }
  return out;
}

function parseObserveListSort(raw: string | undefined): "time" | "tokens" {
  const s = String(raw ?? "time").trim().toLowerCase();
  return s === "tokens" ? "tokens" : "time";
}

function checkApiKey(c: KeyCtx): boolean {
  if (AUTH_BYPASS_LOCAL) {
    return true;
  }
  if (!API_KEY) {
    return true;
  }
  const auth = c.req.header("authorization");
  const bearer =
    auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
  const headerKey = bearer || c.req.header("x-api-key");
  if (headerKey === API_KEY) {
    return true;
  }
  const q = c.req.query("token")?.trim() || c.req.query("api_key")?.trim();
  return q === API_KEY;
}

app.get("/health", async (c) => {
  const probes =
    deployment.mode === "enterprise"
      ? await runHealthProbes({
          pgUrl: deployment.primary.pgUrl,
          clickhouseUrl: deployment.analytics.clickhouseUrl,
        })
      : {};
  return c.json({
    ok: true,
    service: "crabagent-collector",
    deployment_mode: deployment.mode,
    primary_db: storage.primary.kind,
    primary_ready: storage.primary.ready,
    primary_message: storage.primary.message,
    analytics_db: storage.analytics.kind,
    analytics_ready: storage.analytics.ready,
    analytics_message: storage.analytics.message,
    default_time_window_ms: storage.capabilities.defaultTimeWindowMs,
    max_time_window_ms: Math.min(
      parsePositiveIntEnv("CRABAGENT_MAX_TIME_WINDOW_MS", 30 * 24 * 60 * 60 * 1000),
      365 * 24 * 60 * 60 * 1000,
    ),
    probes,
  });
});

if (!isSqlitePrimary || db == null) {
  app.all("/v1/*", (c) =>
    c.json(
      {
        error: "not_implemented",
        hint: "Enterprise mode is not fully implemented yet; only /health is available for now.",
        deployment_mode: deployment.mode,
        primary_db: storage.primary.kind,
        analytics_db: storage.analytics.kind,
      },
      501,
    ),
  );
} else {
/** Interception policies CRUD */
app.get("/v1/policies", (c) => {
  if (!checkApiKey(c)) return c.json({ error: "unauthorized" }, 401);
  const workspaceName = optionalQueryString(c, "workspace_name")?.trim() || "OpenClaw";
  return c.json(queryAllPolicies(db, workspaceName));
});

app.post("/v1/policies", async (c) => {
  if (!checkApiKey(c)) return c.json({ error: "unauthorized" }, 401);
  try {
    const body = await c.req.json();
    const workspaceName = optionalQueryString(c, "workspace_name")?.trim() || "OpenClaw";
    const res = upsertPolicy(db, body, workspaceName);
    return c.json(res);
  } catch (err) {
    console.error(`[collector] POST /v1/policies failed:`, err);
    return c.json({ error: String(err) }, 500);
  }
});

app.delete("/v1/policies/:id", (c) => {
  if (!checkApiKey(c)) return c.json({ error: "unauthorized" }, 401);
  const id = c.req.param("id");
  const workspaceName = optionalQueryString(c, "workspace_name")?.trim() || "OpenClaw";
  deletePolicy(db, id, workspaceName);
  return c.json({ ok: true });
});

/**
 * OpenClaw 插件在定时 `GET /v1/policies` 拉取成功后上报，用于列表「拉取时间」列（非 Web 刷新时间）。
 * Body: `{ "pulled_at_ms"?: number }`，缺省为服务端当前时间。
 */
app.post("/v1/policies/pull-report", async (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let pulledRaw: unknown;
  try {
    const body = (await c.req.json()) as { pulled_at_ms?: unknown };
    pulledRaw = body?.pulled_at_ms;
  } catch {
    pulledRaw = undefined;
  }
  const pulledAtMs =
    typeof pulledRaw === "number" && Number.isFinite(pulledRaw) && pulledRaw > 0
      ? Math.floor(pulledRaw)
      : Date.now();
  const workspaceName = optionalQueryString(c, "workspace_name")?.trim() || "OpenClaw";
  const { updated } = reportPoliciesPulled(db, pulledAtMs, workspaceName);
  return c.json({ ok: true, updated, pulled_at_ms: pulledAtMs });
});

/** opik-openclaw 插件落库（与 `opik-batch-ingest` 一致）。 */
app.post("/v1/opik/batch", async (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const result = applyOpikBatch(db, body);
  if (process.env.CRABAGENT_INGEST_LOG?.trim() === "1") {
    console.info(
      `[crabagent-collector] POST /v1/opik/batch accepted threads=${result.accepted.threads} traces=${result.accepted.traces} spans=${result.accepted.spans} skipped=${result.skipped.length}`,
    );
  }
  return c.json({ ok: true, ...result });
});

/** @deprecated 旧 `/v1/ingest` 已移除；请使用 `POST /v1/opik/batch`。 */
app.post("/v1/ingest", (c) =>
  c.json(
    {
      error: "gone",
      hint: "Use POST /v1/opik/batch with opik-openclaw shaped JSON (threads, traces, spans, …).",
    },
    410,
  ),
);

/** 按 thread 聚合的最近活动（来自 `opik_traces`）。 */
app.get("/v1/traces", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 200);
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) AS thread_key,
              trace_id AS trace_root_id,
              NULL AS event_id,
              NULL AS session_id,
              NULL AS session_key,
              NULL AS agent_id,
              NULL AS agent_name,
              'opik_trace' AS type,
              datetime(created_at_ms / 1000, 'unixepoch') AS created_at,
              1 AS event_count,
              NULL AS channel,
              name AS chat_title
       FROM opik_traces
       ORDER BY created_at_ms DESC
       LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return c.json({ items: rows });
});

app.get("/v1/trace-messages", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const orderRaw = String(c.req.query("order") ?? "desc").toLowerCase();
  const order = orderRaw === "asc" ? "asc" : "desc";
  const rawSearch = c.req.query("search");
  const search = typeof rawSearch === "string" ? rawSearch : undefined;
  const items = queryTraceMessages(db, { limit, offset, order, search });
  return c.json({ items });
});

/** `GET /v1/trace/spans?trace_id=` — semantic spans for one trace. */
const handleTraceSpans = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const rawTid = c.req.query("trace_id");
  const tid = typeof rawTid === "string" ? rawTid.trim() : "";
  if (!tid) {
    return c.json({ error: "missing trace_id" }, 400);
  }
  const resolvedTraceId = resolveCanonicalTraceIdForSpanQuery(db, tid);
  const items = querySemanticSpansByTraceId(db, resolvedTraceId);
  const trace_input = queryTraceInputByTraceId(db, resolvedTraceId);
  return c.json({ trace_id: resolvedTraceId, items, trace_input });
};

app.get("/v1/trace/spans", handleTraceSpans);
/** @deprecated Use `GET /v1/trace/spans` */
app.get("/v1/semantic-spans", handleTraceSpans);

/** Observe list: one row per trace / conversation turn (opik_traces aggregate). */
const handleConversationTraces = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const orderRaw = String(c.req.query("order") ?? "desc").toLowerCase();
  const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  const sort = parseObserveListSort(c.req.query("sort"));
  const minTotalTokens = Number(c.req.query("min_total_tokens") ?? "");
  const minLoopCount = Number(c.req.query("min_loop_count") ?? "");
  const minToolCalls = Number(c.req.query("min_tool_calls") ?? "");
  const rawSearch = c.req.query("search");
  const search = typeof rawSearch === "string" ? rawSearch : undefined;
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);

  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const workspaceName = optionalQueryString(c, "workspace_name");
  const listStatuses = parseObserveListStatusesFromSearchParams(new URL(c.req.url, "http://127.0.0.1").searchParams);

  const listQuery = {
    limit,
    offset,
    order,
    sort,
    minTotalTokens: Number.isFinite(minTotalTokens) && minTotalTokens > 0 ? minTotalTokens : undefined,
    minLoopCount: Number.isFinite(minLoopCount) && minLoopCount > 0 ? minLoopCount : undefined,
    minToolCalls: Number.isFinite(minToolCalls) && minToolCalls > 0 ? minToolCalls : undefined,
    search,
    sinceMs,
    untilMs,
    channel,
    agent,
    workspaceName: workspaceName?.trim() || undefined,
    listStatuses,
  };

  const items = queryTraceRecords(db, listQuery);
  const total = countTraceRecords(db, listQuery);

  return c.json({ items, total });
};

/** Observe trace list（每 trace 一行）。主路径：`GET /v1/trace/list`。 */
app.get("/v1/trace/list", handleConversationTraces);
/** 与 `/v1/trace/list` 同一处理逻辑（兼容自 `GET /v1/traces/agent` 迁移）。 */
app.get("/v1/conversation/traces", handleConversationTraces);
/** @deprecated Use `GET /v1/trace/list` */
app.get("/v1/trace-records", handleConversationTraces);

const handleThreadRecords = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const orderRaw = String(c.req.query("order") ?? "desc").toLowerCase();
  const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  const sort = parseObserveListSort(c.req.query("sort"));
  const rawSearch = c.req.query("search");
  const search = typeof rawSearch === "string" ? rawSearch : undefined;
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);

  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const workspaceName = optionalQueryString(c, "workspace_name");

  const listQuery = {
    limit,
    offset,
    order,
    sort,
    search,
    sinceMs,
    untilMs,
    channel,
    agent,
    workspaceName: workspaceName?.trim() || undefined,
  };
  const items = queryThreadRecords(db, listQuery);
  const total = countThreadRecords(db, listQuery);
  return c.json({ items, total });
};

app.get("/v1/conversation/list", handleThreadRecords);
/** @deprecated Use `GET /v1/conversation/list` */
app.get("/v1/thread-records", handleThreadRecords);

/** 会话下 LLM span 的 usage 聚合（prompt / completion / cache_read / total），与 `parseUsageExtended` 一致。 */
app.get("/v1/conversation/:threadId/token-breakdown", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let threadId = c.req.param("threadId") ?? "";
  try {
    threadId = decodeURIComponent(threadId);
  } catch {
    /* keep raw */
  }
  const body = queryThreadTokenBreakdown(db, threadId);
  return c.json(body);
});

/** Thread turn tree from `opik_traces`（metadata `parent_turn_id` + `trace_type`）与 `opik_threads` 会话树。 */
app.get("/v1/conversation/:threadId/turns", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let threadId = c.req.param("threadId") ?? "";
  try {
    threadId = decodeURIComponent(threadId);
  } catch {
    /* keep raw */
  }
  const { thread_id, items } = queryThreadTurnsTree(db, threadId);
  return c.json({ thread_id, items });
});

/** Trace 调用图（React Flow）：合并会话范围内 traces，metadata `parent_turn_id` → edges。Query: `max_nodes`（默认 80，上限 200）。 */
app.get("/v1/conversation/:threadId/trace-graph", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let threadId = c.req.param("threadId") ?? "";
  try {
    threadId = decodeURIComponent(threadId);
  } catch {
    /* keep raw */
  }
  const rawMax = Number(c.req.query("max_nodes") ?? "");
  const maxNodes = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : undefined;
  const body = queryThreadTraceGraph(db, threadId, { maxNodes });
  return c.json(body);
});

/** Span-level execution graph (LLM / tool / skill / memory / …) + trace headers; cross-trace edges from metadata.parent_turn_id. */
app.get("/v1/conversation/:threadId/execution-graph", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let threadId = c.req.param("threadId") ?? "";
  try {
    threadId = decodeURIComponent(threadId);
  } catch {
    /* keep raw */
  }
  const rawMax = Number(c.req.query("max_nodes") ?? "");
  const maxNodes = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : undefined;
  const body = queryConversationExecutionGraph(db, threadId, { maxNodes });
  return c.json(body);
});

/** Single-trace execution graph for message detail (`trace_id` query). */
app.get("/v1/trace/execution-graph", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const traceId = optionalQueryString(c, "trace_id")?.trim() ?? "";
  if (!traceId) {
    return c.json({ error: "trace_id required" }, 400);
  }
  const rawMax = Number(c.req.query("max_nodes") ?? "");
  const maxNodes = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : undefined;
  const body = queryTraceExecutionGraph(db, traceId, { maxNodes });
  return c.json(body);
});

const handleSpanRecords = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const orderRaw = String(c.req.query("order") ?? "desc").toLowerCase();
  const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  const sort = parseObserveListSort(c.req.query("sort"));
  const rawSearch = c.req.query("search");
  const search = typeof rawSearch === "string" ? rawSearch : undefined;
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);

  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const workspaceName = optionalQueryString(c, "workspace_name");
  const spanType = parseObserveSpanListType(optionalQueryString(c, "span_type"));
  const listStatuses = parseObserveListStatusesFromSearchParams(new URL(c.req.url, "http://127.0.0.1").searchParams);

  const listQuery = {
    limit,
    offset,
    order,
    sort,
    search,
    sinceMs,
    untilMs,
    channel,
    agent,
    workspaceName: workspaceName?.trim() || undefined,
    spanType,
    listStatuses,
  };
  const items = querySpanRecords(db, listQuery);
  const total = countSpanRecords(db, listQuery);
  return c.json({ items, total });
};

app.get("/v1/span/list", handleSpanRecords);
/** @deprecated Use `GET /v1/span/list` */
app.get("/v1/span-records", handleSpanRecords);

const handleShellExecSummary = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);
  const traceId = optionalQueryString(c, "trace_id");
  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const commandContains = optionalQueryString(c, "command_contains");
  const workspaceName = optionalQueryString(c, "workspace_name");
  const minDurationMs = optionalNonNegativeIntQuery(c, "min_duration_ms");
  const maxDurationMs = optionalNonNegativeIntQuery(c, "max_duration_ms");
  const body = queryShellExecSummary(
    db,
    {
      sinceMs,
      untilMs,
      traceId: traceId?.trim() || undefined,
      channel,
      agent,
      commandContains,
      workspaceName: workspaceName?.trim() || undefined,
      minDurationMs,
      maxDurationMs,
    },
    path.basename(DB_PATH_LOG),
  );
  return c.json(body);
};

app.get("/v1/shell-exec/summary", handleShellExecSummary);

const handleShellExecList = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const orderRaw = String(c.req.query("order") ?? "desc").toLowerCase();
  const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);
  const traceId = optionalQueryString(c, "trace_id");
  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const commandContains = optionalQueryString(c, "command_contains");
  const workspaceName = optionalQueryString(c, "workspace_name");
  const minDurationMs = optionalNonNegativeIntQuery(c, "min_duration_ms");
  const maxDurationMs = optionalNonNegativeIntQuery(c, "max_duration_ms");
  const { items, total } = queryShellExecList(db, {
    limit,
    offset,
    order,
    sinceMs,
    untilMs,
    traceId: traceId?.trim() || undefined,
    channel,
    agent,
    commandContains,
    workspaceName: workspaceName?.trim() || undefined,
    minDurationMs,
    maxDurationMs,
  });
  return c.json({ items, total });
};

app.get("/v1/shell-exec/list", handleShellExecList);

app.get("/v1/shell-exec/detail", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const spanId = optionalQueryString(c, "span_id")?.trim() ?? "";
  if (!spanId) {
    return c.json({ error: "span_id required" }, 400);
  }
  const row = queryShellExecDetail(db, spanId);
  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(row);
});

function parseResourceAuditSemanticClass(raw: string | undefined): ResourceAuditSemanticFilter {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "file" || s === "memory" || s === "tool_io") {
    return s;
  }
  return "all";
}

const handleResourceAuditEvents = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const orderRaw = String(c.req.query("order") ?? "desc").toLowerCase();
  const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  const rawSearch = c.req.query("search");
  const search = typeof rawSearch === "string" ? rawSearch : undefined;
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);
  const semantic_class = parseResourceAuditSemanticClass(optionalQueryString(c, "semantic_class"));
  const uri_prefix = optionalQueryString(c, "uri_prefix");
  const trace_id = optionalQueryString(c, "trace_id");
  const span_id = optionalQueryString(c, "span_id");
  const hint_type = optionalQueryString(c, "hint_type");
  const policy_id = optionalQueryString(c, "policy_id");
  const span_name = optionalQueryString(c, "span_name");
  const workspace_name = optionalQueryString(c, "workspace_name");
  const sort_mode = optionalQueryString(c, "sort_mode");
  const normalizedSortMode: "time_desc" | "risk_first" | "chars_desc" =
    sort_mode === "risk_first" || sort_mode === "chars_desc" ? sort_mode : "time_desc";

  const listQuery = {
    limit,
    offset,
    order,
    search,
    sinceMs,
    untilMs,
    semantic_class,
    uri_prefix,
    workspace_name: workspace_name ?? undefined,
    trace_id: trace_id ?? undefined,
    span_id: span_id ?? undefined,
    hint_type: hint_type ?? undefined,
    policy_id: policy_id ?? undefined,
    span_name: span_name ?? undefined,
    sort_mode: normalizedSortMode,
  };
  const items = queryResourceAuditEvents(db, listQuery);
  const total = countResourceAuditEvents(db, listQuery);
  return c.json({ items, total });
};

const handleResourceAuditStats = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const rawSearch = c.req.query("search");
  const search = typeof rawSearch === "string" ? rawSearch : undefined;
  const { sinceMs, untilMs } = resolveTimeRangeWithDefault(c);
  const semantic_class = parseResourceAuditSemanticClass(optionalQueryString(c, "semantic_class"));
  const uri_prefix = optionalQueryString(c, "uri_prefix");
  const trace_id = optionalQueryString(c, "trace_id");
  const span_id = optionalQueryString(c, "span_id");
  const hint_type = optionalQueryString(c, "hint_type");
  const policy_id = optionalQueryString(c, "policy_id");
  const workspace_name = optionalQueryString(c, "workspace_name");

  const stats = queryResourceAuditStats(db, {
    search,
    sinceMs,
    untilMs,
    semantic_class,
    uri_prefix,
    workspace_name: workspace_name ?? undefined,
    trace_id: trace_id ?? undefined,
    span_id: span_id ?? undefined,
    hint_type: hint_type ?? undefined,
    policy_id: policy_id ?? undefined,
  });
  return c.json(stats);
};

app.get("/v1/resource-audit/events", handleResourceAuditEvents);
app.get("/v1/resource-audit/stats", handleResourceAuditStats);

const handleSecurityAuditEvents = (c: Context) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const q = parseSecurityAuditListQuery(c);
  const items = querySecurityAuditEvents(db, q);
  const total = countSecurityAuditEvents(db, q);
  return c.json({ items, total });
};

app.get("/v1/security-audit/events", handleSecurityAuditEvents);
app.get("/v1/security-audit/policy-event-counts", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const workspaceName = optionalQueryString(c, "workspace_name");
  return c.json({ items: querySecurityAuditPolicyEventCounts(db, workspaceName?.trim() || undefined) });
});

app.get("/v1/observe-facets", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const workspaceName = optionalQueryString(c, "workspace_name");
  const facets = queryObserveFacets(db, workspaceName?.trim() || undefined);
  return c.json(facets);
});

/** @deprecated Use `GET /v1/trace/list` or `GET /v1/conversation/traces`。须注册在 `/v1/traces/:traceRootId/events` 之前，否则 `agent` 会被当成 thread key。 */
app.get("/v1/traces/agent", handleConversationTraces);

/** 由 `opik_traces` 合成该 thread 下的时间线（兼容无 legacy events 表）。 */
app.get("/v1/traces/:traceRootId/events", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const raw = c.req.param("traceRootId") ?? "";
  let threadKey = raw;
  try {
    threadKey = decodeURIComponent(raw);
  } catch {
    threadKey = raw;
  }
  const items = queryThreadTraceEvents(db, threadKey);
  return c.json({ thread_key: threadKey, items });
});

app.get("/v1/sessions/:sessionId/trace-root", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({ error: "not_found" }, 404);
});

app.delete("/v1/sessions/:sessionId", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({ ok: true, deleted: 0 });
});

app.get("/v1/traces/:traceRootId/stream", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const threadKey = c.req.param("traceRootId");
  const signal = c.req.raw.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendRaw = (chunk: string) => {
        if (signal.aborted) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // closed
        }
      };

      const unsubscribe = sseSubscribe(threadKey, sendRaw);
      sendRaw(`event: ready\ndata: ${JSON.stringify({ thread_key: threadKey })}\n\n`);

      const ping = setInterval(() => {
        if (signal.aborted) {
          clearInterval(ping);
          return;
        }
        sendRaw(": ping\n\n");
      }, 15_000);

      signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
}

console.log(
  `[crabagent-collector] listening on http://127.0.0.1:${PORT} mode=${deployment.mode} primary=${deployment.primary.kind} analytics=${deployment.analytics.kind} db=${DB_PATH_LOG} auth=${AUTH_BYPASS_LOCAL ? "bypassed" : API_KEY ? "on" : "off"}`,
);

serve({ fetch: app.fetch, port: PORT });
