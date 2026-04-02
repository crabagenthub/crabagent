import type Database from "better-sqlite3";

/** 与 apps/web span-insights 大文件阈值对齐（字符量级）。 */
export const RESOURCE_AUDIT_LARGE_CHARS = 500_000;

export type ResourceAuditSemanticFilter = "all" | "file" | "memory" | "tool_io";

export type ResourceAuditListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  sinceMs?: number;
  untilMs?: number;
  search?: string;
  semantic_class?: ResourceAuditSemanticFilter;
  uri_prefix?: string;
};

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

/** SQLite：从 span 行解析资源 URI（与插件 metadata.resource.uri / params 对齐）。 */
export function sqlCoalesceResourceUri(alias: string): string {
  return `COALESCE(
    NULLIF(TRIM(json_extract(${alias}.metadata_json, '$.resource.uri')), ''),
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.path')), ''),
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.file_path')), ''),
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.target_file')), ''),
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.targetFile')), ''),
    ''
  )`;
}

function buildWhere(q: ResourceAuditListQuery): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  const uriExpr = sqlCoalesceResourceUri("s");
  parts.push(`(
    ${uriExpr} <> ''
    OR NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') = 'memory'
  )`);

  if (q.sinceMs != null && Number.isFinite(q.sinceMs) && q.sinceMs > 0) {
    parts.push(`COALESCE(s.start_time_ms, t.created_at_ms, 0) >= ?`);
    params.push(Math.floor(q.sinceMs));
  }
  if (q.untilMs != null && Number.isFinite(q.untilMs) && q.untilMs > 0) {
    parts.push(`COALESCE(s.start_time_ms, t.created_at_ms, 0) <= ?`);
    params.push(Math.floor(q.untilMs));
  }

  const search = q.search?.trim().slice(0, 200);
  if (search) {
    parts.push(
      `(instr(lower(${uriExpr}), lower(?)) > 0
        OR instr(lower(COALESCE(s.name, '')), lower(?)) > 0
        OR instr(lower(COALESCE(s.metadata_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(s.input_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(s.output_json, '')), lower(?)) > 0
        OR instr(lower(COALESCE(s.trace_id, '')), lower(?)) > 0)`,
    );
    params.push(search, search, search, search, search, search);
  }

  const pref = q.uri_prefix?.trim();
  if (pref) {
    parts.push(`instr(lower(${uriExpr}), lower(?)) = 1`);
    params.push(pref.toLowerCase());
  }

  const sc = q.semantic_class ?? "all";
  if (sc === "file") {
    parts.push(`NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') = 'file'`);
  } else if (sc === "memory") {
    parts.push(`NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') = 'memory'`);
  } else if (sc === "tool_io") {
    parts.push(`s.span_type = 'tool'`);
    parts.push(
      `(NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') IS NULL OR NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') NOT IN ('memory', 'file'))`,
    );
  }

  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

function semanticClassFromRow(meta: Record<string, unknown>, spanType: string): string {
  const sk = typeof meta.semantic_kind === "string" ? meta.semantic_kind : "";
  if (sk === "memory") {
    return "memory";
  }
  if (sk === "file") {
    return "file";
  }
  if (spanType === "tool") {
    return "tool_io";
  }
  return "other";
}

export function sensitivePathFlags(uri: string): string[] {
  const u = uri.toLowerCase();
  const flags: string[] = [];
  if (u.includes("/etc/") || u.startsWith("/etc")) {
    flags.push("sensitive_path");
  }
  if (u.includes(".ssh") || u.includes("id_rsa") || u.includes("id_ed25519")) {
    flags.push("sensitive_path");
  }
  if (u.includes(".env") || u.endsWith(".pem") || u.includes("private.key")) {
    flags.push("sensitive_path");
  }
  return flags;
}

export function piiHintFlags(text: string | undefined | null): string[] {
  if (!text || text.length > 8000) {
    return [];
  }
  const t = text.toUpperCase();
  const flags: string[] = [];
  if (t.includes("API_KEY") || t.includes("APIKEY")) {
    flags.push("pii_hint");
  }
  if (t.includes("PASSWORD") || t.includes("SECRET_KEY") || t.includes("PRIVATE_KEY")) {
    flags.push("pii_hint");
  }
  return flags;
}

