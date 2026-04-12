import { collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_API } from "@/lib/collector-api-paths";

export type ResourceAuditSemanticClassParam = "all" | "file" | "memory" | "tool_io";

export type ResourceAuditEventRow = {
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

export type ResourceAuditStatsSummary = {
  total_events: number;
  distinct_traces: number;
  sum_chars: number | null;
  avg_duration_ms: number | null;
  risk_sensitive_path: number;
  risk_pii_hint: number;
  risk_large_read: number;
  risk_redundant_read: number;
  risk_any: number;
};

export type ResourceAuditStats = {
  summary: ResourceAuditStatsSummary;
  top_resources: {
    uri: string;
    count: number;
    sum_chars: number | null;
    avg_duration_ms: number | null;
  }[];
  class_distribution: { semantic_class: string; count: number }[];
  daily_io: {
    day: string;
    event_count: number;
    avg_duration_ms: number | null;
  }[];
  top_tools: { span_name: string; count: number }[];
  by_workspace: { workspace_name: string; count: number }[];
};

const EMPTY_SUMMARY: ResourceAuditStatsSummary = {
  total_events: 0,
  distinct_traces: 0,
  sum_chars: null,
  avg_duration_ms: null,
  risk_sensitive_path: 0,
  risk_pii_hint: 0,
  risk_large_read: 0,
  risk_redundant_read: 0,
  risk_any: 0,
};

function parseSummary(v: unknown): ResourceAuditStatsSummary {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ...EMPTY_SUMMARY };
  }
  const o = v as Record<string, unknown>;
  return {
    total_events: Number(o.total_events ?? 0),
    distinct_traces: Number(o.distinct_traces ?? 0),
    sum_chars:
      o.sum_chars != null && o.sum_chars !== "" && Number.isFinite(Number(o.sum_chars))
        ? Number(o.sum_chars)
        : null,
    avg_duration_ms:
      o.avg_duration_ms != null && o.avg_duration_ms !== "" && Number.isFinite(Number(o.avg_duration_ms))
        ? Number(o.avg_duration_ms)
        : null,
    risk_sensitive_path: Number(o.risk_sensitive_path ?? 0),
    risk_pii_hint: Number(o.risk_pii_hint ?? 0),
    risk_large_read: Number(o.risk_large_read ?? 0),
    risk_redundant_read: Number(o.risk_redundant_read ?? 0),
    risk_any: Number(o.risk_any ?? 0),
  };
}

function normalizeStatsPayload(raw: unknown): ResourceAuditStats {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      summary: { ...EMPTY_SUMMARY },
      top_resources: [],
      class_distribution: [],
      daily_io: [],
      top_tools: [],
      by_workspace: [],
    };
  }
  const o = raw as Record<string, unknown>;
  const top_resources = Array.isArray(o.top_resources)
    ? (o.top_resources as Record<string, unknown>[]).map((r) => ({
        uri: String(r.uri ?? ""),
        count: Number(r.count ?? 0),
        sum_chars:
          r.sum_chars != null && r.sum_chars !== "" && Number.isFinite(Number(r.sum_chars))
            ? Number(r.sum_chars)
            : null,
        avg_duration_ms:
          r.avg_duration_ms != null && r.avg_duration_ms !== "" && Number.isFinite(Number(r.avg_duration_ms))
            ? Number(r.avg_duration_ms)
            : null,
      }))
    : [];
  const class_distribution = Array.isArray(o.class_distribution)
    ? (o.class_distribution as Record<string, unknown>[]).map((r) => ({
        semantic_class: String(r.semantic_class ?? ""),
        count: Number(r.count ?? 0),
      }))
    : [];
  const daily_io = Array.isArray(o.daily_io)
    ? (o.daily_io as Record<string, unknown>[]).map((r) => ({
        day: String(r.day ?? ""),
        event_count: Number(r.event_count ?? r.n ?? 0),
        avg_duration_ms:
          r.avg_duration_ms != null && r.avg_duration_ms !== "" && Number.isFinite(Number(r.avg_duration_ms))
            ? Number(r.avg_duration_ms)
            : null,
      }))
    : [];
  const top_tools = Array.isArray(o.top_tools)
    ? (o.top_tools as Record<string, unknown>[]).map((r) => ({
        span_name: String(r.span_name ?? ""),
        count: Number(r.count ?? 0),
      }))
    : [];
  const by_workspace = Array.isArray(o.by_workspace)
    ? (o.by_workspace as Record<string, unknown>[]).map((r) => ({
        workspace_name: String(r.workspace_name ?? ""),
        count: Number(r.count ?? 0),
      }))
    : [];

  return {
    summary: parseSummary(o.summary),
    top_resources,
    class_distribution,
    daily_io,
    top_tools,
    by_workspace,
  };
}

