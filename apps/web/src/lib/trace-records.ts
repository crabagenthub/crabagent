import { collectorAuthHeaders } from "@/lib/collector";

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
  thread_key: string;
  metadata: Record<string, unknown>;
  loop_count: number;
  tool_call_count: number;
  saved_tokens_total: number;
  optimization_rate_pct: number | null;
};

export type LoadTraceRecordsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  minTotalTokens?: number;
  minLoopCount?: number;
  minToolCalls?: number;
  search?: string;
};

export async function loadTraceRecords(
  baseUrl: string,
  apiKey: string,
  params: LoadTraceRecordsParams = {},
): Promise<{ items: TraceRecordRow[] }> {
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
  const res = await fetch(`${b}/v1/trace-records?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const j = (await res.json()) as { items?: TraceRecordRow[] };
  const items = (j.items ?? []).map(normalizeTraceRecord);
  return { items };
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
  return {
    ...r,
    total_tokens: spent,
    loop_count: typeof r.loop_count === "number" ? r.loop_count : 0,
    tool_call_count: typeof r.tool_call_count === "number" ? r.tool_call_count : 0,
    saved_tokens_total: savedRaw,
    optimization_rate_pct: pct,
    metadata: r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? r.metadata : {},
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
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  const d = b - a;
  return d >= 0 ? d : null;
}

function strMeta(m: Record<string, unknown>, key: string): string | null {
  const v = m[key];
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
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
    const t = raw.trim();
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

export type TraceStatusBand = "ERROR" | "WARNING" | "SUCCESS" | "RUNNING" | "OTHER";

/**
 * Display band: ERROR > token warning > SUCCESS > RUNNING.
 * `warnAtTokens`: rows with total_tokens >= this show WARNING (unless ERROR).
 */
export function traceRecordStatusBand(row: TraceRecordRow, warnAtTokens: number): TraceStatusBand {
  const u = String(row.status).trim().toUpperCase();
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
  if (band === "SUCCESS") {
    return t("statusSuccess");
  }
  if (band === "RUNNING") {
    return t("statusRunning");
  }
  return rawStatus.trim() || t("statusOther");
}