export type ResourceAuditEventJson = {
  span_id: string;
  trace_id: string;
  thread_key: string;
  workspace_name: string;
  project_name: string;
  span_name: string;
  span_type: string;
  started_at_ms: number;
  duration_ms: number | null;
  resource_uri: string;
  access_mode: string | null;
  chars: number | null;
  snippet: string | null;
  semantic_class: string;
  relevance_max: number | null;
  uri_repeat_count: number;
  risk_flags: string[];
};

function maxScoreFromOutput(out: Record<string, unknown>): number | null {
  const tk = out.top_k ?? out.topK ?? out.hits ?? out.results;
  if (!Array.isArray(tk)) {
    return null;
  }
  let best: number | null = null;
  for (const item of tk) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const o = item as Record<string, unknown>;
    const s =
      typeof o.score === "number"
        ? o.score
        : typeof o.relevance === "number"
          ? o.relevance
          : typeof o.distance === "number"
            ? o.distance
            : null;
    if (s != null && Number.isFinite(s)) {
      if (best == null || s > best) {
        best = s;
      }
    }
  }
  return best;
}

function numFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function mapRawRowToAuditEvent(r: Record<string, unknown>): ResourceAuditEventJson {
  const meta = parseJsonObject(r.metadata_json != null ? String(r.metadata_json) : "{}");
  const input = parseJsonObject(r.input_json != null ? String(r.input_json) : "{}");
  const output = parseJsonObject(r.output_json != null ? String(r.output_json) : "{}");
  const resObj = meta.resource && typeof meta.resource === "object" && !Array.isArray(meta.resource) ? (meta.resource as Record<string, unknown>) : {};
  const uriFromMeta = typeof resObj.uri === "string" ? resObj.uri.trim() : "";
  const params = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? (input.params as Record<string, unknown>) : {};
  const uri =
    uriFromMeta ||
    (typeof params.path === "string" && params.path.trim()) ||
    (typeof params.file_path === "string" && params.file_path.trim()) ||
    (typeof params.target_file === "string" && params.target_file.trim()) ||
    "";
  const spanType = String(r.span_type ?? "");
  const semantic_class = semanticClassFromRow(meta, spanType);
  const access_mode = typeof resObj.access_mode === "string" ? resObj.access_mode : null;
  const chars = numFromUnknown(resObj.chars);
  const snippet =
    typeof resObj.snippet === "string"
      ? resObj.snippet
      : typeof output.snippet === "string"
        ? output.snippet
        : null;
  const relevance_max = maxScoreFromOutput(output);
  const uriRepeat = Number(r.uri_repeat_count ?? 0) || 0;

  const risk_flags: string[] = [];
  risk_flags.push(...sensitivePathFlags(uri));
  risk_flags.push(...piiHintFlags(snippet));
  const outStr = typeof r.output_json === "string" ? r.output_json.slice(0, 4096) : "";
  if (!risk_flags.includes("pii_hint")) {
    risk_flags.push(...piiHintFlags(outStr));
  }
  if (chars != null && chars >= RESOURCE_AUDIT_LARGE_CHARS) {
    risk_flags.push("large_read");
  }
  if (uriRepeat > 3) {
    risk_flags.push("redundant_read");
  }
  const uniq = [...new Set(risk_flags)];

  return {
    span_id: String(r.span_id ?? ""),
    trace_id: String(r.trace_id ?? ""),
    thread_key: String(r.thread_key ?? r.trace_id ?? ""),
    workspace_name: String(r.workspace_name ?? "default"),
    project_name: String(r.project_name ?? "openclaw"),
    span_name: String(r.name ?? ""),
    span_type: spanType,
    started_at_ms: Number(r.started_at_ms ?? 0),
    duration_ms: r.duration_ms != null && r.duration_ms !== "" ? Number(r.duration_ms) : null,
    resource_uri: uri,
    access_mode,
    chars,
    snippet: snippet && snippet.length > 500 ? `${snippet.slice(0, 499)}…` : snippet,
    semantic_class,
    relevance_max,
    uri_repeat_count: uriRepeat,
    risk_flags: uniq,
  };
}

