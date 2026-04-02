import { collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_API } from "@/lib/collector-api-paths";
import type { ObserveListSortParam } from "@/lib/observe-facets";
import { extractThreadListMessageText } from "@/lib/strip-inbound-meta";
import { loadTraceEvents } from "@/lib/trace-events";
import { buildUserTurnList } from "@/lib/user-turn-list";

export type ThreadRecordRow = {
  thread_id: string;
  workspace_name: string;
  project_name: string;
  first_seen_ms: number;
  last_seen_ms: number;
  metadata: Record<string, unknown>;
  agent_name?: string | null;
  channel_name?: string | null;
  trace_count: number;
  first_message_preview?: string | null;
  last_message_preview?: string | null;
  latest_input_preview?: string | null;
  total_tokens: number;
  total_cost?: number | null;
  duration_ms?: number | null;
  /** 本会话「最新一条 trace」的状态：running | success | error | timeout（无子 trace 时为 null） */
  status?: string | null;
};

export type LoadThreadRecordsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  search?: string;
  sinceMs?: number;
  untilMs?: number;
  /** Exact match on `channel_name`; omit or empty = no filter. */
  channel?: string;
  /** Exact match on `agent_name`; omit or empty = no filter. */
  agent?: string;
  sort?: ObserveListSortParam;
};

function coerceNonNegNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, v);
  }
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

function coercePositiveMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function normalizeThreadRecord(r: Record<string, unknown>): ThreadRecordRow {
  const meta = r.metadata;
  const tc = r.total_cost;
  const total_cost =
    typeof tc === "number" && Number.isFinite(tc) ? tc : tc === null ? null : Number(tc) || null;
  const duration_ms = coercePositiveMs(r.duration_ms);
  const st = r.status;
  const status =
    typeof st === "string" && ["running", "success", "error", "timeout"].includes(st.trim()) ? st.trim() : null;
  return {
    thread_id: String(r.thread_id ?? ""),
    workspace_name: String(r.workspace_name ?? "default"),
    project_name: String(r.project_name ?? "openclaw"),
    first_seen_ms: Number(r.first_seen_ms) || 0,
    last_seen_ms: Number(r.last_seen_ms) || 0,
    metadata: meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
    agent_name: typeof r.agent_name === "string" && r.agent_name.trim() ? r.agent_name.trim() : null,
    channel_name: typeof r.channel_name === "string" && r.channel_name.trim() ? r.channel_name.trim() : null,
    trace_count: Number(r.trace_count) || 0,
    first_message_preview: typeof r.first_message_preview === "string" ? r.first_message_preview : null,
    last_message_preview: typeof r.last_message_preview === "string" ? r.last_message_preview : null,
    latest_input_preview:
      typeof r.first_message_preview === "string" ? extractThreadListMessageText(r.first_message_preview) : null,
    total_tokens: coerceNonNegNumber(r.total_tokens),
    total_cost: total_cost != null && Number.isFinite(total_cost) ? total_cost : null,
    duration_ms,
    status,
  };
}

export function threadListHref(row: ThreadRecordRow): string {
  return `/traces?thread=${encodeURIComponent(row.thread_id)}`;
}

/** Stable id for selection / keys across workspace + project. */
export function threadRowStableId(row: ThreadRecordRow): string {
  return `${row.workspace_name}\u001f${row.project_name}\u001f${row.thread_id}`;
}

export async function loadThreadRecords(
  baseUrl: string,
  apiKey: string,
  params: LoadThreadRecordsParams = {},
): Promise<{ items: ThreadRecordRow[]; total: number }> {
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
  if (params.sort === "tokens") {
    sp.set("sort", "tokens");
  }
  const res = await fetch(`${b}${COLLECTOR_API.conversationList}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const j = (await res.json()) as { items?: Record<string, unknown>[]; total?: number };
  const items = (j.items ?? []).map(normalizeThreadRecord);
  const needLatestInput = items.filter((item) => item.trace_count > 1 && item.thread_id.trim().length > 0);
  if (needLatestInput.length > 0) {
    const enriched = await Promise.allSettled(
      needLatestInput.map(async (item) => {
        const ev = await loadTraceEvents(baseUrl, apiKey, item.thread_id);
        const turns = buildUserTurnList(ev.items ?? []);
        const latest = turns[turns.length - 1];
        return {
          threadId: item.thread_id,
          latestInputPreview: latest?.fullText?.trim() || latest?.preview?.trim() || item.latest_input_preview || "",
        };
      }),
    );
    const latestByThread = new Map<string, string>();
    for (const entry of enriched) {
      if (entry.status !== "fulfilled") {
        continue;
      }
      const text = entry.value.latestInputPreview.trim();
      if (text) {
        latestByThread.set(entry.value.threadId, text);
      }
    }
    for (const item of items) {
      item.latest_input_preview = latestByThread.get(item.thread_id) ?? item.latest_input_preview ?? null;
    }
  }
  const total = typeof j.total === "number" && Number.isFinite(j.total) ? Math.max(0, Math.floor(j.total)) : items.length;
  return { items, total };
}
