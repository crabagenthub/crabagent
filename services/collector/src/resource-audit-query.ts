import type Database from "better-sqlite3";
import {
  RESOURCE_AUDIT_HINT_TYPES,
  loadResourceAuditConfig,
  type ResourceAuditConfig,
  type ResourceAuditHintType,
} from "./resource-audit-config.js";

export const POLICY_HIT_UNTYPED = "policy_hit_untyped";

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
  /** 仅某条消息（Trace）下的资源事件 */
  trace_id?: string;
  /** 仅某个 Span */
  span_id?: string;
  workspace_name?: string;
  hint_type?: string;
  policy_id?: string;
  sort_mode?: "time_desc" | "risk_first" | "chars_desc";
  span_name?: string;
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

function sqlCommandTextExpr(alias: string): string {
  return `COALESCE(
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.command')), ''),
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.cmd')), ''),
    NULLIF(TRIM(json_extract(${alias}.input_json, '$.params.shell_command')), ''),
    ''
  )`;
}

function sqlLikelyFileCommandPredicate(alias: string): string {
  const cmd = `lower(${sqlCommandTextExpr(alias)})`;
  return `(
    ${cmd} LIKE 'trash %'
    OR ${cmd} LIKE 'rm %'
    OR ${cmd} LIKE 'mv %'
    OR ${cmd} LIKE 'cp %'
  )`;
}

function normalizePathLike(v: string, caseInsensitive: boolean): string {
  const s = v.replaceAll("/", "\\").trim();
  return caseInsensitive ? s.toLowerCase() : s;
}

