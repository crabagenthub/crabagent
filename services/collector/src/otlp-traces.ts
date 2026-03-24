import type Database from "better-sqlite3";

/** Normalized 32-char hex trace id or 16-char hex span id. */
export function decodeOtlpId(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  if (!t) {
    return null;
  }
  if (/^[0-9a-f]{32}$/i.test(t)) {
    return t.toLowerCase();
  }
  if (/^[0-9a-f]{16}$/i.test(t)) {
    return t.toLowerCase();
  }
  const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidLoose.test(t)) {
    return t.replace(/-/g, "").toLowerCase();
  }
  try {
    const buf = Buffer.from(t, "base64");
    if (buf.length !== 16 && buf.length !== 8) {
      return null;
    }
    return buf.toString("hex");
  } catch {
    return null;
  }
}

function attrString(attrs: unknown, key: string): string | null {
  if (!Array.isArray(attrs)) {
    return null;
  }
  for (const kv of attrs) {
    if (!kv || typeof kv !== "object") {
      continue;
    }
    const o = kv as { key?: unknown; value?: unknown };
    if (o.key !== key) {
      continue;
    }
    const v = o.value;
    if (!v || typeof v !== "object") {
      return null;
    }
    const sv = (v as { stringValue?: unknown }).stringValue;
    if (typeof sv === "string" && sv.trim()) {
      return sv.trim();
    }
  }
  return null;
}

function attrsToRecord(attrs: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!Array.isArray(attrs)) {
    return out;
  }
  for (const kv of attrs) {
    if (!kv || typeof kv !== "object") {
      continue;
    }
    const o = kv as { key?: unknown; value?: unknown };
    const k = typeof o.key === "string" ? o.key : "";
    if (!k) {
      continue;
    }
    const v = o.value;
    if (!v || typeof v !== "object") {
      continue;
    }
    const vo = v as Record<string, unknown>;
    if (typeof vo.stringValue === "string") {
      out[k] = vo.stringValue;
    } else if (typeof vo.boolValue === "boolean") {
      out[k] = vo.boolValue;
    } else if (typeof vo.intValue === "string" && vo.intValue.trim()) {
      const n = Number(vo.intValue);
      if (Number.isFinite(n)) {
        out[k] = n;
      }
    } else if (typeof vo.doubleValue === "number" && Number.isFinite(vo.doubleValue)) {
      out[k] = vo.doubleValue;
    }
  }
  return out;
}

function parseKind(kind: unknown): number | null {
  if (typeof kind === "number" && Number.isFinite(kind)) {
    return Math.floor(kind);
  }
  if (typeof kind !== "string") {
    return null;
  }
  const m: Record<string, number> = {
    SPAN_KIND_UNSPECIFIED: 0,
    SPAN_KIND_INTERNAL: 1,
    SPAN_KIND_SERVER: 2,
    SPAN_KIND_CLIENT: 3,
    SPAN_KIND_PRODUCER: 4,
    SPAN_KIND_CONSUMER: 5,
  };
  return m[kind.trim()] ?? null;
}

function parseStatusCode(code: unknown): string | null {
  if (typeof code === "number") {
    if (code === 0) {
      return "UNSET";
    }
    if (code === 1) {
      return "OK";
    }
    if (code === 2) {
      return "ERROR";
    }
  }
  if (typeof code === "string") {
    const u = code.trim().toUpperCase();
    if (u.includes("OK")) {
      return "OK";
    }
    if (u.includes("ERROR")) {
      return "ERROR";
    }
    if (u.includes("UNSET")) {
      return "UNSET";
    }
  }
  return null;
}

export type SpanInsertRow = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: number | null;
  start_time_unix_nano: string;
  end_time_unix_nano: string;
  status_code: string | null;
  status_message: string | null;
  attributes_json: string;
  resource_json: string;
  service_name: string | null;
  scope_name: string | null;
  trace_root_id: string | null;
  msg_id: string | null;
  event_id: string | null;
};

