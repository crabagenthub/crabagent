import { collectorAuthHeaders } from "@/lib/collector";
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";

export async function loadTraceEvents(
  baseUrl: string,
  apiKey: string,
  threadKey: string,
): Promise<{ items: TraceTimelineEvent[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${b}/v1/traces/${encodeURIComponent(threadKey)}/events`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<{ items: TraceTimelineEvent[] }>;
}
