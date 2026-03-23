import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { openDatabase } from "./db.js";
import { runIngestBatch } from "./ingest.js";
import { sseSubscribe } from "./sse-hub.js";
import { THREAD_KEY_SQL } from "./thread-key.js";

const PORT = Number(process.env.CRABAGENT_PORT ?? "8787");
const API_KEY = process.env.CRABAGENT_API_KEY?.trim() ?? "";
/** Always under `services/collector/data/` so clearing data does not depend on shell cwd. */
const collectorPackageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = path.join(collectorPackageRoot, "data", "crabagent.db");
const DB_PATH = process.env.CRABAGENT_DB_PATH?.trim() || defaultDbPath;
const DB_PATH_LOG = path.resolve(DB_PATH);

const db = openDatabase(DB_PATH);
const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO events (
     event_id, trace_root_id, session_id, session_key, agent_id, run_id, channel,
     type, payload_json, schema_version, client_ts
   ) VALUES (
     @event_id, @trace_root_id, @session_id, @session_key, @agent_id, @run_id, @channel,
     @type, @payload_json, @schema_version, @client_ts
   )`,
);

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

app.post("/v1/ingest", async (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "expected_object" }, 400);
  }
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0) {
    return c.json({ error: "expected_non_empty_events_array" }, 400);
  }

  const { accepted, skipped } = runIngestBatch({ insertStmt, events });
  return c.json({ ok: true, accepted, skipped, total: events.length });
});

app.get("/v1/traces", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 200);
  /**
   * One row per **conversation thread** (session_key → session_id → trace_root_id), not per internal
   * trace_root UUID — matches personal-user mental model ("one chat") and dev view of a session.
   */
  const rows = db
    .prepare(
      `WITH per_event AS (
         SELECT id, event_id, trace_root_id, session_id, session_key, agent_id, type, created_at, channel, payload_json,
                (${THREAD_KEY_SQL}) AS thread_key
         FROM events
         WHERE (${THREAD_KEY_SQL}) IS NOT NULL
       ),
       agg AS (
         SELECT thread_key, MAX(id) AS max_id, COUNT(*) AS event_count
         FROM per_event
         GROUP BY thread_key
       ),
       ranked AS (
         SELECT thread_key, max_id, event_count
         FROM agg
         ORDER BY max_id DESC
         LIMIT ?
       )
       SELECT e.thread_key,
              e.event_id,
              e.trace_root_id,
              e.session_id,
              e.session_key,
              e.agent_id,
              e.type,
              e.created_at,
              r.event_count,
              NULLIF(
                TRIM(COALESCE(e.channel, json_extract(e.payload_json, '$.channel'))),
                ''
              ) AS channel
       FROM ranked r
       JOIN per_event e ON e.id = r.max_id
       ORDER BY e.id DESC`,
    )
    .all(limit) as Record<string, unknown>[];
  return c.json({ items: rows });
});

/** Path param is **thread_key** (URL-encoded): all events in that conversation, any trace_root_id. */
app.get("/v1/traces/:traceRootId/events", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const threadKey = c.req.param("traceRootId");
  const limit = Math.min(Number(c.req.query("limit") ?? "500") || 500, 2000);
  const rows = db
    .prepare(
      `SELECT id, event_id, trace_root_id, session_id, session_key, agent_id, run_id, channel,
              type, payload_json, client_ts, schema_version, created_at
       FROM events
       WHERE (${THREAD_KEY_SQL}) = ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .all(threadKey, limit) as Array<Record<string, unknown>>;
  const items = rows.map((row) => ({
    ...row,
    payload: (() => {
      try {
        return JSON.parse(String(row.payload_json ?? "{}"));
      } catch {
        return {};
      }
    })(),
  }));
  return c.json({ thread_key: threadKey, items });
});

app.get("/v1/sessions/:sessionId/trace-root", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sessionId = c.req.param("sessionId");
  const row = db
    .prepare(
      `SELECT trace_root_id FROM events WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(sessionId) as { trace_root_id: string } | undefined;
  if (!row?.trace_root_id) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ session_id: sessionId, trace_root_id: row.trace_root_id });
});

app.delete("/v1/sessions/:sessionId", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sessionId = c.req.param("sessionId");
  const r = db.prepare(`DELETE FROM events WHERE session_id = ?`).run(sessionId);
  return c.json({ ok: true, deleted: r.changes });
});

/** SSE channel = **thread_key** (same as list/detail aggregate). */
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
