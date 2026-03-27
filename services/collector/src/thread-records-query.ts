import type Database from "better-sqlite3";
import { clampFacetFilter, traceRowTimeoutLikeSqlForAlias } from "./observe-list-filters.js";
import { TRACE_ROW_TOKEN_INTEGER_EXPR } from "./opik-tokens-sql.js";

const THREAD_LAST_TRACE_STATUS_SUBQUERY = `(SELECT CASE
  WHEN lt.is_complete = 0 THEN 'running'
  WHEN COALESCE(lt.success, 0) = 1 THEN 'success'
  WHEN COALESCE(lt.success, 0) = 0 AND ${traceRowTimeoutLikeSqlForAlias("lt")} THEN 'timeout'
  WHEN COALESCE(lt.success, 0) = 0 THEN 'error'
  ELSE 'running'
END
FROM opik_traces lt
WHERE lt.thread_id = th.thread_id
  AND lt.workspace_name = th.workspace_name
  AND lt.project_name = th.project_name
ORDER BY lt.created_at_ms DESC, lt.trace_id DESC
LIMIT 1)`;

export type ThreadRecordsListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  sort?: "time" | "tokens";
  search?: string;
  sinceMs?: number;
  untilMs?: number;
  /** Exact match on `opik_threads.channel_name`. */
  channel?: string;
  /** Exact match on `opik_threads.agent_name`. */
  agent?: string;
};

function clampSearch(s: string): string | undefined {
  const t = s.trim();
  if (t.length === 0) {
    return undefined;
  }
  return t.length > 200 ? t.slice(0, 200) : t;
}

const THREAD_PREVIEW_MAX = 16_384;

const THREAD_SELECT = `
SELECT th.thread_id,
       th.workspace_name,
       th.project_name,
       th.first_seen_ms,
       th.last_seen_ms,
       th.metadata_json AS metadata,
       th.agent_name,
       th.channel_name,
       (SELECT COUNT(*) FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name) AS trace_count,
       (SELECT SUBSTR(TRIM(COALESCE(
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.list_input_preview'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.prompt'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.text'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.body'), '')), ''),
          TRIM(COALESCE(t.input_json, t.name, ''))
        )), 1, ${THREAD_PREVIEW_MAX})
        FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name
        ORDER BY t.created_at_ms ASC, t.trace_id ASC
        LIMIT 1) AS first_message_preview,
       (SELECT SUBSTR(TRIM(COALESCE(
          NULLIF(TRIM(COALESCE(json_extract(t.output_json, '$.assistantTexts[0]'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.metadata_json, '$.output_preview'), '')), ''),
          NULLIF(TRIM(COALESCE(t.output_json, '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.list_input_preview'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.prompt'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.text'), '')), ''),
          NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.body'), '')), ''),
          TRIM(COALESCE(t.input_json, t.name, ''))
        )), 1, ${THREAD_PREVIEW_MAX})
        FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name
        ORDER BY t.created_at_ms DESC, t.trace_id DESC
        LIMIT 1) AS last_message_preview,
       (SELECT COALESCE(SUM(COALESCE(${TRACE_ROW_TOKEN_INTEGER_EXPR}, 0)), 0)
        FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name) AS total_tokens,
       (SELECT SUM(COALESCE(t.total_cost, 0))
        FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name) AS total_cost,
       COALESCE(
       (SELECT COALESCE(
          NULLIF(MAX(COALESCE(t.ended_at_ms, t.updated_at_ms, t.created_at_ms)) - MIN(t.created_at_ms), 0),
          NULLIF((SELECT SUM(COALESCE(t2.duration_ms, 0)) FROM opik_traces t2
                  WHERE t2.thread_id = th.thread_id
                    AND t2.workspace_name = th.workspace_name
                    AND t2.project_name = th.project_name), 0)
        )
        FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name),
       NULLIF(th.last_seen_ms - th.first_seen_ms, 0)
       ) AS duration_ms,
       ${THREAD_LAST_TRACE_STATUS_SUBQUERY} AS last_trace_status
FROM opik_threads th
`;

const THREAD_TOTAL_TOKENS_ORDER_EXPR = `(SELECT COALESCE(SUM(COALESCE(${TRACE_ROW_TOKEN_INTEGER_EXPR}, 0)), 0)
        FROM opik_traces t
        WHERE t.thread_id = th.thread_id
          AND t.workspace_name = th.workspace_name
          AND t.project_name = th.project_name)`;