export function collectSpansFromBody(body: unknown): SpanInsertRow[] {
  const out: SpanInsertRow[] = [];
  if (!body || typeof body !== "object") {
    return out;
  }
  const resourceSpans = (body as { resourceSpans?: unknown }).resourceSpans;
  if (!Array.isArray(resourceSpans)) {
    return out;
  }

  for (const rs of resourceSpans) {
    if (!rs || typeof rs !== "object") {
      continue;
    }
    const resource = (rs as { resource?: unknown }).resource;
    const resAttrs =
      resource && typeof resource === "object"
        ? (resource as { attributes?: unknown }).attributes
        : undefined;
    const serviceName = attrString(resAttrs, "service.name");
    const resourceJson = JSON.stringify(attrsToRecord(resAttrs));

    const scopeSpans = (rs as { scopeSpans?: unknown }).scopeSpans;
    if (!Array.isArray(scopeSpans)) {
      continue;
    }
    for (const ss of scopeSpans) {
      if (!ss || typeof ss !== "object") {
        continue;
      }
      const scope = (ss as { scope?: unknown }).scope;
      const scopeName =
        scope && typeof scope === "object" && typeof (scope as { name?: unknown }).name === "string"
          ? String((scope as { name: string }).name).trim() || null
          : null;
      const spans = (ss as { spans?: unknown }).spans;
      if (!Array.isArray(spans)) {
        continue;
      }
      for (const sp of spans) {
        if (!sp || typeof sp !== "object") {
          continue;
        }
        const o = sp as Record<string, unknown>;
        const traceId = decodeOtlpId(typeof o.traceId === "string" ? o.traceId : undefined);
        const spanId = decodeOtlpId(typeof o.spanId === "string" ? o.spanId : undefined);
        if (!traceId || !spanId) {
          continue;
        }
        const parentRaw = typeof o.parentSpanId === "string" ? o.parentSpanId.trim() : "";
        const parentSpanId = parentRaw ? decodeOtlpId(parentRaw) : null;
        const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : "unnamed";
        const kind = parseKind(o.kind);
        const start = String(o.startTimeUnixNano ?? "0");
        const end = String(o.endTimeUnixNano ?? o.startTimeUnixNano ?? "0");
        const status = o.status && typeof o.status === "object" ? (o.status as Record<string, unknown>) : {};
        const statusCode = parseStatusCode(status.code);
        const statusMessage =
          typeof status.message === "string" && status.message.trim() ? status.message.trim() : null;
        const attrRec = attrsToRecord(o.attributes);
        const attributesJson = JSON.stringify(attrRec);
        const traceRootId =
          (typeof attrRec["crabagent.trace_root_id"] === "string"
            ? attrRec["crabagent.trace_root_id"]
            : null) ||
          (typeof attrRec["crabagent.trace_root_id"] === "number"
            ? String(attrRec["crabagent.trace_root_id"])
            : null);
        const msgId =
          typeof attrRec["crabagent.msg_id"] === "string" ? attrRec["crabagent.msg_id"] : null;
        const eventId =
          typeof attrRec["crabagent.event_id"] === "string" ? attrRec["crabagent.event_id"] : null;

        out.push({
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: parentSpanId,
          name,
          kind,
          start_time_unix_nano: /^\d+$/.test(start) ? start : "0",
          end_time_unix_nano: /^\d+$/.test(end) ? end : "0",
          status_code: statusCode,
          status_message: statusMessage,
          attributes_json: attributesJson,
          resource_json: resourceJson,
          service_name: serviceName,
          scope_name: scopeName,
          trace_root_id: traceRootId,
          msg_id: msgId,
          event_id: eventId,
        });
      }
    }
  }
  return out;
}

