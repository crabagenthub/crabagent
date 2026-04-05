import type Database from "better-sqlite3";
import {
  clampFacetFilter,
  TRACE_ROW_TIMEOUT_LIKE_SQL,
  type ObserveListStatus,
} from "./observe-list-filters.js";
import { TRACE_ROW_TOKEN_INTEGER_EXPR } from "./opik-tokens-sql.js";

export type TraceRecordsListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  /** Primary sort: creation time vs token total. */
  sort?: "time" | "tokens";
  minTotalTokens?: number;
  minLoopCount?: number;
  minToolCalls?: number;
  search?: string;
  /** Inclusive lower bound on `created_at_ms` (epoch ms). */
  sinceMs?: number;
  /** Inclusive upper bound on `created_at_ms` (epoch ms). */
  untilMs?: number;
  /** Exact match on `opik_threads.channel_name` via thread key. */
  channel?: string;
  /** Exact match on `opik_threads.agent_name` via thread key. */
  agent?: string;
  listStatus?: ObserveListStatus;
};

const LIST_PREVIEW_MAX_CHARS = 16_384;

const ALLOWED_TRACE_TYPES = new Set(["external", "subagent", "async_command", "system"]);

/** DB 中若误存 UUID 等非枚举值，列表 API 仍按 external 等合法值返回。 */
function normalizeTraceTypeForList(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v && ALLOWED_TRACE_TYPES.has(v)) {
    return v;
  }
  return "external";
}

