import { collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_API } from "@/lib/collector-api-paths";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";
import { formatShortId } from "@/lib/utils";

export type TraceRecordRow = {
  trace_id: string;
  session_id: string | null;
  user_id: string | null;
  start_time: number;
  end_time: number | null;
  status: string;
  total_tokens: number;
  updated_at?: string | null;
  last_message_preview?: string | null;
  output_preview?: string | null;
  thread_key: string;
  metadata: Record<string, unknown>;
  loop_count: number;
  tool_call_count: number;
  saved_tokens_total: number;
  optimization_rate_pct: number | null;
  tags?: string[];
  total_cost?: number | null;
  /** From `opik_traces.duration_ms` when present. */
  duration_ms?: number | null;
};

export type LoadTraceRecordsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  minTotalTokens?: number;
  minLoopCount?: number;
  minToolCalls?: number;
  search?: string;
  /** Lower bound on trace `created_at_ms` (server-side filter). */
  sinceMs?: number;
  /** Upper bound on trace `created_at_ms` (server-side filter). */
  untilMs?: number;
  channel?: string;
  agent?: string;
  /** Sent as query `status`; trace list status bucket. */
  status?: ObserveListStatusParam;
  /** Primary sort: `time` (default) or `tokens`. */
  sort?: ObserveListSortParam;
};

