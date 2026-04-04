import { collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_API } from "@/lib/collector-api-paths";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";

export type SpanRecordRow = {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  span_type: string;
  start_time_ms: number | null;
  end_time_ms: number | null;
  duration_ms: number | null;
  model: string | null;
  provider: string | null;
  is_complete: boolean;
  input_preview: string | null;
  output_preview: string | null;
  thread_key: string;
  workspace_name: string;
  project_name: string;
  agent_name: string | null;
  channel_name: string | null;
  total_tokens: number;
  /** When collector returns token split (optional). */
  prompt_tokens: number;
  completion_tokens: number;
  list_status: ObserveListStatusParam;
};

export type LoadSpanRecordsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  search?: string;
  sinceMs?: number;
  untilMs?: number;
  channel?: string;
  agent?: string;
  status?: ObserveListStatusParam;
  sort?: ObserveListSortParam;
};

function parseRowStatus(raw: unknown): ObserveListStatusParam {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "running" || s === "success" || s === "error" || s === "timeout") {
    return s;
  }
  return "success";
}

function normalizeSpanRecord(r: Record<string, unknown>): SpanRecordRow {
  const pid = r.parent_span_id;
  const dur = r.duration_ms;
  const tt = r.total_tokens;
  const totalTokens =
    tt != null && tt !== "" && Number.isFinite(Number(tt)) ? Math.max(0, Math.floor(Number(tt))) : 0;
  const ag = r.agent_name;
  const ch = r.channel_name;
  return {
    span_id: String(r.span_id ?? ""),
    trace_id: String(r.trace_id ?? ""),
    parent_span_id: pid == null || String(pid).trim() === "" ? null : String(pid),
    name: String(r.name ?? ""),
    span_type: String(r.span_type ?? "general"),
    start_time_ms: r.start_time_ms != null && r.start_time_ms !== "" ? Number(r.start_time_ms) : null,
    end_time_ms: r.end_time_ms != null && r.end_time_ms !== "" ? Number(r.end_time_ms) : null,
    duration_ms: dur != null && dur !== "" && Number.isFinite(Number(dur)) ? Number(dur) : null,
    model: r.model != null ? String(r.model) : null,
    provider: r.provider != null ? String(r.provider) : null,
    is_complete: Number(r.is_complete) === 1 || r.is_complete === true,
    input_preview: r.input_preview != null ? String(r.input_preview) : null,
    output_preview: r.output_preview != null ? String(r.output_preview) : null,
    thread_key: String(r.thread_key ?? r.trace_id ?? ""),
    workspace_name: String(r.workspace_name ?? "default"),
    project_name: String(r.project_name ?? "openclaw"),
    agent_name: ag != null && String(ag).trim() !== "" ? String(ag) : null,
    channel_name: ch != null && String(ch).trim() !== "" ? String(ch) : null,
    total_tokens: totalTokens,
    prompt_tokens:
      r.prompt_tokens != null && r.prompt_tokens !== "" && Number.isFinite(Number(r.prompt_tokens))
        ? Math.max(0, Math.floor(Number(r.prompt_tokens)))
        : 0,
    completion_tokens:
      r.completion_tokens != null && r.completion_tokens !== "" && Number.isFinite(Number(r.completion_tokens))
        ? Math.max(0, Math.floor(Number(r.completion_tokens)))
        : 0,
    list_status: parseRowStatus(r.list_status),
  };
}

export function spanThreadHref(threadKey: string): string {
  return `/traces?thread=${encodeURIComponent(threadKey)}`;
}

export function formatSpanDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = (ms % 60_000) / 1000;
  return `${m}m ${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

export async function loadSpanRecords(
  baseUrl: string,
  apiKey: string,
  params: LoadSpanRecordsParams = {},
): Promise<{ items: SpanRecordRow[]; total: number }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  const limit = params.limit ?? 200;
  sp.set("limit", String(limit));
  if (params.offset != null && params.offset > 0) {
    sp.set("offset", String(params.offset));
  }
  if (params.order === "asc") {
    sp.set("order", "asc");
  }
  if (params.search != null && params.search.trim().length > 0) {
    sp.set("search", params.search.trim().slice(0, 200));
  }
  if (params.sinceMs != null && params.sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(params.sinceMs)));
  }
  if (params.untilMs != null && params.untilMs > 0) {
    sp.set("until_ms", String(Math.floor(params.untilMs)));
  }
  if (params.channel != null && params.channel.trim().length > 0) {
    sp.set("channel", params.channel.trim().slice(0, 200));
  }
  if (params.agent != null && params.agent.trim().length > 0) {
    sp.set("agent", params.agent.trim().slice(0, 200));
  }
  if (params.status != null && params.status.length > 0) {
    sp.set("status", params.status);
  }
  if (params.sort === "tokens") {
    sp.set("sort", "tokens");
  }
  const res = await fetch(`${b}${COLLECTOR_API.spanList}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const j = (await res.json()) as { items?: Record<string, unknown>[]; total?: number };
  const items = (j.items ?? []).map(normalizeSpanRecord);
  const total = typeof j.total === "number" && Number.isFinite(j.total) ? Math.max(0, Math.floor(j.total)) : items.length;
  return { items, total };
}
