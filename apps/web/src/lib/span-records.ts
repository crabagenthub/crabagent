import { appendWorkspaceNameParam, collectorAuthHeaders } from "@/lib/collector";
import { readCollectorFetchResult } from "@/lib/collector-json";
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
  /** 与 Collector `parseUsageExtended(usage_json)` 一致；`total_tokens` 仍来自列表 SQL 表达式。 */
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
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
  /** 与 Collector `span_type` 一致：general | tool | llm | guardrail */
  spanType?: string;
  statuses?: ObserveListStatusParam[];
  sort?: ObserveListSortParam;
};

function parseRowStatus(raw: unknown): ObserveListStatusParam {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "running" || s === "success" || s === "error" || s === "timeout") {
    return s;
  }
  return "success";
}

/**
 * 优先使用入库的 `duration_ms`；若为空但起止时间齐全，则用墙钟差（与 execution-graph 的 spanWall 一致）。
 * 部分 OpenClaw/Opik 上报未写 `duration_ms` 时仍可展示耗时。
 */
function coalesceSpanDurationMs(
  rawDur: unknown,
  startMs: number | null,
  endMs: number | null,
): number | null {
  if (rawDur != null && rawDur !== "" && Number.isFinite(Number(rawDur))) {
    const d = Number(rawDur);
    if (d >= 0) {
      return d;
    }
  }
  if (startMs != null && endMs != null) {
    const a = Number(startMs);
    const b = Number(endMs);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      return b - a;
    }
  }
  return null;
}

function normalizeSpanRecord(r: Record<string, unknown>): SpanRecordRow {
  const pid = r.parent_span_id;
  const tt = r.total_tokens;
  const totalTokens =
    tt != null && tt !== "" && Number.isFinite(Number(tt)) ? Math.max(0, Math.floor(Number(tt))) : 0;
  const ag = r.agent_name;
  const ch = r.channel_name;
  const start_time_ms = r.start_time_ms != null && r.start_time_ms !== "" ? Number(r.start_time_ms) : null;
  const end_time_ms = r.end_time_ms != null && r.end_time_ms !== "" ? Number(r.end_time_ms) : null;
  return {
    span_id: String(r.span_id ?? ""),
    trace_id: String(r.trace_id ?? ""),
    parent_span_id: pid == null || String(pid).trim() === "" ? null : String(pid),
    name: String(r.name ?? ""),
    span_type: String(r.span_type ?? "general"),
    start_time_ms,
    end_time_ms,
    duration_ms: coalesceSpanDurationMs(r.duration_ms, start_time_ms, end_time_ms),
    model: r.model != null ? String(r.model) : null,
    provider: r.provider != null ? String(r.provider) : null,
    is_complete: Number(r.is_complete) === 1 || r.is_complete === true,
    input_preview: r.input_preview != null ? String(r.input_preview) : null,
    output_preview: r.output_preview != null ? String(r.output_preview) : null,
    thread_key: String(r.thread_key ?? r.trace_id ?? ""),
    workspace_name: String(r.workspace_name ?? "OpenClaw"),
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
    cache_read_tokens:
      r.cache_read_tokens != null && r.cache_read_tokens !== "" && Number.isFinite(Number(r.cache_read_tokens))
        ? Math.max(0, Math.floor(Number(r.cache_read_tokens)))
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
  if (params.spanType != null && params.spanType.trim().length > 0) {
    sp.set("span_type", params.spanType.trim().toLowerCase().slice(0, 32));
  }
  if (params.statuses != null && params.statuses.length > 0) {
    for (const s of params.statuses) {
      sp.append("status", s);
    }
  }
  if (params.sort === "tokens") {
    sp.set("sort", "tokens");
  }
  appendWorkspaceNameParam(sp);
  const res = await fetch(`${b}${COLLECTOR_API.spanList}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  const j = await readCollectorFetchResult<{ items?: Record<string, unknown>[]; total?: number | string | null }>(
    res,
    `span list HTTP ${res.status}`,
  );
  const rawItems = Array.isArray(j.items) ? j.items : [];
  const items = rawItems
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x))
    .map(normalizeSpanRecord);
  const st: unknown = j.total;
  const total =
    typeof st === "number" && Number.isFinite(st)
      ? Math.max(0, Math.floor(st))
      : typeof st === "string" && st.trim() !== "" && Number.isFinite(Number(st))
        ? Math.max(0, Math.floor(Number(st)))
        : items.length;
  return { items, total };
}
