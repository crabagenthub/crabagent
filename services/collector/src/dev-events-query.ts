import type Database from "better-sqlite3";

export type DevEventFilters = {
  event_id?: string;
  trace_root_id?: string;
  session_id?: string;
  session_key?: string;
  /** `session_key LIKE prefix || '%'` */
  session_key_prefix?: string;
  run_id?: string;
  msg_id?: string;
  channel?: string;
  type?: string;
  agent_id?: string;
  chat_title?: string;
  /** Substring match in `payload_json` (case-sensitive `INSTR`) */
  payload_contains?: string;
  client_ts_from?: string;
  client_ts_to?: string;
  id_min?: number;
  id_max?: number;
};

function trim(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** Parse filters from URL-style query values (Hono `c.req.query`). */
export function parseDevEventFilters(q: Record<string, string | undefined>): DevEventFilters {
  const idMinRaw = trim(q.id_min);
  const idMaxRaw = trim(q.id_max);
  const idMin = idMinRaw !== undefined ? Number(idMinRaw) : undefined;
  const idMax = idMaxRaw !== undefined ? Number(idMaxRaw) : undefined;
  return {
    event_id: trim(q.event_id),
    trace_root_id: trim(q.trace_root_id),
    session_id: trim(q.session_id),
    session_key: trim(q.session_key),
    session_key_prefix: trim(q.session_key_prefix),
    run_id: trim(q.run_id),
    msg_id: trim(q.msg_id),
    channel: trim(q.channel),
    type: trim(q.type),
    agent_id: trim(q.agent_id),
    chat_title: trim(q.chat_title),
    payload_contains: trim(q.payload_contains),
    client_ts_from: trim(q.client_ts_from),
    client_ts_to: trim(q.client_ts_to),
    id_min: idMin !== undefined && Number.isFinite(idMin) ? Math.floor(idMin) : undefined,
    id_max: idMax !== undefined && Number.isFinite(idMax) ? Math.floor(idMax) : undefined,
  };
}

function buildWhere(
  f: DevEventFilters,
): { clause: string; bindings: unknown[] } {
  const parts: string[] = [];
  const bindings: unknown[] = [];

  const eq = (col: string, val: string | undefined) => {
    if (!val) {
      return;
    }
    parts.push(`${col} = ?`);
    bindings.push(val);
  };

  eq("event_id", f.event_id);
  eq("trace_root_id", f.trace_root_id);
  eq("session_id", f.session_id);
  eq("session_key", f.session_key);
  eq("run_id", f.run_id);
  eq("msg_id", f.msg_id);
  eq("channel", f.channel);
  eq("type", f.type);
  eq("agent_id", f.agent_id);

  if (f.session_key_prefix) {
    parts.push(`session_key LIKE ?`);
    bindings.push(`${f.session_key_prefix.replace(/%/g, "")}%`);
  }

  if (f.chat_title) {
    parts.push(`INSTR(COALESCE(chat_title, ''), ?) > 0`);
    bindings.push(f.chat_title);
  }

  if (f.payload_contains) {
    parts.push(`INSTR(payload_json, ?) > 0`);
    bindings.push(f.payload_contains);
  }

  if (f.client_ts_from) {
    parts.push(`client_ts >= ?`);
    bindings.push(f.client_ts_from);
  }
  if (f.client_ts_to) {
    parts.push(`client_ts <= ?`);
    bindings.push(f.client_ts_to);
  }
  if (f.id_min !== undefined) {
    parts.push(`id >= ?`);
    bindings.push(f.id_min);
  }
  if (f.id_max !== undefined) {
    parts.push(`id <= ?`);
    bindings.push(f.id_max);
  }

  if (parts.length === 0) {
    return { clause: "", bindings: [] };
  }
  return { clause: `WHERE ${parts.join(" AND ")}`, bindings };
}

export type DevEventsQueryResult = {
  items: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
};

export function devFiltersAreEmpty(f: DevEventFilters): boolean {
  if (
    f.event_id ||
    f.trace_root_id ||
    f.session_id ||
    f.session_key ||
    f.session_key_prefix ||
    f.run_id ||
    f.msg_id ||
    f.channel ||
    f.type ||
    f.agent_id ||
    f.chat_title ||
    f.payload_contains ||
    f.client_ts_from ||
    f.client_ts_to
  ) {
    return false;
  }
  if (f.id_min !== undefined || f.id_max !== undefined) {
    return false;
  }
  return true;
}

/** Stable column order for `events` (matches `db.ts` DDL). */
export const EVENTS_TABLE_COLUMN_ORDER = [
  "id",
  "event_id",
  "trace_root_id",
  "session_id",
  "session_key",
  "agent_id",
  "agent_name",
  "chat_title",
  "run_id",
  "msg_id",
  "channel",
  "type",
  "schema_version",
  "client_ts",
  "created_at",
  "payload_json",
] as const;

/**
 * @param omitPayloadBody When true, select all columns except inline `payload_json` body; use `payload_json_length` instead.
 */
export function runDevEventsQuery(
  db: Database.Database,
  filters: DevEventFilters,
  limit: number,
  offset: number,
  omitPayloadBody: boolean,
): DevEventsQueryResult {
  const { clause, bindings } = buildWhere(filters);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`);
  const totalRow = countStmt.get(...bindings) as { n: number };
  const total = Number(totalRow?.n ?? 0);

  const selectSql = omitPayloadBody
    ? `
    SELECT id, event_id, trace_root_id, session_id, session_key, agent_id, agent_name, chat_title,
           run_id, msg_id, channel, type, schema_version, client_ts, created_at,
           LENGTH(payload_json) AS payload_json_length
    FROM events
    ${clause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `
    : `
    SELECT *
    FROM events
    ${clause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(selectSql).all(...bindings, limit, offset) as Record<string, unknown>[];
  return { items: rows, total, limit, offset };
}
