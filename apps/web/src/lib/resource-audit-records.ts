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
  relevance_max: number | null;
  uri_repeat_count: number;
  risk_flags: string[];
};

export type ResourceAuditStats = {
  top_resources: {
    uri: string;
    count: number;
    sum_chars: number | null;
    avg_duration_ms: number | null;
  }[];
  class_distribution: { semantic_class: string; count: number }[];
  daily_io: { day: string; event_count: number; avg_duration_ms: number | null }[];
};

export type LoadResourceAuditEventsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  search?: string;
  sinceMs?: number;
  untilMs?: number;
  semantic_class?: ResourceAuditSemanticClassParam;
  uri_prefix?: string;
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
    relevance_max:
      r.relevance_max != null && r.relevance_max !== "" && Number.isFinite(Number(r.relevance_max))
        ? Number(r.relevance_max)
        : null,
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
  const res = await fetch(`${b}${COLLECTOR_API.resourceAuditStats}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as ResourceAuditStats;
}