const TRACE_RECORDS_SELECT = `
SELECT t.trace_id,
       NULL AS session_id,
       CAST(json_extract(t.metadata_json, '$.user_id') AS TEXT) AS user_id,
       t.created_at_ms AS start_time,
       COALESCE(
         t.ended_at_ms,
         CASE
           WHEN COALESCE(t.duration_ms, 0) > 0 THEN t.created_at_ms + t.duration_ms
           ELSE NULL
         END,
         t.updated_at_ms,
         t.created_at_ms
       ) AS end_time,
       CASE
         WHEN t.is_complete = 0 THEN 'running'
         WHEN COALESCE(t.success, 0) = 1 THEN 'success'
         WHEN COALESCE(t.success, 0) = 0 AND ${TRACE_ROW_TIMEOUT_LIKE_SQL} THEN 'timeout'
         WHEN COALESCE(t.success, 0) = 0 THEN 'error'
         ELSE 'running'
       END AS status,
       ${TRACE_ROW_TOKEN_INTEGER_EXPR} AS total_tokens,
       t.metadata_json AS metadata,
       t.created_at_ms AS updated_at,
       SUBSTR(TRIM(COALESCE(
         NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.list_input_preview'), '')), ''),
         NULLIF(TRIM(COALESCE(json_extract(t.input_json, '$.prompt'), '')), ''),
         TRIM(COALESCE(t.input_json, t.name, ''))
       )), 1, ${LIST_PREVIEW_MAX_CHARS}) AS last_message_preview,
       SUBSTR(TRIM(COALESCE(t.output_json, '')), 1, ${LIST_PREVIEW_MAX_CHARS}) AS output_preview,
       t.setting_json AS setting_json,
       t.trace_type AS trace_type,
       t.total_cost AS total_cost,
       t.duration_ms AS duration_ms,
       COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) AS thread_key,
       (SELECT COUNT(*) FROM opik_spans s WHERE s.trace_id = t.trace_id AND s.span_type = 'llm') AS loop_count,
       (SELECT COUNT(*) FROM opik_spans s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') AS tool_call_count,
       CAST(COALESCE(json_extract(t.metadata_json, '$.saved_tokens_total'), 0) AS INTEGER) AS saved_tokens_total,
       th.agent_name AS thread_agent_name,
       th.channel_name AS thread_channel_name
FROM opik_traces t
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

export function buildTraceRecordsWhere(q: TraceRecordsListQuery): { whereSql: string; params: unknown[] } {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (q.sinceMs != null && Number.isFinite(q.sinceMs) && q.sinceMs > 0) {
    whereParts.push("t.created_at_ms >= ?");
    params.push(Math.floor(q.sinceMs));
  }

  if (q.untilMs != null && Number.isFinite(q.untilMs) && q.untilMs > 0) {
    whereParts.push("t.created_at_ms <= ?");
    params.push(Math.floor(q.untilMs));
  }

  if (q.minTotalTokens != null && Number.isFinite(q.minTotalTokens) && q.minTotalTokens > 0) {
    whereParts.push(`(${TRACE_ROW_TOKEN_INTEGER_EXPR}) >= ?`);
    params.push(Math.floor(q.minTotalTokens));
  }

  if (q.minLoopCount != null && Number.isFinite(q.minLoopCount) && q.minLoopCount > 0) {
    whereParts.push(
      "(SELECT COUNT(*) FROM opik_spans s WHERE s.trace_id = t.trace_id AND s.span_type = 'llm') >= ?",
    );
    params.push(Math.floor(q.minLoopCount));
  }

  if (q.minToolCalls != null && Number.isFinite(q.minToolCalls) && q.minToolCalls > 0) {
    whereParts.push(
      "(SELECT COUNT(*) FROM opik_spans s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') >= ?",
    );
    params.push(Math.floor(q.minToolCalls));
  }

  const search = q.search ? clampSearch(q.search) : undefined;
  if (search) {
    whereParts.push(
      `(instr(lower(t.trace_id), lower(?)) > 0
        OR instr(lower(COALESCE(t.thread_id, '')), lower(?)) > 0
        OR instr(lower(COALESCE(t.input_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(t.output_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(t.metadata_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(t.name, '')), lower(?)) > 0)`,
    );
    params.push(search, search, search, search, search, search);
  }

  const channel = clampFacetFilter(q.channel);
  const agent = clampFacetFilter(q.agent);
  if (channel || agent) {
    const subParts = [
      "th.thread_id = t.thread_id",
      "th.workspace_name = t.workspace_name",
      "th.project_name = t.project_name",
    ];
    const subParams: unknown[] = [];
    if (channel) {
      subParts.push("th.channel_name = ?");
      subParams.push(channel);
    }
    if (agent) {
      subParts.push("th.agent_name = ?");
      subParams.push(agent);
    }
    whereParts.push(
      `EXISTS (SELECT 1 FROM opik_threads th WHERE ${subParts.join(" AND ")})`,
    );
    params.push(...subParams);
  }

  const st = q.listStatus;
  if (st === "running") {
    whereParts.push("t.is_complete = 0");
  } else if (st === "success") {
    whereParts.push("t.is_complete = 1 AND COALESCE(t.success, 0) = 1");
  } else if (st === "error") {
    whereParts.push(
      `t.is_complete = 1 AND COALESCE(t.success, 0) = 0 AND NOT ${TRACE_ROW_TIMEOUT_LIKE_SQL}`,
    );
  } else if (st === "timeout") {
    whereParts.push(
      `t.is_complete = 1 AND COALESCE(t.success, 0) = 0 AND ${TRACE_ROW_TIMEOUT_LIKE_SQL}`,
    );
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  return { whereSql, params };
}

export function buildTraceRecordsSql(q: TraceRecordsListQuery): { sql: string; params: unknown[] } {
  const { whereSql, params: wp } = buildTraceRecordsWhere(q);
  const dir = q.order === "asc" ? "ASC" : "DESC";
  const sort = q.sort === "tokens" ? "tokens" : "time";
  const orderBy =
    sort === "tokens"
      ? `(${TRACE_ROW_TOKEN_INTEGER_EXPR}) ${dir}, t.trace_id ${dir}`
      : `t.created_at_ms ${dir}, t.trace_id ${dir}`;
  const sql = `${TRACE_RECORDS_SELECT} ${whereSql}
ORDER BY ${orderBy}
LIMIT ? OFFSET ?`;
  const params = [...wp, q.limit, q.offset];
  return { sql, params };
}

export function buildTraceRecordsCountSql(q: TraceRecordsListQuery): { sql: string; params: unknown[] } {
  const { whereSql, params } = buildTraceRecordsWhere(q);
  const sql = `SELECT COUNT(*) AS c FROM opik_traces t ${whereSql}`;
  return { sql, params };
}

export type TraceRecordRawRow = Record<string, unknown>;

/** Derive display chips from OpenClaw `setting_json` (kind, routing toggles). */
function tagsFromSettingJson(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  const s = String(raw).trim();
  if (s.length === 0) {
    return [];
  }
  try {
    const j = JSON.parse(s) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) {
      return [];
    }
    const o = j as Record<string, unknown>;
    const out: string[] = [];
    const kind = o.kind;
    if (typeof kind === "string" && kind.trim()) {
      out.push(kind.trim());
    }
    for (const k of ["thinking", "verbose", "reasoning", "fast"] as const) {
      const v = o[k];
      if (v !== undefined && v !== null && String(v).trim() && String(v).toLowerCase() !== "inherit") {
        out.push(`${k}:${String(v)}`);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function mapTraceRecordRow(r: TraceRecordRawRow): Record<string, unknown> {
  let metadata: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(String(r.metadata ?? "{}")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      metadata = raw as Record<string, unknown>;
    }
  } catch {
    metadata = {};
  }

  /** Facet columns live on `opik_threads`; list UI reads `channel` / `agent_name` from `metadata`. */
  const threadAgent =
    r.thread_agent_name != null && String(r.thread_agent_name).trim() !== ""
      ? String(r.thread_agent_name).trim()
      : null;
  const threadChannel =
    r.thread_channel_name != null && String(r.thread_channel_name).trim() !== ""
      ? String(r.thread_channel_name).trim()
      : null;
  if (threadAgent != null) {
    metadata = { ...metadata, agent_name: threadAgent };
  }
  if (threadChannel != null) {
    metadata = { ...metadata, channel: threadChannel };
  }

  const spent = Number(r.total_tokens) || 0;
  const saved = Number(r.saved_tokens_total) || 0;
  const denom = spent + saved;
  const optimization_rate_pct =
    denom > 0 ? Math.round((saved / denom) * 1000) / 10 : null;

  const costRaw = r.total_cost;
  const total_cost =
    costRaw != null && costRaw !== "" && Number.isFinite(Number(costRaw)) ? Number(costRaw) : null;

  const durRaw = r.duration_ms;
  const duration_ms =
    durRaw != null && durRaw !== "" && Number.isFinite(Number(durRaw)) ? Number(durRaw) : null;

  const traceTypeRaw = r.trace_type;
  const trace_type = normalizeTraceTypeForList(traceTypeRaw);

  return {
    trace_id: r.trace_id,
    session_id: r.session_id,
    user_id: r.user_id,
    start_time: r.start_time,
    end_time: r.end_time,
    status: r.status,
    total_tokens: r.total_tokens,
    updated_at: r.updated_at,
    last_message_preview: r.last_message_preview,
    output_preview: r.output_preview ?? null,
    thread_key: r.thread_key,
    metadata,
    loop_count: Number(r.loop_count) || 0,
    tool_call_count: Number(r.tool_call_count) || 0,
    saved_tokens_total: saved,
    optimization_rate_pct,
    tags: tagsFromSettingJson(r.setting_json),
    trace_type,
    total_cost,
    duration_ms,
  };
}

export function queryTraceRecords(db: Database.Database, q: TraceRecordsListQuery): Record<string, unknown>[] {
  const { sql, params } = buildTraceRecordsSql(q);
  const rows = db.prepare(sql).all(...params) as TraceRecordRawRow[];
  return rows.map(mapTraceRecordRow);
}

export function countTraceRecords(db: Database.Database, q: TraceRecordsListQuery): number {
  const { sql, params } = buildTraceRecordsCountSql(q);
  const row = db.prepare(sql).get(...params) as { c: number | bigint } | undefined;
  if (!row) {
    return 0;
  }
  const n = row.c;
  return typeof n === "bigint" ? Number(n) : Number(n) || 0;
}
