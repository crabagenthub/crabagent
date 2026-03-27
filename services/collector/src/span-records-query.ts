import type Database from "better-sqlite3";
import {
  clampFacetFilter,
  SPAN_ROW_TIMEOUT_LIKE_SQL,
  type ObserveListStatus,
} from "./observe-list-filters.js";
import { SPAN_ROW_TOKEN_INTEGER_EXPR } from "./opik-tokens-sql.js";

export type SpanRecordsListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  sort?: "time" | "tokens";
  search?: string;
  sinceMs?: number;
  untilMs?: number;
  channel?: string;
  agent?: string;
  listStatus?: ObserveListStatus;
};

const PREVIEW = 4096;

const SPAN_SELECT = `
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.start_time_ms,
       s.end_time_ms,
       s.duration_ms,
       s.model,
       s.provider,
       s.is_complete,
       SUBSTR(TRIM(COALESCE(s.input_json, '')), 1, ${PREVIEW}) AS input_preview,
       SUBSTR(TRIM(COALESCE(s.output_json, '')), 1, ${PREVIEW}) AS output_preview,
       COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) AS thread_key,
       t.workspace_name,
       t.project_name,
       th.agent_name,
       th.channel_name,
       (${SPAN_ROW_TOKEN_INTEGER_EXPR}) AS total_tokens,
       CASE
         WHEN s.is_complete = 0 THEN 'running'
         WHEN s.is_complete = 1 AND TRIM(COALESCE(s.error_info_json, '')) = '' THEN 'success'
         WHEN s.is_complete = 1 AND ${SPAN_ROW_TIMEOUT_LIKE_SQL} THEN 'timeout'
         ELSE 'error'
       END AS list_status
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
LEFT JOIN opik_threads th
  ON th.thread_id = t.thread_id
 AND th.workspace_name = t.workspace_name
 AND th.project_name = t.project_name
`;

function clampSearch(s: string): string | undefined {
  const t = s.trim();
  if (t.length === 0) {
    return undefined;
  }
  return t.length > 200 ? t.slice(0, 200) : t;
}

