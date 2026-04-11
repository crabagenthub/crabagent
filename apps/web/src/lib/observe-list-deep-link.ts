import type { ObserveListStatusParam } from "@/lib/observe-facets";
import type { ObserveDateRange } from "@/lib/observe-date-range";

const URL_STATUS_SET: ReadonlySet<string> = new Set(["running", "success", "error", "timeout"]);

/** 标记来自统计页跳转，用于目标页决定是否写入 localStorage 等 */
export const OBSERVE_FROM_STATS_PARAM = "observe_from";
export const OBSERVE_FROM_STATS_VALUE = "stats";

/** 与统计页「全部」时间窗对齐；去掉 observe_from 后仍可从 URL 恢复 */
export const OBSERVE_WINDOW_ALL_PARAM = "observe_window";
export const OBSERVE_WINDOW_ALL_VALUE = "all";

/** 执行步骤列表：`span_type=llm` 等；`span_type=` 空串表示显式不按类型筛选（与其它深链互斥） */
export const OBSERVE_SPAN_TYPE_PARAM = "span_type";

const SPAN_TYPE_URL_SET: ReadonlySet<string> = new Set(["general", "tool", "llm", "guardrail"]);

/** URL `span_type` 合法值；非法当作清空筛选 */
export function normalizeObserveListSpanTypeFromUrl(raw: string | null): string {
  if (raw == null) {
    return "";
  }
  const v = raw.trim().toLowerCase();
  return SPAN_TYPE_URL_SET.has(v) ? v : "";
}

/**
 * 构建 Trace 观测列表深链（消息列表 `kind=traces` 或执行步骤 `kind=spans`）。
 * 携带时间窗与可选状态；目标页读取后应去掉 `observe_from`，保留 `since_ms`/`until_ms` 或 `observe_window=all` 便于刷新后仍对齐窗口（且不写存储直至用户在目标页改时间）。
 */
export function buildTracesListDeepLink(opts: {
  kind: "traces" | "spans";
  sinceMs?: number;
  untilMs?: number;
  /** 与统计页「全部」时间窗一致（无起止毫秒） */
  windowAll?: boolean;
  statuses?: ObserveListStatusParam[];
  /**
   * 为 true 且未设置非空 `statuses` 时写入 `status=`，目标页据此清空状态筛选（如「模型耗时」深链仅筛 LLM 类型）。
   */
  clearStatusParam?: boolean;
  /**
   * 仅 `kind=spans` 有意义。传入 `""` 会带上 `span_type=`，用于显式清空类型筛选（如「步骤错误率」深链）。
   * 不传则不写入该参数。
   */
  spanType?: string;
}): string {
  const q = new URLSearchParams();
  q.set("kind", opts.kind);
  q.set(OBSERVE_FROM_STATS_PARAM, OBSERVE_FROM_STATS_VALUE);
  if (opts.windowAll) {
    q.set(OBSERVE_WINDOW_ALL_PARAM, OBSERVE_WINDOW_ALL_VALUE);
  } else {
    if (opts.sinceMs != null && opts.sinceMs > 0 && Number.isFinite(opts.sinceMs)) {
      q.set("since_ms", String(Math.floor(opts.sinceMs)));
    }
    if (opts.untilMs != null && opts.untilMs > 0 && Number.isFinite(opts.untilMs)) {
      q.set("until_ms", String(Math.floor(opts.untilMs)));
    }
  }
  const st = opts.statuses?.filter(Boolean) ?? [];
  if (st.length > 0) {
    /** 单参数逗号分隔，与列表 API 解析一致（多状态为 OR） */
    q.set("status", st.join(","));
  } else if (opts.clearStatusParam) {
    q.set("status", "");
  }
  if (opts.spanType !== undefined) {
    q.set(OBSERVE_SPAN_TYPE_PARAM, opts.spanType);
  }
  return `/traces?${q.toString()}`;
}

/** 从列表页 URL 解析时间窗（统计深链或刷新后保留的 query）。 */
export function parseObserveDateRangeFromListUrl(sp: URLSearchParams): ObserveDateRange | null {
  if (sp.get(OBSERVE_WINDOW_ALL_PARAM) === OBSERVE_WINDOW_ALL_VALUE) {
    return { kind: "preset", preset: "all" };
  }
  const s = sp.get("since_ms");
  const u = sp.get("until_ms");
  if (s != null && u != null) {
    const since = Number(s);
    const until = Number(u);
    if (Number.isFinite(since) && Number.isFinite(until) && since <= until) {
      return { kind: "custom", startMs: Math.floor(since), endMs: Math.floor(until) };
    }
  }
  return null;
}

/** 与 Collector `parseObserveListStatusesFromSearchParams` 对齐：重复键与逗号分隔可混用 */
export function parseObserveListStatusesFromUrl(sp: URLSearchParams): ObserveListStatusParam[] {
  const out: ObserveListStatusParam[] = [];
  const seen = new Set<string>();
  for (const chunk of sp.getAll("status")) {
    for (const piece of chunk.split(",")) {
      const t = piece.trim().toLowerCase();
      if (t.length === 0 || seen.has(t) || !URL_STATUS_SET.has(t)) {
        continue;
      }
      seen.add(t);
      out.push(t as ObserveListStatusParam);
    }
  }
  return out;
}