export function buildThreadRecordsWhere(q: ThreadRecordsListQuery): { whereSql: string; params: unknown[] } {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (q.sinceMs != null && Number.isFinite(q.sinceMs) && q.sinceMs > 0) {
    whereParts.push("th.last_seen_ms >= ?");
    params.push(Math.floor(q.sinceMs));
  }

  if (q.untilMs != null && Number.isFinite(q.untilMs) && q.untilMs > 0) {
    whereParts.push("th.last_seen_ms <= ?");
    params.push(Math.floor(q.untilMs));
  }

  const channel = clampFacetFilter(q.channel);
  if (channel) {
    whereParts.push("th.channel_name = ?");
    params.push(channel);
  }
  const agent = clampFacetFilter(q.agent);
  if (agent) {
    whereParts.push("th.agent_name = ?");
    params.push(agent);
  }

  const search = q.search ? clampSearch(q.search) : undefined;
  if (search) {
    whereParts.push(
      `(instr(lower(th.thread_id), lower(?)) > 0
        OR instr(lower(COALESCE(th.metadata_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(th.agent_name, '')), lower(?)) > 0
        OR instr(lower(COALESCE(th.channel_name, '')), lower(?)) > 0
        OR instr(lower(th.workspace_name), lower(?)) > 0
        OR instr(lower(th.project_name), lower(?)) > 0
        OR EXISTS (
          SELECT 1 FROM opik_traces t
          WHERE t.thread_id = th.thread_id
            AND t.workspace_name = th.workspace_name
            AND t.project_name = th.project_name
            AND (
              instr(lower(COALESCE(t.input_json, '')), lower(?)) > 0
              OR instr(lower(COALESCE(t.output_json, '')), lower(?)) > 0
              OR instr(lower(COALESCE(t.name, '')), lower(?)) > 0
            )
        ))`,
    );
    params.push(search, search, search, search, search, search, search, search, search);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  return { whereSql, params };
}

export function buildThreadRecordsSql(q: ThreadRecordsListQuery): { sql: string; params: unknown[] } {
  const { whereSql, params: wp } = buildThreadRecordsWhere(q);
  const dir = q.order === "asc" ? "ASC" : "DESC";
  const sort = q.sort === "tokens" ? "tokens" : "time";
  const orderBy =
    sort === "tokens"
      ? `COALESCE(${THREAD_TOTAL_TOKENS_ORDER_EXPR}, 0) ${dir}, th.thread_id ${dir}`
      : `th.last_seen_ms ${dir}, th.thread_id ${dir}`;
  const sql = `${THREAD_SELECT} ${whereSql}
ORDER BY ${orderBy}
LIMIT ? OFFSET ?`;
  return { sql, params: [...wp, q.limit, q.offset] };
}

export function buildThreadRecordsCountSql(q: ThreadRecordsListQuery): { sql: string; params: unknown[] } {
  const { whereSql, params } = buildThreadRecordsWhere(q);
  const sql = `SELECT COUNT(*) AS c FROM opik_threads th ${whereSql}`;
  return { sql, params };
}

export type ThreadRecordRawRow = Record<string, unknown>;

function parseMetadata(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? "{}")) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function mapThreadRecordRow(r: ThreadRecordRawRow): Record<string, unknown> {
  const tokensRaw = r.total_tokens;
  const total_tokens =
    tokensRaw != null && tokensRaw !== "" && Number.isFinite(Number(tokensRaw)) ? Number(tokensRaw) : 0;
  const costRaw = r.total_cost;
  const total_cost =
    costRaw != null && costRaw !== "" && Number.isFinite(Number(costRaw)) ? Number(costRaw) : null;
  const durRaw = r.duration_ms;
  const duration_ms =
    durRaw != null && durRaw !== "" && Number.isFinite(Number(durRaw)) && Number(durRaw) > 0
      ? Number(durRaw)
      : null;

  const ag = r.agent_name;
  const ch = r.channel_name;
  const lts = r.last_trace_status;
  const last_trace_status =
    typeof lts === "string" && lts.trim() && ["running", "success", "error", "timeout"].includes(lts.trim())
      ? lts.trim()
      : null;
  return {
    thread_id: r.thread_id,
    workspace_name: r.workspace_name ?? "default",
    project_name: r.project_name ?? "openclaw",
    first_seen_ms: r.first_seen_ms,
    last_seen_ms: r.last_seen_ms,
    metadata: parseMetadata(r.metadata),
    agent_name: typeof ag === "string" && ag.trim() ? ag.trim() : null,
    channel_name: typeof ch === "string" && ch.trim() ? ch.trim() : null,
    trace_count: Number(r.trace_count) || 0,
    first_message_preview: r.first_message_preview ?? null,
    last_message_preview: r.last_message_preview ?? null,
    total_tokens,
    total_cost,
    duration_ms,
    status: last_trace_status,
  };
}

export function queryThreadRecords(db: Database.Database, q: ThreadRecordsListQuery): Record<string, unknown>[] {
  const { sql, params } = buildThreadRecordsSql(q);
  const rows = db.prepare(sql).all(...params) as ThreadRecordRawRow[];
  return rows.map(mapThreadRecordRow);
}

export function countThreadRecords(db: Database.Database, q: ThreadRecordsListQuery): number {
  const { sql, params } = buildThreadRecordsCountSql(q);
  const row = db.prepare(sql).get(...params) as { c: number | bigint } | undefined;
  if (!row) {
    return 0;
  }
  const n = row.c;
  return typeof n === "bigint" ? Number(n) : Number(n) || 0;
}