function buildWhere(q: ResourceAuditListQuery): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  const uriExpr = sqlCoalesceResourceUri("s");
  parts.push(`(
    ${uriExpr} <> ''
    OR NULLIF(TRIM(json_extract(s.metadata_json, '$.semantic_kind')), '') = 'memory'
    OR ${sqlLikelyFileCommandPredicate("s")}
  )`);

  if (q.sinceMs != null && Number.isFinite(q.sinceMs) && q.sinceMs > 0) {
    parts.push(`COALESCE(s.start_time_ms, t.created_at_ms, 0) >= ?`);
    params.push(Math.floor(q.sinceMs));
  }
  if (q.untilMs != null && Number.isFinite(q.untilMs) && q.untilMs > 0) {
    parts.push(`COALESCE(s.start_time_ms, t.created_at_ms, 0) <= ?`);
    params.push(Math.floor(q.untilMs));
  }
  if (q.workspace_name && q.workspace_name.trim()) {
    parts.push(`lower(COALESCE(NULLIF(TRIM(t.workspace_name), ''), 'OpenClaw')) = lower(?)`);
    params.push(q.workspace_name.trim());
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

  const traceId = q.trace_id?.trim();
  if (traceId) {
    parts.push(`s.trace_id = ?`);
    params.push(traceId);
  }
  const spanId = q.span_id?.trim();
  if (spanId) {
    parts.push(`s.span_id = ?`);
    params.push(spanId);
  }
  const spanName = q.span_name?.trim();
  if (spanName) {
    parts.push(`lower(COALESCE(s.name, '')) = lower(?)`);
    params.push(spanName);
  }
  const hintType = q.hint_type?.trim();
  if (hintType) {
    parts.push(`EXISTS (
      SELECT 1
      FROM security_audit_logs sal
      JOIN json_each(sal.findings_json) j
      WHERE sal.trace_id = s.trace_id
        AND COALESCE(NULLIF(TRIM(sal.span_id), ''), '') = COALESCE(NULLIF(TRIM(s.span_id), ''), '')
        AND lower(COALESCE(json_extract(j.value, '$.hint_type'), '')) = lower(?)
    )`);
    params.push(hintType);
  }
  const policyId = q.policy_id?.trim();
  if (policyId) {
    parts.push(`EXISTS (
      SELECT 1
      FROM security_audit_logs sal
      JOIN json_each(sal.findings_json) j
      WHERE sal.trace_id = s.trace_id
        AND COALESCE(NULLIF(TRIM(sal.span_id), ''), '') = COALESCE(NULLIF(TRIM(s.span_id), ''), '')
        AND COALESCE(json_extract(j.value, '$.policy_id'), '') = ?
    )`);
    params.push(policyId);
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

function policyHintFlags(
  r: Record<string, unknown>,
  config: ResourceAuditConfig,
): string[] {
  if (!config.policyLink.enabled) {
    return [];
  }
  const raw = String(r.policy_hint_flags ?? "").trim();
  if (!raw) {
    return config.policyHintTypes.includeUnlabeledPolicyHit &&
      String(r.policy_hit_any ?? "0") === "1"
      ? [POLICY_HIT_UNTYPED]
      : [];
  }
  const allowed = new Set(config.policyHintTypes.enabledHintTypes);
  const out: string[] = [];
  for (const x of raw.split(",")) {
    const n = x.trim() as ResourceAuditHintType;
    if ((RESOURCE_AUDIT_HINT_TYPES as readonly string[]).includes(n) && allowed.has(n)) {
      out.push(n);
    }
  }
  if (out.length === 0 && config.policyHintTypes.includeUnlabeledPolicyHit && String(r.policy_hit_any ?? "0") === "1") {
    out.push(POLICY_HIT_UNTYPED);
  }
  return out;
}

export function sensitivePathFlags(uri: string, config: ResourceAuditConfig): string[] {
  const caseInsensitive = config.dangerousPathRules.caseInsensitive;
  const u = normalizePathLike(uri, caseInsensitive);
  const flags: string[] = [];
  for (const pref of [
    ...config.dangerousPathRules.posixPrefixes,
    ...config.dangerousPathRules.windowsPrefixes,
  ]) {
    const p = normalizePathLike(pref, caseInsensitive);
    if (!p) {
      continue;
    }
    if (u.includes(p) || u.startsWith(p)) {
      flags.push("sensitive_path");
      break;
    }
  }
  for (const regex of config.dangerousPathRules.windowsRegex) {
    try {
      const re = new RegExp(regex, caseInsensitive ? "i" : "");
      if (re.test(uri)) {
        flags.push("sensitive_path");
        break;
      }
    } catch {
      /* ignore bad regex; already validated on write */
    }
  }
  if (u.includes(".env") || u.endsWith(".pem") || u.includes("private.key")) {
    flags.push("sensitive_path");
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
  uri_repeat_count: number;
  risk_flags: string[];
};

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

function strOf(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return undefined;
}

function tokenizeShellCommand(command: string): string[] {
  const s = command.trim();
  if (!s) {
    return [];
  }
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let esc = false;
  for (const ch of s) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

function commandPathFromParams(params: Record<string, unknown>): string {
  const command = strOf(params.command) ?? strOf(params.cmd) ?? strOf(params.shell_command);
  if (!command) {
    return "";
  }
  const tokens = tokenizeShellCommand(command);
  if (tokens.length < 2) {
    return "";
  }
  const t0 = tokens[0] ?? "";
  const bin = (t0.includes("/") ? t0.split("/").pop() ?? t0 : t0).toLowerCase();
  if (bin !== "trash" && bin !== "rm" && bin !== "mv" && bin !== "cp") {
    return "";
  }
  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i]?.trim() ?? "";
    if (!t || t.startsWith("-")) {
      continue;
    }
    return t;
  }
  return "";
}

export function mapRawRowToAuditEvent(
  r: Record<string, unknown>,
  config: ResourceAuditConfig,
): ResourceAuditEventJson {
  const meta = parseJsonObject(r.metadata_json != null ? String(r.metadata_json) : "{}");
  const input = parseJsonObject(r.input_json != null ? String(r.input_json) : "{}");
  const output = parseJsonObject(r.output_json != null ? String(r.output_json) : "{}");
  const resObj = meta.resource && typeof meta.resource === "object" && !Array.isArray(meta.resource) ? (meta.resource as Record<string, unknown>) : {};
  const uriFromMeta = typeof resObj.uri === "string" ? resObj.uri.trim() : "";
  const params = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? (input.params as Record<string, unknown>) : {};
  const uriFromCommand = commandPathFromParams(params);
  const uri =
    uriFromMeta ||
    (typeof params.path === "string" && params.path.trim()) ||
    (typeof params.file_path === "string" && params.file_path.trim()) ||
    (typeof params.target_file === "string" && params.target_file.trim()) ||
    uriFromCommand ||
    "";
  const accessModeFromCommand = uriFromMeta ? null : uriFromCommand ? "write" : null;
  const spanType = String(r.span_type ?? "");
  const semantic_class = semanticClassFromRow(meta, spanType);
  const access_mode =
    typeof resObj.access_mode === "string" && resObj.access_mode.trim()
      ? resObj.access_mode
      : accessModeFromCommand;
  const chars = numFromUnknown(resObj.chars);
  const snippet =
    typeof resObj.snippet === "string"
      ? resObj.snippet
      : typeof output.snippet === "string"
        ? output.snippet
        : null;
  const uriRepeat = Number(r.uri_repeat_count ?? 0) || 0;

  const risk_flags: string[] = [];
  risk_flags.push(...sensitivePathFlags(uri, config));
  risk_flags.push(...policyHintFlags(r, config));
  if (chars != null && chars >= config.largeRead.thresholdChars) {
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
       (
         SELECT GROUP_CONCAT(DISTINCT json_extract(j.value, '$.hint_type'))
         FROM security_audit_logs sal
         JOIN json_each(sal.findings_json) j
         WHERE sal.trace_id = s.trace_id
           AND COALESCE(NULLIF(TRIM(sal.span_id), ''), '') = COALESCE(NULLIF(TRIM(s.span_id), ''), '')
           AND COALESCE(NULLIF(TRIM(json_extract(j.value, '$.hint_type')), ''), '') <> ''
       ) AS policy_hint_flags,
       (
         SELECT CASE WHEN EXISTS (
           SELECT 1
           FROM security_audit_logs sal2
           WHERE sal2.trace_id = s.trace_id
             AND COALESCE(NULLIF(TRIM(sal2.span_id), ''), '') = COALESCE(NULLIF(TRIM(s.span_id), ''), '')
         ) THEN 1 ELSE 0 END
       ) AS policy_hit_any,
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
  const config = loadResourceAuditConfig();
  const sql = `${SPAN_AUDIT_SELECT} ${whereSql} ORDER BY started_at_ms ${order}, s.span_id ${order} LIMIT ${lim} OFFSET ${off}`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const events = rows.map((row) => mapRawRowToAuditEvent(row, config));
  if (q.sort_mode === "chars_desc") {
    return events.sort((a, b) => (b.chars ?? -1) - (a.chars ?? -1));
  }
  if (q.sort_mode === "risk_first") {
    const rank = (r: ResourceAuditEventJson): number => {
      const flags = new Set(r.risk_flags);
      if (flags.has("sensitive_path")) return 5;
      if (flags.has("large_read")) return 4;
      if (flags.has("pii_hint")) return 3;
      if (flags.has("redundant_read")) return 2;
      if (r.risk_flags.length > 0) return 1;
      return 0;
    };
    return events.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (rb !== ra) return rb - ra;
      if ((b.chars ?? -1) !== (a.chars ?? -1)) return (b.chars ?? -1) - (a.chars ?? -1);
      if ((b.duration_ms ?? -1) !== (a.duration_ms ?? -1)) return (b.duration_ms ?? -1) - (a.duration_ms ?? -1);
      return b.started_at_ms - a.started_at_ms;
    });
  }
  return events;
}

export type ResourceAuditStatsJson = {
  summary: {
    total_events: number;
    /** 至少涉及的不同 Trace（消息）条数 */
    distinct_traces: number;
    avg_duration_ms: number | null;
    risk_sensitive_path: number;
    risk_pii_hint: number;
    risk_large_read: number;
    /** 同 Trace 内同一 URI 出现次数 >3 的访问行数（与流水 redundant_read 标签一致） */
    risk_redundant_read: number;
    /** 至少命中任一风险启发式的事件数（去重计数行，非标志去重） */
    risk_any: number;
    risk_secret_hint: number;
    risk_credential_hint: number;
    risk_config_hint: number;
    risk_database_hint: number;
  };
  top_resources: { uri: string; count: number; sum_chars: number | null; avg_duration_ms: number | null }[];
  class_distribution: { semantic_class: string; count: number }[];
  daily_io: {
    day: string;
    event_count: number;
    avg_duration_ms: number | null;
  }[];
  top_tools: { span_name: string; count: number }[];
  by_workspace: { workspace_name: string; count: number }[];
  hint_type_distribution: { hint_type: string; count: number }[];
};

export function queryResourceAuditStats(db: Database.Database, q: Omit<ResourceAuditListQuery, "limit" | "offset" | "order">): ResourceAuditStatsJson {
  const baseQ: ResourceAuditListQuery = { ...q, limit: 500, offset: 0, order: "desc" };
  const { sql: whereSql, params } = buildWhere(baseQ);
  const uriExpr = sqlCoalesceResourceUri("s");
  const config = loadResourceAuditConfig();
  const summaryRows = db
    .prepare(`${SPAN_AUDIT_SELECT} ${whereSql}`)
    .all(...params) as Record<string, unknown>[];
  const allEvents = summaryRows.map((row) => mapRawRowToAuditEvent(row, config));
  const traces = new Set(allEvents.map((e) => e.trace_id).filter(Boolean));
  const durRows = allEvents.filter((e) => e.duration_ms != null);
  const avgDur = durRows.length > 0 ? durRows.reduce((acc, e) => acc + Number(e.duration_ms ?? 0), 0) / durRows.length : null;
  const countByFlag = (flag: string) => allEvents.filter((e) => e.risk_flags.includes(flag)).length;
  const riskAny = allEvents.filter((e) => e.risk_flags.length > 0).length;
  const hintTypeDistribution = RESOURCE_AUDIT_HINT_TYPES.map((hint) => ({
    hint_type: hint,
    count: countByFlag(hint),
  })).filter((x) => x.count > 0);

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

  const toolsSql = `
SELECT COALESCE(NULLIF(TRIM(s.name), ''), '(unnamed)') AS tool_name,
       COUNT(*) AS cnt
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
${whereSql}
AND s.span_type = 'tool'
GROUP BY tool_name
ORDER BY cnt DESC
LIMIT 12
`;
  const toolRows = db.prepare(toolsSql).all(...params) as Record<string, unknown>[];

  const wsSql = `
SELECT COALESCE(NULLIF(TRIM(t.workspace_name), ''), 'default') AS ws,
       COUNT(*) AS cnt
FROM opik_spans s
LEFT JOIN opik_traces t ON t.trace_id = s.trace_id
${whereSql}
GROUP BY ws
ORDER BY cnt DESC
LIMIT 10
`;
  const wsRows = db.prepare(wsSql).all(...params) as Record<string, unknown>[];

  return {
    summary: {
      total_events: allEvents.length,
      distinct_traces: traces.size,
      avg_duration_ms: avgDur,
      risk_sensitive_path: countByFlag("sensitive_path"),
      risk_pii_hint: countByFlag("pii_hint"),
      risk_large_read: countByFlag("large_read"),
      risk_redundant_read: countByFlag("redundant_read"),
      risk_any: riskAny,
      risk_secret_hint: countByFlag("secret_hint"),
      risk_credential_hint: countByFlag("credential_hint"),
      risk_config_hint: countByFlag("config_hint"),
      risk_database_hint: countByFlag("database_hint"),
    },
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
    top_tools: toolRows.map((r) => ({
      span_name: String(r.tool_name ?? ""),
      count: Number(r.cnt ?? 0),
    })),
    by_workspace: wsRows.map((r) => ({
      workspace_name: String(r.ws ?? ""),
      count: Number(r.cnt ?? 0),
    })),
    hint_type_distribution: hintTypeDistribution,
  };
}
