import type { SpanRecordRow } from "@/lib/span-records";
import type { TraceRecordRow } from "@/lib/trace-records";

const PAGE = 500;

function dayKeyLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 模型 QPS / QPM：按 Trace `status` 过滤后按本地日聚合条数（与总览其它按日图一致） */
export type OverviewModelQpsStatusFilter = "all" | "success" | "fail";

export function traceCountByDayForModelQps(
  traces: TraceRecordRow[],
  filter: OverviewModelQpsStatusFilter,
): { day: string; n: number }[] {
  const list =
    filter === "all"
      ? traces
      : filter === "success"
        ? traces.filter((t) => String(t.status ?? "").toLowerCase() === "success")
        : traces.filter((t) => String(t.status ?? "").toLowerCase() !== "success");
  const traceByDay = new Map<string, number>();
  for (const t of list) {
    const k = dayKeyLocal(t.start_time);
    traceByDay.set(k, (traceByDay.get(k) ?? 0) + 1);
  }
  const daysSorted = [...traceByDay.keys()].sort();
  return daysSorted.map((day) => ({ day, n: traceByDay.get(day)! }));
}

export async function loadPagedTraces(
  baseUrl: string,
  apiKey: string,
  fetchPage: typeof import("@/lib/trace-records").loadTraceRecords,
  sinceMs: number,
  untilMs: number,
  cap = 2500,
): Promise<{ items: TraceRecordRow[]; total: number }> {
  const items: TraceRecordRow[] = [];
  let total = 0;
  for (let offset = 0; offset < cap; offset += PAGE) {
    const batch = await fetchPage(baseUrl, apiKey, {
      limit: PAGE,
      offset,
      sinceMs,
      untilMs,
      order: "desc",
    });
    if (offset === 0) {
      total = batch.total;
    }
    items.push(...batch.items);
    if (batch.items.length < PAGE || items.length >= cap) {
      break;
    }
  }
  return { items, total };
}

export async function loadPagedSpans(
  baseUrl: string,
  apiKey: string,
  fetchPage: typeof import("@/lib/span-records").loadSpanRecords,
  sinceMs: number,
  untilMs: number,
  cap = 2500,
): Promise<{ items: SpanRecordRow[]; total: number }> {
  const items: SpanRecordRow[] = [];
  let total = 0;
  for (let offset = 0; offset < cap; offset += PAGE) {
    const batch = await fetchPage(baseUrl, apiKey, {
      limit: PAGE,
      offset,
      sinceMs,
      untilMs,
      order: "desc",
    });
    if (offset === 0) {
      total = batch.total;
    }
    items.push(...batch.items);
    if (batch.items.length < PAGE || items.length >= cap) {
      break;
    }
  }
  return { items, total };
}

export type OverviewKpis = {
  usageCount: number;
  spanErrorRatePct: number;
  modelCallErrorRatePct: number;
  modelErrorCount: number;
  avgModelCallMs: number;
  totalTokens: number;
  toolCallCount: number;
  toolErrorRatePct: number;
  toolErrorCount: number;
  avgToolCallMs: number;
  momUsage: number | null;
  momTokens: number | null;
  momToolCalls: number | null;
};

export type NamedPct = { name: string; value: number; pct: number };

export type OverviewCharts = {
  tokensByDay: { day: string; inputWan: number; outputWan: number; total: number }[];
  traceCountByDay: { day: string; n: number }[];
  modelSuccessByDay: { day: string; rate: number }[];
  modelTokenRateByDay: { day: string; tps: number }[];
  modelDurationSumByDay: { day: string; ms: number }[];
  toolVolumeByDay: { day: string; n: number }[];
  toolLatencyByDay: { day: string; avgMs: number }[];
  toolSuccessByDay: { day: string; rate: number }[];
  agentStepsByDay: { day: string; avg: number }[];
  agentToolsByDay: { day: string; avg: number }[];
  agentModelsByDay: { day: string; avg: number }[];
  traceReportByDay: { day: string; n: number }[];
  uniqueThreadsByDay: { day: string; n: number }[];
  serviceQpsByDay: { day: string; qps: number }[];
  serviceLatencyByDay: { day: string; avgMs: number }[];
  serviceSuccessByDay: { day: string; rate: number }[];
  modelDistribution: NamedPct[];
  toolDistribution: NamedPct[];
  ttftByDay: { day: string; ms: number }[];
  tpotByDay: { day: string; ms: number }[];
};

