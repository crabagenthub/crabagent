import type Database from "better-sqlite3";

export type SecurityAuditListQuery = {
  limit: number;
  offset: number;
  order: "asc" | "desc";
  sinceMs?: number;
  untilMs?: number;
  traceId?: string;
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
  return { limit, offset, order, sinceMs, untilMs, traceId };
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
