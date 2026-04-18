import { collectorAuthHeaders } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";

export type TraceMessageRow = {
  id?: number;
  event_id?: string | null;
  msg_id?: string | null;
  thread_key?: string | null;
  trace_root_id?: string | null;
  session_id?: string | null;
  session_key?: string | null;
  channel?: string | null;
  chat_title?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  created_at?: string | null;
  client_ts?: string | number | null;
  message_preview?: string | null;
};

export type LoadTraceMessagesParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  search?: string;
};

export async function loadTraceMessages(
  baseUrl: string,
  apiKey: string,
  params: LoadTraceMessagesParams = {},
): Promise<{ items: TraceMessageRow[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  const limit = params.limit ?? 100;
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
  const res = await fetch(`${b}/v1/trace-messages?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  const j = await readCollectorFetchResult<{ items?: TraceMessageRow[] }>(
    res,
    `trace-messages HTTP ${res.status}`,
  );
  return { items: collectorItemsArray<TraceMessageRow>(j.items) };
}

export function traceMessagePreviewText(row: TraceMessageRow, maxChars: number): string {
  const raw = typeof row.message_preview === "string" ? row.message_preview : "";
  const cleaned = extractInboundDisplayPreview(raw);
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxChars)}…`;
}

export function traceMessageTimeIso(row: TraceMessageRow): string | null {
  const csRaw = row.client_ts;
  if (typeof csRaw === "number" && Number.isFinite(csRaw)) {
    return new Date(csRaw).toISOString();
  }
  const cs = typeof csRaw === "string" ? csRaw.trim() : "";
  if (cs) {
    return cs;
  }
  const cr = typeof row.created_at === "string" ? row.created_at.trim() : "";
  return cr || null;
}