export function buildSpanRecordsWhere(q: SpanRecordsListQuery): { whereSql: string; params: unknown[] } {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (q.sinceMs != null && Number.isFinite(q.sinceMs) && q.sinceMs > 0) {
    whereParts.push(`COALESCE(s.start_time_ms, t.created_at_ms, 0) >= ?`);
    params.push(Math.floor(q.sinceMs));
  }

  if (q.untilMs != null && Number.isFinite(q.untilMs) && q.untilMs > 0) {
    whereParts.push(`COALESCE(s.start_time_ms, t.created_at_ms, 0) <= ?`);
    params.push(Math.floor(q.untilMs));
  }

  const search = q.search ? clampSearch(q.search) : undefined;
  if (search) {
    whereParts.push(
      `(instr(lower(s.span_id), lower(?)) > 0
        OR instr(lower(s.trace_id), lower(?)) > 0
        OR instr(lower(COALESCE(s.name, '')), lower(?)) > 0
        OR instr(lower(COALESCE(s.input_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(s.output_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(t.thread_id, '')), lower(?)) > 0)`,
    );
    params.push(search, search, search, search, search, search);
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

  const st = q.listStatus;
  if (st === "running") {
    whereParts.push("s.is_complete = 0");
  } else if (st === "success") {
    whereParts.push("s.is_complete = 1 AND TRIM(COALESCE(s.error_info_json, '')) = ''");
  } else if (st === "error") {
    whereParts.push(
      `s.is_complete = 1 AND TRIM(COALESCE(s.error_info_json, '')) <> '' AND NOT ${SPAN_ROW_TIMEOUT_LIKE_SQL}`,
    );
  } else if (st === "timeout") {
    whereParts.push(`s.is_complete = 1 AND ${SPAN_ROW_TIMEOUT_LIKE_SQL}`);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  return { whereSql, params };
}

export function buildSpanRecordsSql(q: SpanRecordsListQuery): { sql: string; params: unknown[] } {
  const { whereSql, params: wp } = buildSpanRecordsWhere(q);
  const dir = q.order === "asc" ? "ASC" : "DESC";
  const sort = q.sort === "tokens" ? "tokens" : "time";
  const orderBy =
    sort === "tokens"
      ? `(${SPAN_ROW_TOKEN_INTEGER_EXPR}) ${dir}, s.span_id ${dir}`
      : `(s.start_time_ms IS NULL) ASC, COALESCE(s.start_time_ms, t.created_at_ms, 0) ${dir}, s.span_id ${dir}`;
  const sql = `${SPAN_SELECT} ${whereSql}
ORDER BY ${orderBy}
LIMIT ? OFFSET ?`;
  return { sql, params: [...wp, q.limit, q.offset] };
}

export function buildSpanRecordsCountSql(q: SpanRecordsListQuery): { sql: string; params: unknown[] } {
  const { whereSql, params } = buildSpanRecordsWhere(q);
  const sql = `SELECT COUNT(*) AS c FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
LEFT JOIN opik_threads th
  ON th.thread_id = t.thread_id
 AND th.workspace_name = t.workspace_name
 AND th.project_name = t.project_name
${whereSql}`;
  return { sql, params };
}

export type SpanRecordRawRow = Record<string, unknown>;

function parseListStatus(raw: unknown): ObserveListStatus {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "running" || s === "success" || s === "error" || s === "timeout") {
    return s;
  }
  return "success";
}

export function mapSpanRecordRow(r: SpanRecordRawRow): Record<string, unknown> {
  const tt = r.total_tokens;
  const totalTokens =
    tt != null && tt !== "" && Number.isFinite(Number(tt)) ? Math.max(0, Math.floor(Number(tt))) : 0;
  return {
    span_id: r.span_id,
    trace_id: r.trace_id,
    parent_span_id:
      r.parent_span_id == null || String(r.parent_span_id).trim() === "" ? null : r.parent_span_id,
    name: r.name ?? "",
    span_type: r.span_type ?? "general",
    start_time_ms: r.start_time_ms ?? null,
    end_time_ms: r.end_time_ms ?? null,
    duration_ms:
      r.duration_ms != null && r.duration_ms !== "" && Number.isFinite(Number(r.duration_ms))
        ? Number(r.duration_ms)
        : null,
    model: r.model ?? null,
    provider: r.provider ?? null,
    is_complete: Number(r.is_complete) === 1,
    input_preview: r.input_preview ?? null,
    output_preview: r.output_preview ?? null,
    thread_key: r.thread_key ?? r.trace_id,
    workspace_name: r.workspace_name ?? "default",
    project_name: r.project_name ?? "openclaw",
    agent_name: r.agent_name != null && String(r.agent_name).trim() !== "" ? String(r.agent_name) : null,
    channel_name:
      r.channel_name != null && String(r.channel_name).trim() !== "" ? String(r.channel_name) : null,
    total_tokens: totalTokens,
    list_status: parseListStatus(r.list_status),
  };
}

export function querySpanRecords(db: Database.Database, q: SpanRecordsListQuery): Record<string, unknown>[] {
  const { sql, params } = buildSpanRecordsSql(q);
  const rows = db.prepare(sql).all(...params) as SpanRecordRawRow[];
  return rows.map(mapSpanRecordRow);
}

export function countSpanRecords(db: Database.Database, q: SpanRecordsListQuery): number {
  const { sql, params } = buildSpanRecordsCountSql(q);
  const row = db.prepare(sql).get(...params) as { c: number | bigint } | undefined;
  if (!row) {
    return 0;
  }
  const n = row.c;
  return typeof n === "bigint" ? Number(n) : Number(n) || 0;
}
