import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { openDatabase } from "./db.js";
import { runIngestBatch } from "./ingest.js";
import { sseSubscribe } from "./sse-hub.js";
import { devFiltersAreEmpty, parseDevEventFilters, runDevEventsQuery } from "./dev-events-query.js";
import { THREAD_KEY_SQL, threadKeySqlForAlias } from "./thread-key.js";

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
     event_id, trace_root_id, session_id, session_key, agent_id, agent_name, chat_title, run_id, msg_id, channel,
     type, payload_json, schema_version, client_ts
   ) VALUES (
     @event_id, @trace_root_id, @session_id, @session_key, @agent_id, @agent_name, @chat_title, @run_id, @msg_id, @channel,
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

/**
 * Dev-only: parameterized filter query over `events` (requires API key when configured).
 * At least one filter required to avoid full table scans.
 */
app.get("/v1/dev/events/query", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const q = (name: string): string | undefined => c.req.query(name) ?? undefined;
  const filters = parseDevEventFilters({
    event_id: q("event_id"),
    trace_root_id: q("trace_root_id"),
    session_id: q("session_id"),
    session_key: q("session_key"),
    session_key_prefix: q("session_key_prefix"),
    run_id: q("run_id"),
    channel: q("channel"),
    type: q("type"),
    agent_id: q("agent_id"),
    chat_title: q("chat_title"),
    payload_contains: q("payload_contains"),
    client_ts_from: q("client_ts_from"),
    client_ts_to: q("client_ts_to"),
    id_min: q("id_min"),
    id_max: q("id_max"),
  });
  if (devFiltersAreEmpty(filters)) {
    return c.json(
      {
        error: "at_least_one_filter_required",
        hint: "Pass e.g. trace_root_id, event_id, session_key_prefix, type, id_min/max, payload_contains, …",
      },
      400,
    );
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const offset = Math.max(0, Number(c.req.query("offset") ?? "0") || 0);
  const omitPayloadBody = q("omit_payload") === "1" || q("omit_payload")?.toLowerCase() === "true";
  const result = runDevEventsQuery(db, filters, limit, offset, omitPayloadBody);
  return c.json({ ok: true, ...result });
});

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
         SELECT id, event_id, trace_root_id, session_id, session_key, agent_id, agent_name, chat_title, msg_id, type, created_at, channel, payload_json,
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
              (
                SELECT e2.agent_id
                FROM events e2
                WHERE (${threadKeySqlForAlias("e2")}) = e.thread_key
                  AND e2.agent_id IS NOT NULL
                  AND TRIM(e2.agent_id) != ''
                ORDER BY e2.id DESC
                LIMIT 1
              ) AS agent_id,
              (
                SELECT e2.agent_name
                FROM events e2
                WHERE (${threadKeySqlForAlias("e2")}) = e.thread_key
                  AND e2.agent_name IS NOT NULL
                  AND TRIM(e2.agent_name) != ''
                ORDER BY e2.id DESC
                LIMIT 1
              ) AS agent_name,
              e.type,
              e.created_at,
              r.event_count,
              NULLIF(
                TRIM(COALESCE(e.channel, json_extract(e.payload_json, '$.channel'))),
                ''
              ) AS channel,
              (
                SELECT e3.chat_title
                FROM events e3
                WHERE (${threadKeySqlForAlias("e3")}) = e.thread_key
                  AND e3.chat_title IS NOT NULL
                  AND TRIM(e3.chat_title) != ''
                ORDER BY e3.id DESC
                LIMIT 1
              ) AS chat_title
       FROM ranked r
       JOIN per_event e ON e.id = r.max_id
       ORDER BY e.id DESC`,
    )
    .all(limit) as Record<string, unknown>[];
  return c.json({ items: rows });
});

/**
 * One row per inbound user message (`message_received`). Threads without that hook do not appear here.
 */
app.get("/v1/trace-messages", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? "100") || 100, 500);
  const rows = db
    .prepare(
      `SELECT e.id,
              e.event_id,
              e.msg_id,
              (${THREAD_KEY_SQL}) AS thread_key,
              e.trace_root_id,
              e.session_id,
              e.session_key,
              NULLIF(
                TRIM(COALESCE(e.channel, json_extract(e.payload_json, '$.channel'))),
                ''
              ) AS channel,
              COALESCE(
                NULLIF(TRIM(e.chat_title), ''),
                (
                  SELECT e3.chat_title
                  FROM events e3
                  WHERE (${threadKeySqlForAlias("e3")}) = (${threadKeySqlForAlias("e")})
                    AND e3.chat_title IS NOT NULL
                    AND TRIM(e3.chat_title) != ''
                  ORDER BY e3.id DESC
                  LIMIT 1
                )
              ) AS chat_title,
              (
                SELECT e2.agent_id
                FROM events e2
                WHERE (${threadKeySqlForAlias("e2")}) = (${threadKeySqlForAlias("e")})
                  AND e2.id <= e.id
                  AND e2.agent_id IS NOT NULL
                  AND TRIM(e2.agent_id) != ''
                ORDER BY e2.id DESC
                LIMIT 1
              ) AS agent_id,
              (
                SELECT e2.agent_name
                FROM events e2
                WHERE (${threadKeySqlForAlias("e2")}) = (${threadKeySqlForAlias("e")})
                  AND e2.id <= e.id
                  AND e2.agent_name IS NOT NULL
                  AND TRIM(e2.agent_name) != ''
                ORDER BY e2.id DESC
                LIMIT 1
              ) AS agent_name,
              e.created_at,
              e.client_ts,
              SUBSTR(TRIM(COALESCE(json_extract(e.payload_json, '$.content'), '')), 1, 280) AS message_preview
       FROM events e
       WHERE e.type = 'message_received'
         AND (${THREAD_KEY_SQL}) IS NOT NULL
       ORDER BY e.id DESC
       LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return c.json({ items: rows });
});

