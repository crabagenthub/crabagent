import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { openDatabase } from "./db.js";
import { sseSubscribe } from "./sse-hub.js";
import { querySemanticSpansByTraceId } from "./semantic-spans-query.js";
import { queryTraceMessages } from "./trace-messages-query.js";
import { parseObserveListStatus } from "./observe-list-filters.js";
import { countSpanRecords, querySpanRecords } from "./span-records-query.js";
import { countThreadRecords, queryThreadRecords } from "./thread-records-query.js";
import { queryThreadTraceEvents } from "./thread-trace-events-query.js";
import { countTraceRecords, queryTraceRecords } from "./trace-records-query.js";
import { queryObserveFacets } from "./observe-facets-query.js";
import { applyOpikBatch } from "./opik-batch-ingest.js";

const PORT = Number(process.env.CRABAGENT_PORT ?? "8787");
const API_KEY = process.env.CRABAGENT_API_KEY?.trim() ?? "";
const collectorPackageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = path.join(collectorPackageRoot, "data", "crabagent.db");
const DB_PATH = process.env.CRABAGENT_DB_PATH?.trim() || defaultDbPath;
const DB_PATH_LOG = path.resolve(DB_PATH);

const db = openDatabase(DB_PATH);

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

function parseObserveListSort(raw: string | undefined): "time" | "tokens" {
  const s = String(raw ?? "time").trim().toLowerCase();
  return s === "tokens" ? "tokens" : "time";
}

function checkApiKey(c: KeyCtx): boolean {
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

app.get("/health", (c) => c.json({ ok: true, service: "crabagent-collector" }));

function summarizeOpikBatchForDebug(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { parse: "invalid_body" };
  }
  const b = body as Record<string, unknown>;
  const traces = Array.isArray(b.traces) ? b.traces : [];
  const threads = Array.isArray(b.threads) ? b.threads : [];
  const spans = Array.isArray(b.spans) ? b.spans : [];
  const traceSample = traces.slice(0, 6).map((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      return {};
    }
    const tr = t as Record<string, unknown>;
    const input = tr.input && typeof tr.input === "object" && !Array.isArray(tr.input) ? (tr.input as Record<string, unknown>) : {};
    const openclaw = input.openclaw && typeof input.openclaw === "object" && !Array.isArray(input.openclaw) ? (input.openclaw as Record<string, unknown>) : {};
    const meta =
      tr.metadata && typeof tr.metadata === "object" && !Array.isArray(tr.metadata) ? (tr.metadata as Record<string, unknown>) : {};
    return {
      trace_id_head: String(tr.trace_id ?? "").slice(0, 16),
      name: tr.name,
      agentId: openclaw.agentId,
      created_from: tr.created_from,
      metaKeys: Object.keys(meta).slice(0, 8),
    };
  });
  const threadSample = threads.slice(0, 4).map((th) => {
    if (!th || typeof th !== "object" || Array.isArray(th)) {
      return {};
    }
    const r = th as Record<string, unknown>;
    return {
      thread_id_head: String(r.thread_id ?? "").slice(0, 32),
      agent_name: r.agent_name,
      channel_name: r.channel_name,
    };
  });
  return {
    traceCount: traces.length,
    threadCount: threads.length,
    spanCount: spans.length,
    traceSample,
    threadSample,
  };
}

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
  // #region agent log
  fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "24bc8e" },
    body: JSON.stringify({
      sessionId: "24bc8e",
      hypothesisId: "H1,H2,H5",
      location: "collector/index.ts:POST /v1/opik/batch",
      message: "ingest apply result",
      data: {
        accepted: result.accepted,
        skippedN: result.skipped.length,
        skippedHead: result.skipped.slice(0, 6),
        batchSummary: summarizeOpikBatchForDebug(body),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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
  const items = querySemanticSpansByTraceId(db, tid);
  return c.json({ trace_id: tid, items });
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
  const sinceRaw = Number(c.req.query("since_ms") ?? "");
  const sinceMs =
    Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : undefined;
  const untilRaw = Number(c.req.query("until_ms") ?? "");
  const untilMs =
    Number.isFinite(untilRaw) && untilRaw > 0 ? Math.floor(untilRaw) : undefined;

  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const listStatus = parseObserveListStatus(optionalQueryString(c, "status"));

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
    listStatus,
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
  const sinceRaw = Number(c.req.query("since_ms") ?? "");
  const sinceMs =
    Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : undefined;
  const untilRaw = Number(c.req.query("until_ms") ?? "");
  const untilMs =
    Number.isFinite(untilRaw) && untilRaw > 0 ? Math.floor(untilRaw) : undefined;

  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");

  const listQuery = { limit, offset, order, sort, search, sinceMs, untilMs, channel, agent };
  const items = queryThreadRecords(db, listQuery);
  const total = countThreadRecords(db, listQuery);
  return c.json({ items, total });
};

app.get("/v1/conversation/list", handleThreadRecords);
/** @deprecated Use `GET /v1/conversation/list` */
app.get("/v1/thread-records", handleThreadRecords);

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
  const sinceRaw = Number(c.req.query("since_ms") ?? "");
  const sinceMs =
    Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : undefined;
  const untilRaw = Number(c.req.query("until_ms") ?? "");
  const untilMs =
    Number.isFinite(untilRaw) && untilRaw > 0 ? Math.floor(untilRaw) : undefined;

  const channel = optionalQueryString(c, "channel");
  const agent = optionalQueryString(c, "agent");
  const listStatus = parseObserveListStatus(optionalQueryString(c, "status"));

  const listQuery = { limit, offset, order, sort, search, sinceMs, untilMs, channel, agent, listStatus };
  const items = querySpanRecords(db, listQuery);
  const total = countSpanRecords(db, listQuery);
  return c.json({ items, total });
};

app.get("/v1/span/list", handleSpanRecords);
/** @deprecated Use `GET /v1/span/list` */
app.get("/v1/span-records", handleSpanRecords);

app.get("/v1/observe-facets", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const facets = queryObserveFacets(db);
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

console.log(
  `[crabagent-collector] listening on http://127.0.0.1:${PORT} db=${DB_PATH_LOG} auth=${API_KEY ? "on" : "off"}`,
);

serve({ fetch: app.fetch, port: PORT });
