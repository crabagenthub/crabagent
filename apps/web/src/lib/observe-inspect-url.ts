import { loadSpanRecords, type SpanRecordRow } from "@/lib/span-records";
import { loadThreadRecords, type ThreadRecordRow } from "@/lib/thread-records";
import { loadTraceRecords, type TraceRecordRow } from "@/lib/trace-records";

/** URL 查询键：会话 thread_id、消息 trace_id、执行步骤 span_id（与观测列表抽屉联动，非独立页面）。 */
export const OBSERVE_INSPECT_QUERY = {
  thread: "thread",
  trace: "trace",
  span: "span",
} as const;

export type ObserveInspectPick =
  | { kind: "thread"; id: string }
  | { kind: "trace"; id: string }
  | { kind: "span"; id: string };

/**
 * 同一条链接只认一个抽屉：`span` > `trace` > `thread`。
 * 使用 decodeURIComponent 兼容浏览器已编码的 id。
 */
export function pickObserveInspectFromSearchParams(searchParams: URLSearchParams): ObserveInspectPick | null {
  const rawSpan = searchParams.get(OBSERVE_INSPECT_QUERY.span)?.trim();
  const rawTrace = searchParams.get(OBSERVE_INSPECT_QUERY.trace)?.trim();
  const rawThread = searchParams.get(OBSERVE_INSPECT_QUERY.thread)?.trim();
  try {
    if (rawSpan) {
      return { kind: "span", id: decodeURIComponent(rawSpan) };
    }
    if (rawTrace) {
      return { kind: "trace", id: decodeURIComponent(rawTrace) };
    }
    if (rawThread) {
      return { kind: "thread", id: decodeURIComponent(rawThread) };
    }
  } catch {
    return null;
  }
  return null;
}

/** 保留列表筛选等参数，仅替换或清除 thread/trace/span。值应为已编码或纯 ASCII id（见 {@link buildObserveQueryForPick}）。 */
export function buildObserveQueryPreservingFilters(
  searchParams: URLSearchParams,
  inspect: { thread?: string; trace?: string; span?: string } | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  searchParams.forEach((v, k) => {
    if (k === OBSERVE_INSPECT_QUERY.thread || k === OBSERVE_INSPECT_QUERY.trace || k === OBSERVE_INSPECT_QUERY.span) {
      return;
    }
    out[k] = v;
  });
  if (inspect?.thread) {
    out[OBSERVE_INSPECT_QUERY.thread] = inspect.thread;
  } else if (inspect?.trace) {
    out[OBSERVE_INSPECT_QUERY.trace] = inspect.trace;
  } else if (inspect?.span) {
    out[OBSERVE_INSPECT_QUERY.span] = inspect.span;
  }
  return out;
}

/** 在保留筛选的前提下，仅保留一个 inspect 参数（id 会 encode）。 */
export function buildObserveQueryForPick(
  searchParams: URLSearchParams,
  pick: ObserveInspectPick | null,
): Record<string, string> {
  const base = buildObserveQueryPreservingFilters(searchParams, null);
  if (!pick) {
    return base;
  }
  if (pick.kind === "thread") {
    base[OBSERVE_INSPECT_QUERY.thread] = encodeURIComponent(pick.id);
  } else if (pick.kind === "trace") {
    base[OBSERVE_INSPECT_QUERY.trace] = encodeURIComponent(pick.id);
  } else {
    base[OBSERVE_INSPECT_QUERY.span] = encodeURIComponent(pick.id);
  }
  return base;
}

/** 不按时间过滤，便于深链接命中历史会话/消息。 */
export async function resolveThreadRowForInspect(
  baseUrl: string,
  apiKey: string,
  threadId: string,
): Promise<ThreadRecordRow | null> {
  const { items } = await loadThreadRecords(baseUrl, apiKey, {
    search: threadId,
    limit: 100,
    offset: 0,
    order: "desc",
  });
  return items.find((r) => r.thread_id === threadId) ?? null;
}

export async function resolveTraceRowForInspect(
  baseUrl: string,
  apiKey: string,
  traceId: string,
): Promise<TraceRecordRow | null> {
  const { items } = await loadTraceRecords(baseUrl, apiKey, {
    search: traceId,
    limit: 100,
    offset: 0,
    order: "desc",
  });
  return items.find((r) => r.trace_id === traceId) ?? null;
}

export async function resolveSpanRowForInspect(
  baseUrl: string,
  apiKey: string,
  spanId: string,
): Promise<SpanRecordRow | null> {
  const { items } = await loadSpanRecords(baseUrl, apiKey, {
    search: spanId,
    limit: 100,
    offset: 0,
    order: "desc",
  });
  return items.find((r) => r.span_id === spanId) ?? null;
}