/**
 * Path param is **thread_key** (URL-encoded). Includes every row whose computed thread key matches,
 * plus any row that shares a `session_id` or `session_key` seen on those rows — fixes split buckets
 * when `message_received` has `session_key` but later hooks only had `session_id` (different COALESCE).
 */
app.get("/v1/traces/:traceRootId/events", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const threadKey = c.req.param("traceRootId");
  const limit = Math.min(Number(c.req.query("limit") ?? "500") || 500, 2000);
  const rows = db
    .prepare(
      `SELECT e.id, e.event_id, e.trace_root_id, e.session_id, e.session_key, e.agent_id, e.agent_name, e.chat_title, e.run_id, e.msg_id, e.channel,
              e.type, e.payload_json, e.client_ts, e.schema_version, e.created_at
       FROM events e
       WHERE (${threadKeySqlForAlias("e")}) = ?
          OR (
            NULLIF(TRIM(e.session_id), '') IS NOT NULL
            AND NULLIF(TRIM(e.session_id), '') IN (
              SELECT NULLIF(TRIM(e2.session_id), '')
              FROM events e2
              WHERE (${threadKeySqlForAlias("e2")}) = ?
                AND NULLIF(TRIM(e2.session_id), '') IS NOT NULL
            )
          )
          OR (
            NULLIF(TRIM(e.session_key), '') IS NOT NULL
            AND NULLIF(TRIM(e.session_key), '') IN (
              SELECT NULLIF(TRIM(e2.session_key), '')
              FROM events e2
              WHERE (${threadKeySqlForAlias("e2")}) = ?
                AND NULLIF(TRIM(e2.session_key), '') IS NOT NULL
            )
          )
       ORDER BY e.id ASC
       LIMIT ?`,
    )
    .all(threadKey, threadKey, threadKey, limit) as Array<Record<string, unknown>>;
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
