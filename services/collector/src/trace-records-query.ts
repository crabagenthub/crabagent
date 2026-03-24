import type Database from "better-sqlite3";

export type TraceRecordsListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  minTotalTokens?: number;
  minLoopCount?: number;
  minToolCalls?: number;
  search?: string;
};

const TRACE_RECORDS_SELECT = `
SELECT t.trace_id,
       t.session_id,
       t.user_id,
       t.start_time,
       t.end_time,
       t.status,
       t.total_tokens,
       t.metadata,
       t.updated_at,
       (
         SELECT SUBSTR(TRIM(COALESCE(json_extract(e.payload_json, '$.content'), '')), 1, 240)
         FROM events e
         WHERE e.trace_root_id = t.trace_id AND e.type = 'message_received'
         ORDER BY e.id DESC
         LIMIT 1
       ) AS last_message_preview,
       COALESCE(
         NULLIF(TRIM(json_extract(t.metadata, '$.thread_key')), ''),
         (
           SELECT COALESCE(
             NULLIF(TRIM(e.session_key), ''),
             NULLIF(TRIM(e.session_id), ''),
             e.trace_root_id
           )
           FROM events e
           WHERE e.trace_root_id = t.trace_id
           LIMIT 1
         ),
         t.trace_id
       ) AS thread_key,
       (
         SELECT COUNT(*)
         FROM spans s
         WHERE s.trace_id = t.trace_id AND s.type = 'AGENT_LOOP'
       ) AS loop_count,
       (
         SELECT COUNT(*)
         FROM spans s
         WHERE s.trace_id = t.trace_id AND s.type = 'TOOL'
       ) AS tool_call_count,
       (
         SELECT COALESCE(SUM(o.saved_tokens), 0)
         FROM optimizations o
         INNER JOIN spans s ON s.span_id = o.span_id
         WHERE s.trace_id = t.trace_id
       ) AS saved_tokens_total
FROM traces t
`;

function clampSearch(s: string): string | undefined {
  const t = s.trim();
  if (t.length === 0) {
    return undefined;
  }
  return t.length > 200 ? t.slice(0, 200) : t;
}

export function buildTraceRecordsSql(q: TraceRecordsListQuery): { sql: string; params: unknown[] } {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (q.minTotalTokens != null && Number.isFinite(q.minTotalTokens) && q.minTotalTokens > 0) {
    whereParts.push("t.total_tokens >= ?");
    params.push(Math.floor(q.minTotalTokens));
  }

  if (q.minLoopCount != null && Number.isFinite(q.minLoopCount) && q.minLoopCount > 0) {
    whereParts.push(
      "(SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.trace_id AND s.type = 'AGENT_LOOP') >= ?",
    );
    params.push(Math.floor(q.minLoopCount));
  }

  if (q.minToolCalls != null && Number.isFinite(q.minToolCalls) && q.minToolCalls > 0) {
    whereParts.push(
      "(SELECT COUNT(*) FROM spans s WHERE s.trace_id = t.trace_id AND s.type = 'TOOL') >= ?",
    );
    params.push(Math.floor(q.minToolCalls));
  }

  const search = q.search ? clampSearch(q.search) : undefined;
  if (search) {
    whereParts.push(
      `EXISTS (
         SELECT 1 FROM events e
         WHERE e.trace_root_id = t.trace_id
           AND (
             instr(lower(e.payload_json), lower(?)) > 0
             OR instr(lower(COALESCE(e.chat_title, '')), lower(?)) > 0
             OR instr(lower(COALESCE(e.agent_name, '')), lower(?)) > 0
           )
       )`,
    );
    params.push(search, search, search);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  const dir = q.order === "asc" ? "ASC" : "DESC";
  const sql = `${TRACE_RECORDS_SELECT} ${whereSql}
ORDER BY COALESCE(t.end_time, t.start_time) ${dir}, t.start_time ${dir}
LIMIT ? OFFSET ?`;
  params.push(q.limit, q.offset);
  return { sql, params };
}

export type TraceRecordRawRow = Record<string, unknown>;

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

  const spent = Number(r.total_tokens) || 0;
  const saved = Number(r.saved_tokens_total) || 0;
  const denom = spent + saved;
  const optimization_rate_pct =
    denom > 0 ? Math.round((saved / denom) * 1000) / 10 : null;

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
    thread_key: r.thread_key,
    metadata,
    loop_count: Number(r.loop_count) || 0,
    tool_call_count: Number(r.tool_call_count) || 0,
    saved_tokens_total: saved,
    optimization_rate_pct,
  };
}

export function queryTraceRecords(db: Database.Database, q: TraceRecordsListQuery): Record<string, unknown>[] {
  const { sql, params } = buildTraceRecordsSql(q);
  const rows = db.prepare(sql).all(...params) as TraceRecordRawRow[];
  return rows.map(mapTraceRecordRow);
}