export function runOtlpTracesIngest(params: {
  db: Database.Database;
  insertStmt: Database.Statement;
  body: unknown;
}): { accepted: number; skipped: number } {
  const rows = collectSpansFromBody(params.body);
  const tx = params.db.transaction((list: SpanInsertRow[]) => {
    let accepted = 0;
    let skipped = 0;
    for (const r of list) {
      try {
        const res = params.insertStmt.run({
          trace_id: r.trace_id,
          span_id: r.span_id,
          parent_span_id: r.parent_span_id,
          name: r.name,
          kind: r.kind,
          start_time_unix_nano: r.start_time_unix_nano,
          end_time_unix_nano: r.end_time_unix_nano,
          status_code: r.status_code,
          status_message: r.status_message,
          attributes_json: r.attributes_json,
          resource_json: r.resource_json,
          service_name: r.service_name,
          scope_name: r.scope_name,
          trace_root_id: r.trace_root_id,
          msg_id: r.msg_id,
          event_id: r.event_id,
        });
        if (res.changes > 0) {
          accepted += 1;
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    return { accepted, skipped };
  });
  return tx(rows);
}

export type OtelTraceApiSpan = {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: number | null;
  start_time_unix_nano: string;
  end_time_unix_nano: string;
  status_code: string | null;
  status_message: string | null;
  attributes: Record<string, string | number | boolean>;
  resource_json: string;
  service_name: string | null;
  scope_name: string | null;
  trace_root_id: string | null;
  msg_id: string | null;
  event_id: string | null;
  created_at: string;
};

export function queryOtelTraceByTraceId(
  db: Database.Database,
  traceIdHex: string,
): { trace_id: string; spans: OtelTraceApiSpan[] } {
  const tid = traceIdHex.trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT span_id, parent_span_id, name, kind, start_time_unix_nano, end_time_unix_nano,
              status_code, status_message, attributes_json, resource_json, service_name, scope_name,
              trace_root_id, msg_id, event_id, created_at
       FROM otel_spans WHERE trace_id = ? ORDER BY start_time_unix_nano ASC, id ASC`,
    )
    .all(tid) as Array<Record<string, unknown>>;

  const spans: OtelTraceApiSpan[] = rows.map((r) => {
    let attributes: Record<string, string | number | boolean> = {};
    try {
      const parsed = JSON.parse(String(r.attributes_json ?? "{}")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        attributes = parsed as Record<string, string | number | boolean>;
      }
    } catch {
      attributes = {};
    }
    return {
      span_id: String(r.span_id ?? ""),
      parent_span_id: r.parent_span_id ? String(r.parent_span_id) : null,
      name: String(r.name ?? ""),
      kind: typeof r.kind === "number" ? r.kind : null,
      start_time_unix_nano: String(r.start_time_unix_nano ?? "0"),
      end_time_unix_nano: String(r.end_time_unix_nano ?? "0"),
      status_code: r.status_code != null ? String(r.status_code) : null,
      status_message: r.status_message != null ? String(r.status_message) : null,
      attributes,
      resource_json: String(r.resource_json ?? "{}"),
      service_name: r.service_name != null ? String(r.service_name) : null,
      scope_name: r.scope_name != null ? String(r.scope_name) : null,
      trace_root_id: r.trace_root_id != null ? String(r.trace_root_id) : null,
      msg_id: r.msg_id != null ? String(r.msg_id) : null,
      event_id: r.event_id != null ? String(r.event_id) : null,
      created_at: String(r.created_at ?? ""),
    };
  });

  return { trace_id: tid, spans };
}

export function resolveTraceIdByTraceRootId(db: Database.Database, traceRootId: string): string | null {
  const tr = traceRootId.trim();
  if (!tr) {
    return null;
  }
  const row = db
    .prepare(`SELECT trace_id FROM otel_spans WHERE trace_root_id = ? ORDER BY id ASC LIMIT 1`)
    .get(tr) as { trace_id: string } | undefined;
  return row?.trace_id ?? null;
}
