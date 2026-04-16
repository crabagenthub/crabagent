import type Database from "better-sqlite3";

export type SecurityAuditListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  sinceMs?: number;
  untilMs?: number;
  traceId?: string;
  spanId?: string;
  policyId?: string;
  hintType?: string;
  workspaceName?: string;
};

export type SecurityAuditEventRow = {
  id: string;
  created_at_ms: number;
  trace_id: string;
  span_id: string | null;
  workspace_name: string;
  project_name: string;
  findings_json: string;
  total_findings: number;
  hit_count: number;
  intercepted: number;
  observe_only: number;
};

export type SecurityAuditPolicyEventCountRow = {
  policy_id: string;
  event_count: number;
};

function parseLimitOffset(c: { req: { query: (k: string) => string | undefined } }): {
  limit: number;
  offset: number;
} {
  const limRaw = c.req.query("limit");
  const offRaw = c.req.query("offset");
  let limit = limRaw != null ? Math.floor(Number(limRaw)) : 50;
  if (!Number.isFinite(limit) || limit < 1) {
    limit = 50;
  }
  if (limit > 200) {
    limit = 200;
  }
  let offset = offRaw != null ? Math.floor(Number(offRaw)) : 0;
  if (!Number.isFinite(offset) || offset < 0) {
    offset = 0;
  }
  return { limit, offset };
}

export function parseSecurityAuditListQuery(c: {
  req: { query: (k: string) => string | undefined };
}): SecurityAuditListQuery {
  const { limit, offset } = parseLimitOffset(c);
  const orderRaw = c.req.query("order")?.trim().toLowerCase();
  const order = orderRaw === "asc" ? "asc" : "desc";
  const sinceMs = (() => {
    const v = c.req.query("since_ms");
    if (v == null || v === "") {
      return undefined;
    }
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();
  const untilMs = (() => {
    const v = c.req.query("until_ms");
    if (v == null || v === "") {
      return undefined;
    }
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();
  const traceId = c.req.query("trace_id")?.trim() || undefined;
  const spanId = c.req.query("span_id")?.trim() || undefined;
  const policyId = c.req.query("policy_id")?.trim() || undefined;
  const hintType = c.req.query("hint_type")?.trim() || undefined;
  const workspaceName = c.req.query("workspace_name")?.trim() || undefined;
  return { limit, offset, order, sinceMs, untilMs, traceId, spanId, policyId, hintType, workspaceName };
}

export function countSecurityAuditEvents(db: Database.Database, q: SecurityAuditListQuery): number {
  const { sql, params } = buildWhere(q);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM security_audit_logs ${sql}`).get(...params) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

function buildWhere(q: SecurityAuditListQuery): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (q.sinceMs != null) {
    parts.push(`created_at_ms >= ?`);
    params.push(q.sinceMs);
  }
  if (q.untilMs != null) {
    parts.push(`created_at_ms <= ?`);
    params.push(q.untilMs);
  }
  if (q.traceId) {
    parts.push(`trace_id = ?`);
    params.push(q.traceId);
  }
  if (q.spanId) {
    parts.push(`(span_id IS NOT NULL AND span_id = ?)`);
    params.push(q.spanId);
  }
  if (q.workspaceName) {
    parts.push(`lower(workspace_name) = lower(?)`);
    params.push(q.workspaceName);
  }
  if (q.policyId) {
    parts.push(
      `EXISTS (
        SELECT 1
        FROM json_each(findings_json)
        WHERE json_extract(json_each.value, '$.policy_id') = ?
      )`,
    );
    params.push(q.policyId);
  }
  if (q.hintType) {
    parts.push(
      `EXISTS (
        SELECT 1
        FROM json_each(findings_json)
        WHERE lower(COALESCE(json_extract(json_each.value, '$.hint_type'), '')) = lower(?)
      )`,
    );
    params.push(q.hintType);
  }
  const sql = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  return { sql, params };
}

export function querySecurityAuditEvents(db: Database.Database, q: SecurityAuditListQuery): SecurityAuditEventRow[] {
  const { sql, params } = buildWhere(q);
  const orderDir = q.order === "asc" ? "ASC" : "DESC";
  return db
    .prepare(
      `SELECT id, created_at_ms, trace_id, span_id, workspace_name, project_name,
              findings_json,
              COALESCE(total_findings, 0) AS total_findings,
              hit_count, intercepted, observe_only
       FROM security_audit_logs
       ${sql}
       ORDER BY created_at_ms ${orderDir}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, q.limit, q.offset) as SecurityAuditEventRow[];
}

export function querySecurityAuditPolicyEventCounts(
  db: Database.Database,
  workspaceName?: string,
): SecurityAuditPolicyEventCountRow[] {
  const hasWorkspace = !!workspaceName?.trim();
  const whereSql = hasWorkspace ? `AND lower(s.workspace_name) = lower(?)` : "";
  return db
    .prepare(
      `SELECT json_extract(j.value, '$.policy_id') AS policy_id,
              COUNT(DISTINCT s.id) AS event_count
       FROM security_audit_logs AS s,
            json_each(s.findings_json) AS j
       WHERE COALESCE(TRIM(json_extract(j.value, '$.policy_id')), '') <> ''
       ${whereSql}
       GROUP BY json_extract(j.value, '$.policy_id')`,
    )
    .all(...(hasWorkspace ? [workspaceName!.trim()] : [])) as SecurityAuditPolicyEventCountRow[];
}
