import { collectorAuthHeaders } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
import type { TraceTimelineEvent } from "@/features/observe/traces/components/trace-timeline-tree";

/**
 * `/v1/traces/:threadId/events` 按会话树 scope 返回主 thread + 子代理 thread 的 trace；
 * 抽屉里「当前会话」只应展示本 thread 的消息，故按 `thread_id` 收窄。
 * 无 `thread_id` 的旧数据仍保留。
 */
export function filterTraceEventsToThreadKey(
  events: TraceTimelineEvent[],
  threadKey: string,
): TraceTimelineEvent[] {
  const k = threadKey.trim();
  if (!k) {
    return events;
  }
  return events.filter((e) => {
    const tid = e.thread_id;
    if (tid == null || String(tid).trim() === "") {
      return true;
    }
    return String(tid).trim() === k;
  });
}

export async function loadTraceEvents(
  baseUrl: string,
  apiKey: string,
  threadKey: string,
): Promise<{ items: TraceTimelineEvent[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${b}/v1/traces/${encodeURIComponent(threadKey)}/events`, {
    headers: collectorAuthHeaders(apiKey),
  });
  const body = await readCollectorFetchResult<{ items?: unknown }>(
    res,
    `trace events HTTP ${res.status}`,
  );
  return { items: collectorItemsArray<TraceTimelineEvent>(body.items) };
}