const SPAN_AUDIT_SELECT = `
SELECT s.span_id,
       s.trace_id,
       s.name,
       s.span_type,
       COALESCE(s.start_time_ms, t.created_at_ms, 0) AS started_at_ms,
       s.duration_ms,
       s.metadata_json,
       s.input_json,
       s.output_json,
       COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) AS thread_key,
       t.workspace_name,
       t.project_name,
       (SELECT COUNT(*)
        FROM opik_spans s2
        WHERE s2.trace_id = s.trace_id
          AND ${sqlCoalesceResourceUri("s2")} = ${sqlCoalesceResourceUri("s")}
          AND ${sqlCoalesceResourceUri("s")} <> ''
          AND ${sqlCoalesceResourceUri("s2")} <> '') AS uri_repeat_count
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
`;

export function countResourceAuditEvents(db: Database.Database, q: ResourceAuditListQuery): number {
  const { sql: whereSql, params } = buildWhere(q);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM opik_spans s LEFT JOIN opik_traces t ON t.trace_id = s.trace_id ${whereSql}`).get(...params) as {
    n: number;
  };
  return Number(row?.n ?? 0);
}

export function queryResourceAuditEvents(db: Database.Database, q: ResourceAuditListQuery): ResourceAuditEventJson[] {
  const { sql: whereSql, params } = buildWhere(q);
  const order = q.order === "asc" ? "ASC" : "DESC";
  const lim = Math.min(Math.max(q.limit, 1), 500);
  const off = Math.max(q.offset, 0);
  const sql = `${SPAN_AUDIT_SELECT} ${whereSql} ORDER BY started_at_ms ${order}, s.span_id ${order} LIMIT ${lim} OFFSET ${off}`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRawRowToAuditEvent);
}

export type ResourceAuditStatsJson = {
  top_resources: { uri: string; count: number; sum_chars: number | null; avg_duration_ms: number | null }[];
  class_distribution: { semantic_class: string; count: number }[];
  daily_io: { day: string; event_count: number; avg_duration_ms: number | null }[];
};

export function queryResourceAuditStats(db: Database.Database, q: Omit<ResourceAuditListQuery, "limit" | "offset" | "order">): ResourceAuditStatsJson {
  const baseQ: ResourceAuditListQuery = { ...q, limit: 500, offset: 0, order: "desc" };
  const { sql: whereSql, params } = buildWhere(baseQ);
  const uriExpr = sqlCoalesceResourceUri("s");

  const topSql = `
SELECT ${uriExpr} AS uri,
       COUNT(*) AS cnt,
       SUM(CAST(NULLIF(TRIM(json_extract(s.metadata_json, '$.resource.chars')), '') AS REAL)) AS sum_chars,
       AVG(CAST(s.duration_ms AS REAL)) AS avg_dur
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
${whereSql}
GROUP BY uri
HAVING uri <> ''
ORDER BY cnt DESC
LIMIT 10
`;
  const topRows = db.prepare(topSql).all(...params) as Record<string, unknown>[];

  const classSql = `
SELECT CASE
  WHEN NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') = 'memory' THEN 'memory'
  WHEN NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') = 'file' THEN 'file'
  WHEN s.span_type = 'tool' THEN 'tool_io'
  ELSE 'other'
END AS semantic_class,
COUNT(*) AS cnt
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
${whereSql}
GROUP BY semantic_class
`;
  const classRows = db.prepare(classSql).all(...params) as Record<string, unknown>[];

  const dailySql = `
SELECT strftime('%Y-%m-%d', datetime(CAST(COALESCE(s.start_time_ms, t.created_at_ms, 0) AS REAL) / 1000, 'unixepoch')) AS day,
       COUNT(*) AS n,
       AVG(CAST(s.duration_ms AS REAL)) AS avg_dur
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
${whereSql}
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
LIMIT 90
`;
  const dailyRows = db.prepare(dailySql).all(...params) as Record<string, unknown>[];

  return {
    top_resources: topRows.map((r) => ({
      uri: String(r.uri ?? ""),
      count: Number(r.cnt ?? 0),
      sum_chars: r.sum_chars != null && String(r.sum_chars) !== "" ? Number(r.sum_chars) : null,
      avg_duration_ms: r.avg_dur != null && String(r.avg_dur) !== "" ? Number(r.avg_dur) : null,
    })),
    class_distribution: classRows.map((r) => ({
      semantic_class: String(r.semantic_class ?? "other"),
      count: Number(r.cnt ?? 0),
    })),
    daily_io: dailyRows.map((r) => ({
      day: String(r.day ?? ""),
      event_count: Number(r.n ?? 0),
      avg_duration_ms: r.avg_dur != null && String(r.avg_dur) !== "" ? Number(r.avg_dur) : null,
    })),
  };
}