export type LoadResourceAuditEventsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  search?: string;
  sinceMs?: number;
  untilMs?: number;
  semantic_class?: ResourceAuditSemanticClassParam;
  uri_prefix?: string;
  trace_id?: string;
  span_id?: string;
};

function normalizeEvent(r: Record<string, unknown>): ResourceAuditEventRow {
  const flags = r.risk_flags;
  const risk_flags = Array.isArray(flags) ? flags.map((x) => String(x)) : [];
  return {
    span_id: String(r.span_id ?? ""),
    trace_id: String(r.trace_id ?? ""),
    thread_key: String(r.thread_key ?? ""),
    workspace_name: String(r.workspace_name ?? ""),
    project_name: String(r.project_name ?? ""),
    span_name: String(r.span_name ?? ""),
    span_type: String(r.span_type ?? ""),
    started_at_ms: Number(r.started_at_ms ?? 0),
    duration_ms:
      r.duration_ms != null && r.duration_ms !== "" && Number.isFinite(Number(r.duration_ms))
        ? Number(r.duration_ms)
        : null,
    resource_uri: String(r.resource_uri ?? ""),
    access_mode: r.access_mode != null ? String(r.access_mode) : null,
    chars:
      r.chars != null && r.chars !== "" && Number.isFinite(Number(r.chars)) ? Number(r.chars) : null,
    snippet: r.snippet != null ? String(r.snippet) : null,
    semantic_class: String(r.semantic_class ?? ""),
    uri_repeat_count: Number(r.uri_repeat_count ?? 0) || 0,
    risk_flags,
  };
}

export async function loadResourceAuditEvents(
  baseUrl: string,
  apiKey: string,
  params: LoadResourceAuditEventsParams,
): Promise<{ items: ResourceAuditEventRow[]; total: number }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit ?? 100));
  sp.set("offset", String(params.offset ?? 0));
  sp.set("order", params.order ?? "desc");
  if (params.search?.trim()) {
    sp.set("search", params.search.trim());
  }
  if (params.sinceMs != null && params.sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(params.sinceMs)));
  }
  if (params.untilMs != null && params.untilMs > 0) {
    sp.set("until_ms", String(Math.floor(params.untilMs)));
  }
  if (params.semantic_class && params.semantic_class !== "all") {
    sp.set("semantic_class", params.semantic_class);
  }
  if (params.uri_prefix?.trim()) {
    sp.set("uri_prefix", params.uri_prefix.trim());
  }
  if (params.trace_id?.trim()) {
    sp.set("trace_id", params.trace_id.trim());
  }
  if (params.span_id?.trim()) {
    sp.set("span_id", params.span_id.trim());
  }
  const res = await fetch(`${b}${COLLECTOR_API.resourceAuditEvents}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const raw = (await res.json()) as { items?: unknown[]; total?: number };
  const items = (raw.items ?? []).map((x) =>
    normalizeEvent(x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {}),
  );
  return { items, total: Number(raw.total ?? 0) };
}

export async function loadResourceAuditStats(
  baseUrl: string,
  apiKey: string,
  params: Omit<LoadResourceAuditEventsParams, "limit" | "offset" | "order">,
): Promise<ResourceAuditStats> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  if (params.search?.trim()) {
    sp.set("search", params.search.trim());
  }
  if (params.sinceMs != null && params.sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(params.sinceMs)));
  }
  if (params.untilMs != null && params.untilMs > 0) {
    sp.set("until_ms", String(Math.floor(params.untilMs)));
  }
  if (params.semantic_class && params.semantic_class !== "all") {
    sp.set("semantic_class", params.semantic_class);
  }
  if (params.uri_prefix?.trim()) {
    sp.set("uri_prefix", params.uri_prefix.trim());
  }
  if (params.trace_id?.trim()) {
    sp.set("trace_id", params.trace_id.trim());
  }
  if (params.span_id?.trim()) {
    sp.set("span_id", params.span_id.trim());
  }
  const res = await fetch(`${b}${COLLECTOR_API.resourceAuditStats}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = await res.json();
  return normalizeStatsPayload(json);
}
