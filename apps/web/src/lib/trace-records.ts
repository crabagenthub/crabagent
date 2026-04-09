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
  /** `opik_traces.trace_type`（external / subagent / async_command / system）。 */
  trace_type?: string;
  total_cost?: number | null;
  /** From `opik_traces.duration_ms` when present. */
  duration_ms?: number | null;
};

const ALLOWED_TRACE_TYPES = new Set(["external", "subagent", "async_command", "system"]);

/**
 * `opik_traces.trace_type` 应为四枚举之一；若出现 UUID 等异常值（错误写入、旧库无 CHECK），按 external 展示。
 */
function normalizeTraceTypeField(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v && ALLOWED_TRACE_TYPES.has(v)) {
    return v;
  }
  return "external";
}

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
    trace_type: normalizeTraceTypeField(r.trace_type),
  };
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }

  // < 60s：显示秒，保留3位小数
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(3)}s`;
  }

  // 先得到总秒（这里才取整）
  const s = Math.floor(ms / 1000);

  // < 60min：XmYs
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs > 0 ? `${m}m${rs}s` : `${m}m`;
  }

  // >= 1h：XhYm
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h${rm}m` : `${h}h`;
}

/**
 * 与 `trace-semantic-tree` 执行步骤卡片一致：`51.88 s`、`3 min 12.00 s` 等（用于会话抽屉左侧与语义树对齐）。
 */
export function formatDurationMsSemantic(durMs: number | null | undefined): string {
  if (durMs == null || !Number.isFinite(durMs) || durMs < 0) {
    return "—";
  }
  if (durMs < 1000) {
    return `${Math.round(durMs)} ms`;
  }
  if (durMs >= 60_000) {
    const totalSeconds = durMs / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes} min ${seconds.toFixed(2)} s`;
  }
  return `${(durMs / 1000).toFixed(2)} s`;
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

/** 影子审计：observe 模式下本会话将泄露的敏感处计数（来自插件写入 trace metadata）。 */
export function traceRecordShadowWouldLeak(row: TraceRecordRow): number | null {
  const v = row.metadata?.crabagent_shadow_would_leak;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return Math.floor(v);
  }
  return null;
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

/** 与 `openclaw-trace-plugin` 写入的 `metadata.openclaw_routing` 对齐。 */
export type TraceOpenclawRouting = {
  label?: string;
  kind?: string;
  thinking?: string;
  fast?: string;
  verbose?: string;
  reasoning?: string;
  max_context_tokens?: number;
};

function routingFieldToDisplay(v: unknown): string | undefined {
  if (typeof v === "boolean") {
    return v ? "true" : "false";
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(Math.trunc(v));
  }
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

export function traceRecordOpenclawRouting(row: TraceRecordRow): TraceOpenclawRouting | null {
  const raw = row.metadata.openclaw_routing;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const label = routingFieldToDisplay(o.label);
  const kind = routingFieldToDisplay(o.kind);
  const thinking = routingFieldToDisplay(o.thinking);
  const fast = routingFieldToDisplay(o.fast);
  const verbose = routingFieldToDisplay(o.verbose);
  const reasoning = routingFieldToDisplay(o.reasoning);
  const mct = o.max_context_tokens;
  const max_context_tokens =
    typeof mct === "number" && Number.isFinite(mct) && mct >= 0 ? Math.trunc(mct) : undefined;
  if (
    label === undefined &&
    kind === undefined &&
    thinking === undefined &&
    fast === undefined &&
    verbose === undefined &&
    reasoning === undefined &&
    max_context_tokens === undefined
  ) {
    return null;
  }
  return {
    ...(label !== undefined ? { label } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(fast !== undefined ? { fast } : {}),
    ...(verbose !== undefined ? { verbose } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(max_context_tokens !== undefined ? { max_context_tokens } : {}),
  };
}

/** 用于表格 `title` / 无障碍说明的多行文案（键名固定英文，值来自采集）。 */
export function formatTraceOpenclawRoutingDetailLines(
  r: TraceOpenclawRouting,
  labels: {
    label: string;
    kind: string;
    thinking: string;
    fast: string;
    verbose: string;
    reasoning: string;
    maxContextTokens: string;
  },
): string {
  const lines: string[] = [];
  if (r.label !== undefined) {
    lines.push(`${labels.label}: ${r.label}`);
  }
  if (r.kind !== undefined) {
    lines.push(`${labels.kind}: ${r.kind}`);
  }
  if (r.thinking !== undefined) {
    lines.push(`${labels.thinking}: ${r.thinking}`);
  }
  if (r.fast !== undefined) {
    lines.push(`${labels.fast}: ${r.fast}`);
  }
  if (r.verbose !== undefined) {
    lines.push(`${labels.verbose}: ${r.verbose}`);
  }
  if (r.reasoning !== undefined) {
    lines.push(`${labels.reasoning}: ${r.reasoning}`);
  }
  if (r.max_context_tokens !== undefined) {
    lines.push(`${labels.maxContextTokens}: ${r.max_context_tokens.toLocaleString()}`);
  }
  return lines.join("\n");
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