function pct(prev: number, cur: number): number | null {
  if (prev <= 0) {
    return cur > 0 ? 100 : null;
  }
  return ((cur - prev) / prev) * 100;
}

function isErrorStatus(s: string): boolean {
  return s === "error" || s === "timeout";
}

/** Apply filter: traces belong to threads that have an LLM span with selected model. */
export function filterByModel(
  traces: TraceRecordRow[],
  spans: SpanRecordRow[],
  model: string | null,
): { traces: TraceRecordRow[]; spans: SpanRecordRow[] } {
  if (model == null || model === "" || model === "__all__") {
    return { traces, spans };
  }
  const traceIds = new Set(
    spans.filter((s) => s.span_type === "llm" && s.model === model).map((s) => s.trace_id),
  );
  return {
    traces: traces.filter((t) => traceIds.has(t.trace_id)),
    spans: spans.filter((s) => traceIds.has(s.trace_id)),
  };
}

export function collectModelOptions(spans: SpanRecordRow[]): string[] {
  const set = new Set<string>();
  for (const s of spans) {
    if (s.span_type === "llm" && s.model != null && s.model.trim()) {
      set.add(s.model.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function buildOverview(
  traces: TraceRecordRow[],
  spans: SpanRecordRow[],
  traceTotalFull: number,
  prevTraceTotal?: number,
  prevTokenSum?: number,
  prevToolCallsSum?: number,
  /** 按模型筛选时用样本内 trace 数；未传则用 `traceTotalFull`（Collector 总条数）。 */
  usageCountOverride?: number,
): { kpis: OverviewKpis; charts: OverviewCharts } {
  const llmSpans = spans.filter((s) => s.span_type === "llm");
  const toolSpans = spans.filter((s) => s.span_type === "tool");

  const spanErr = spans.filter((s) => isErrorStatus(s.list_status)).length;
  const spanErrorRatePct = spans.length > 0 ? (spanErr / spans.length) * 100 : 0;

  const llmErr = llmSpans.filter((s) => isErrorStatus(s.list_status)).length;
  const modelCallErrorRatePct = llmSpans.length > 0 ? (llmErr / llmSpans.length) * 100 : 0;

  const llmDurs = llmSpans.map((s) => s.duration_ms).filter((x): x is number => x != null && x >= 0);
  const avgModelCallMs =
    llmDurs.length > 0 ? llmDurs.reduce((a, b) => a + b, 0) / llmDurs.length : 0;

  const totalTokens = traces.reduce((a, t) => a + (typeof t.total_tokens === "number" ? t.total_tokens : 0), 0);

  const toolCallCount = traces.reduce(
    (a, t) => a + (typeof t.tool_call_count === "number" ? t.tool_call_count : 0),
    0,
  );

  const toolErr = toolSpans.filter((s) => isErrorStatus(s.list_status)).length;
  const toolErrorRatePct = toolSpans.length > 0 ? (toolErr / toolSpans.length) * 100 : 0;

  const toolDurs = toolSpans.map((s) => s.duration_ms).filter((x): x is number => x != null && x >= 0);
  const avgToolCallMs =
    toolDurs.length > 0 ? toolDurs.reduce((a, b) => a + b, 0) / toolDurs.length : 0;

  const usageCount = usageCountOverride ?? traceTotalFull;

  const kpis: OverviewKpis = {
    usageCount,
    spanErrorRatePct,
    modelCallErrorRatePct,
    modelErrorCount: llmErr,
    avgModelCallMs,
    totalTokens,
    toolCallCount,
    toolErrorRatePct,
    toolErrorCount: toolErr,
    avgToolCallMs,
    momUsage: prevTraceTotal != null ? pct(prevTraceTotal, usageCount) : null,
    momTokens: prevTokenSum != null ? pct(prevTokenSum, totalTokens) : null,
    momToolCalls: prevToolCallsSum != null ? pct(prevToolCallsSum, toolCallCount) : null,
  };

  const traceByDay = new Map<string, { tokens: number; count: number; durSum: number; loops: number; tools: number }>();
  for (const t of traces) {
    const ms = t.start_time;
    const k = dayKeyLocal(ms);
    const cur = traceByDay.get(k) ?? { tokens: 0, count: 0, durSum: 0, loops: 0, tools: 0 };
    cur.tokens += typeof t.total_tokens === "number" ? t.total_tokens : 0;
    cur.count += 1;
    const d = typeof t.duration_ms === "number" && t.duration_ms >= 0 ? t.duration_ms : 0;
    if (t.end_time != null && t.start_time > 0) {
      cur.durSum += Math.max(0, t.end_time - t.start_time);
    } else if (d > 0) {
      cur.durSum += d;
    }
    cur.loops += typeof t.loop_count === "number" ? t.loop_count : 0;
    cur.tools += typeof t.tool_call_count === "number" ? t.tool_call_count : 0;
    traceByDay.set(k, cur);
  }

  const daysSorted = [...traceByDay.keys()].sort();

  const tokensByDay = daysSorted.map((day) => {
    const b = traceByDay.get(day)!;
    /** Heuristic split when prompt/completion not in API (aligns dual-line trend shape). */
    const inputWan = (b.tokens * 0.58) / 10_000;
    const outputWan = (b.tokens * 0.42) / 10_000;
    return { day, inputWan, outputWan, total: b.tokens };
  });

  const traceCountByDay = daysSorted.map((day) => ({ day, n: traceByDay.get(day)!.count }));

  const modelSuccessByDay = daysSorted.map((day) => {
    const dayTraces = traces.filter((t) => dayKeyLocal(t.start_time) === day);
    const count = dayTraces.length;
    const ok = dayTraces.filter((t) => t.status === "success").length;
    const rate = count > 0 ? (ok / count) * 100 : 0;
    return { day, rate: Math.min(100, rate) };
  });

  const secsPerDay = 86400;
  const modelTokenRateByDay = daysSorted.map((day) => {
    const b = traceByDay.get(day)!;
    return { day, tps: b.tokens / secsPerDay };
  });

  const modelDurationSumByDay = daysSorted.map((day) => ({
    day,
    ms: traceByDay.get(day)!.durSum,
  }));

  const toolVolumeByDay = daysSorted.map((day) => ({
    day,
    n: traceByDay.get(day)!.tools,
  }));

  const toolLatencyMap = new Map<string, { sum: number; n: number }>();
  const toolOkMap = new Map<string, { ok: number; n: number }>();
  for (const s of toolSpans) {
    const ms = s.start_time_ms ?? 0;
    if (ms <= 0) {
      continue;
    }
    const k = dayKeyLocal(ms);
    if (s.duration_ms != null && s.duration_ms >= 0) {
      const cur = toolLatencyMap.get(k) ?? { sum: 0, n: 0 };
      cur.sum += s.duration_ms;
      cur.n += 1;
      toolLatencyMap.set(k, cur);
    }
    const okC = toolOkMap.get(k) ?? { ok: 0, n: 0 };
    okC.n += 1;
    if (!isErrorStatus(s.list_status)) {
      okC.ok += 1;
    }
    toolOkMap.set(k, okC);
  }

  const toolDays = [...new Set([...daysSorted, ...toolLatencyMap.keys(), ...toolOkMap.keys()])].sort();

  const toolLatencyByDay = toolDays.map((day) => {
    const cur = toolLatencyMap.get(day);
    const avgMs = cur && cur.n > 0 ? cur.sum / cur.n : 0;
    return { day, avgMs };
  });

  const toolSuccessByDay = toolDays.map((day) => {
    const cur = toolOkMap.get(day);
    const rate = cur && cur.n > 0 ? (cur.ok / cur.n) * 100 : 0;
    return { day, rate };
  });

  const agentStepsByDay = daysSorted.map((day) => {
    const b = traceByDay.get(day)!;
    const avg = b.count > 0 ? b.loops / b.count : 0;
    return { day, avg };
  });

  const agentToolsByDay = daysSorted.map((day) => {
    const b = traceByDay.get(day)!;
    const avg = b.count > 0 ? b.tools / b.count : 0;
    return { day, avg };
  });

  const llmByTraceDay = new Map<string, { llm: number; traces: Set<string> }>();
  for (const s of llmSpans) {
    const ms = s.start_time_ms ?? 0;
    if (ms <= 0) {
      continue;
    }
    const k = dayKeyLocal(ms);
    const cur = llmByTraceDay.get(k) ?? { llm: 0, traces: new Set<string>() };
    cur.llm += 1;
    cur.traces.add(s.trace_id);
    llmByTraceDay.set(k, cur);
  }

  const agentModelsByDay = daysSorted.map((day) => {
    const b = traceByDay.get(day)!;
    const perTraceLlms = llmByTraceDay.get(day);
    const avg =
      perTraceLlms && perTraceLlms.traces.size > 0 ? perTraceLlms.llm / perTraceLlms.traces.size : b.count > 0 ? b.loops / b.count : 0;
    return { day, avg };
  });

  const threadKeysByDay = new Map<string, Set<string>>();
  for (const t of traces) {
    const k = dayKeyLocal(t.start_time);
    const set = threadKeysByDay.get(k) ?? new Set<string>();
    set.add(t.thread_key || t.trace_id);
    threadKeysByDay.set(k, set);
  }

  const traceReportByDay = daysSorted.map((day) => ({ day, n: traceByDay.get(day)!.count }));
  const uniqueThreadsByDay = daysSorted.map((day) => ({
    day,
    n: (threadKeysByDay.get(day) ?? new Set()).size,
  }));

  const serviceQpsByDay = daysSorted.map((day) => {
    const n = traceByDay.get(day)!.count;
    return { day, qps: n / secsPerDay };
  });

  const serviceLatencyByDay = daysSorted.map((day) => {
    const b = traceByDay.get(day)!;
    const avg = b.count > 0 ? b.durSum / b.count : 0;
    return { day, avgMs: avg };
  });

  const serviceSuccessByDay = modelSuccessByDay;

  const modelCounts = new Map<string, number>();
  for (const s of llmSpans) {
    const m = s.model?.trim() || "—";
    modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
  }
  const modelSum = [...modelCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const modelDistribution: NamedPct[] = [...modelCounts.entries()]
    .map(([name, value]) => ({ name, value, pct: (value / modelSum) * 100 }))
    .sort((a, b) => b.value - a.value);

  const toolNameCounts = new Map<string, number>();
  for (const s of toolSpans) {
    const n = s.name?.trim() || "—";
    toolNameCounts.set(n, (toolNameCounts.get(n) ?? 0) + 1);
  }
  const toolSum = [...toolNameCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const toolDistribution: NamedPct[] = [...toolNameCounts.entries()]
    .map(([name, value]) => ({ name, value, pct: (value / toolSum) * 100 }))
    .sort((a, b) => b.value - a.value);

  const ttftMap = new Map<string, { sum: number; n: number }>();
  const tpotMap = new Map<string, { sum: number; n: number; tok: number }>();
  for (const s of llmSpans) {
    const ms = s.start_time_ms ?? 0;
    if (ms <= 0) {
      continue;
    }
    const k = dayKeyLocal(ms);
    const d = s.duration_ms;
    const tok = s.total_tokens > 0 ? s.total_tokens : 0;
    if (d != null && d >= 0) {
      const tt = ttftMap.get(k) ?? { sum: 0, n: 0 };
      tt.sum += Math.min(d, 120_000);
      tt.n += 1;
      ttftMap.set(k, tt);
    }
    if (d != null && d >= 0 && tok > 0) {
      const tp = tpotMap.get(k) ?? { sum: 0, n: 0, tok: 0 };
      tp.sum += d / tok;
      tp.n += 1;
      tp.tok += tok;
      tpotMap.set(k, tp);
    }
  }

  const chartDays = [...new Set([...daysSorted, ...ttftMap.keys(), ...tpotMap.keys()])].sort();
  const ttftByDay = chartDays.map((day) => {
    const cur = ttftMap.get(day);
    return { day, ms: cur && cur.n > 0 ? cur.sum / cur.n : 0 };
  });
  const tpotByDay = chartDays.map((day) => {
    const cur = tpotMap.get(day);
    return { day, ms: cur && cur.n > 0 ? (cur.sum / cur.n) * 1000 : 0 };
  });

  const charts: OverviewCharts = {
    tokensByDay,
    traceCountByDay,
    modelSuccessByDay,
    modelTokenRateByDay,
    modelDurationSumByDay,
    toolVolumeByDay,
    toolLatencyByDay,
    toolSuccessByDay,
    agentStepsByDay,
    agentToolsByDay,
    agentModelsByDay,
    traceReportByDay,
    uniqueThreadsByDay,
    serviceQpsByDay,
    serviceLatencyByDay,
    serviceSuccessByDay,
    modelDistribution,
    toolDistribution,
    ttftByDay,
    tpotByDay,
  };

  return { kpis, charts };
}