export async function loadTraceRecords(
  baseUrl: string,
  apiKey: string,
  params: LoadTraceRecordsParams = {},
): Promise<{ items: TraceRecordRow[]; total: number }> {
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
  if (params.minTotalTokens != null && params.minTotalTokens > 0) {
    sp.set("min_total_tokens", String(Math.floor(params.minTotalTokens)));
  }
  if (params.minLoopCount != null && params.minLoopCount > 0) {
    sp.set("min_loop_count", String(Math.floor(params.minLoopCount)));
  }
  if (params.minToolCalls != null && params.minToolCalls > 0) {
    sp.set("min_tool_calls", String(Math.floor(params.minToolCalls)));
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
  const res = await fetch(`${b}${COLLECTOR_API.traceList}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const j = (await res.json()) as { items?: TraceRecordRow[]; total?: number };
  const items = (j.items ?? []).map(normalizeTraceRecord);
  const total = typeof j.total === "number" && Number.isFinite(j.total) ? Math.max(0, Math.floor(j.total)) : items.length;
  return { items, total };
}

function normalizeTraceRecord(r: TraceRecordRow): TraceRecordRow {
  const spent = typeof r.total_tokens === "number" ? r.total_tokens : 0;
  const savedRaw = typeof r.saved_tokens_total === "number" ? r.saved_tokens_total : 0;
  const denom = spent + savedRaw;
  const pct =
    typeof r.optimization_rate_pct === "number"
      ? r.optimization_rate_pct
      : denom > 0
        ? Math.round((savedRaw / denom) * 1000) / 10
        : null;
  const tags = Array.isArray(r.tags) ? r.tags.filter((x): x is string => typeof x === "string") : [];
  const tc = r.total_cost;
  const total_cost =
    typeof tc === "number" && Number.isFinite(tc) ? tc : tc === null ? null : Number(tc) || null;
  const duration_ms =
    typeof r.duration_ms === "number" && Number.isFinite(r.duration_ms) && r.duration_ms >= 0
      ? r.duration_ms
      : null;
  return {
    ...r,
    total_tokens: spent,
    loop_count: typeof r.loop_count === "number" ? r.loop_count : 0,
    tool_call_count: typeof r.tool_call_count === "number" ? r.tool_call_count : 0,
    saved_tokens_total: savedRaw,
    optimization_rate_pct: pct,
    metadata: r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? r.metadata : {},
    tags,
    total_cost: total_cost != null && Number.isFinite(total_cost) ? total_cost : null,
    duration_ms: duration_ms != null ? duration_ms : null,
    output_preview: typeof r.output_preview === "string" ? r.output_preview : null,
  };
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return "<1s";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 120) {
    return rs > 0 ? `${m}m${rs}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h${rm}m` : `${h}h`;
}

export function traceRecordDurationMs(row: TraceRecordRow): number | null {
  const a = row.start_time;
  const b = row.end_time;
  if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b)) {
    const d = b - a;
    if (d > 0) {
      return d;
    }
  }
  const col = row.duration_ms;
  if (typeof col === "number" && Number.isFinite(col) && col > 0) {
    return col;
  }
  return null;
}

function strMeta(m: Record<string, unknown>, key: string): string | null {
  const v = m[key];
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Short line for session / thread identity in list cards (avoids over-wide monospace in tables). */
export function formatTraceRecordSessionLine(row: TraceRecordRow): string {
  const sid = row.session_id?.trim();
  if (sid) {
    return formatShortId(sid);
  }
  const tk = row.thread_key?.trim();
  if (tk) {
    return formatShortId(tk);
  }
  return "—";
}

export function traceRecordChatTitle(row: TraceRecordRow): string | null {
  return strMeta(row.metadata, "chat_title");
}

export function traceRecordAgentName(row: TraceRecordRow): string | null {
  return strMeta(row.metadata, "agent_name") ?? strMeta(row.metadata, "agent_id");
}

export function traceRecordChannel(row: TraceRecordRow): string | null {
  return strMeta(row.metadata, "channel");
}

/** Short task preview: first user message snippet or chat title. */
export function traceRecordTaskSummary(row: TraceRecordRow, maxChars = 96): string {
  const raw = row.last_message_preview;
  if (typeof raw === "string") {
    const t = extractInboundDisplayPreview(raw).trim();
    if (t.length > 0) {
      return t.length <= maxChars ? t : `${t.slice(0, maxChars - 1)}…`;
    }
  }
  const title = traceRecordChatTitle(row);
  if (title) {
    return title.length <= maxChars ? title : `${title.slice(0, maxChars - 1)}…`;
  }
  return "—";
}

export function formatOptimizationRate(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) {
    return "—";
  }
  return `${pct}%`;
}

export type TraceStatusBand = "ERROR" | "TIMEOUT" | "WARNING" | "SUCCESS" | "RUNNING" | "OTHER";

/** API `status` on list rows: running | success | error | timeout */
export function traceListStatusBandFromApiStatus(raw: string | null | undefined): TraceStatusBand {
  const u = String(raw ?? "").trim().toLowerCase();
  if (u === "running") {
    return "RUNNING";
  }
  if (u === "success") {
    return "SUCCESS";
  }
  if (u === "timeout") {
    return "TIMEOUT";
  }
  if (u === "error") {
    return "ERROR";
  }
  return "OTHER";
}

/**
 * Display band: TIMEOUT/ERROR > token warning > SUCCESS > RUNNING.
 * `warnAtTokens`: rows with total_tokens >= this show WARNING (unless ERROR/TIMEOUT).
 */
export function traceRecordStatusBand(row: TraceRecordRow, warnAtTokens: number): TraceStatusBand {
  const u = String(row.status).trim().toUpperCase();
  if (u === "TIMEOUT") {
    return "TIMEOUT";
  }
  if (u === "ERROR") {
    return "ERROR";
  }
  const tokens = typeof row.total_tokens === "number" ? row.total_tokens : 0;
  if (Number.isFinite(warnAtTokens) && warnAtTokens > 0 && tokens >= warnAtTokens) {
    return "WARNING";
  }
  if (u === "SUCCESS") {
    return "SUCCESS";
  }
  if (u === "RUNNING") {
    return "RUNNING";
  }
  return "OTHER";
}

export function statusBandPillClass(band: TraceStatusBand): string {
  switch (band) {
    case "ERROR":
      return "bg-red-500/15 text-red-800 ring-1 ring-red-500/25";
    case "TIMEOUT":
      return "bg-violet-500/15 text-violet-950 ring-1 ring-violet-500/30";
    case "WARNING":
      return "bg-amber-400/25 text-amber-950 ring-1 ring-amber-500/35";
    case "SUCCESS":
      return "bg-emerald-500/15 text-emerald-900 ring-1 ring-emerald-500/25";
    case "RUNNING":
      return "bg-sky-500/15 text-sky-950 ring-1 ring-sky-500/30";
    default:
      return "bg-neutral-500/10 text-neutral-800 ring-1 ring-neutral-400/25";
  }
}

export function statusBandLabel(
  band: TraceStatusBand,
  rawStatus: string,
  t: (key: string) => string,
): string {
  if (band === "WARNING") {
    return t("statusWarningTokens");
  }
  if (band === "ERROR") {
    return t("statusError");
  }
  if (band === "TIMEOUT") {
    return t("statusTimeout");
  }
  if (band === "SUCCESS") {
    return t("statusSuccess");
  }
  if (band === "RUNNING") {
    return t("statusRunning");
  }
  return rawStatus.trim() || t("statusOther");
}
