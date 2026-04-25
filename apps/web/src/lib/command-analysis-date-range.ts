import { resolveObserveSinceUntil, type ObserveDateRange } from "@/lib/observe-date-range";
import { toShellTimeQuery, type ShellExecQueryParams } from "@/lib/shell-exec-api";

const STORAGE_KEY = "crabagent-command-analysis-date-range";

/** 指令分析独立时间窗：默认「全部」，避免与消息列表共用的 7 天把历史 Shell 数据滤掉。 */
export function defaultCommandAnalysisDateRange(): ObserveDateRange {
  return { kind: "preset", preset: "all" };
}

export function readCommandAnalysisDateRange(): ObserveDateRange {
  if (typeof window === "undefined") {
    return defaultCommandAnalysisDateRange();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw?.trim()) {
      return defaultCommandAnalysisDateRange();
    }
    const j = JSON.parse(raw) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const o = j as Record<string, unknown>;
      if (o.kind === "preset" && typeof o.preset === "string") {
        const p = o.preset;
        if (p === "all" || p === "24h" || p === "3d" || p === "7d" || p === "30d" || p === "60d") {
          return { kind: "preset", preset: p };
        }
      }
      if (o.kind === "custom") {
        const a = Number(o.startMs);
        const b = Number(o.endMs);
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
          return { kind: "custom", startMs: Math.floor(a), endMs: Math.floor(b) };
        }
      }
    }
  } catch {
    /* ignore */
  }
  return defaultCommandAnalysisDateRange();
}

export function writeCommandAnalysisDateRange(next: ObserveDateRange): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * 以「与当前页一致」的 `ObserveDateRange` + `nowMs` 解析 since/until（不读 localStorage）。
 * 风险概览 / 命令分析应优先用 React state 里的 `dateRange`，避免请求瞬间 `readCommandAnalysisDateRange()` 与 state 已写出但未对齐等边界差异。
 */
export function resolveCommandAnalysisShellTimeQueryForDateRange(
  range: ObserveDateRange,
  nowMs: number = Date.now(),
): Pick<ShellExecQueryParams, "sinceMs" | "untilMs"> {
  const { sinceMs, untilMs } = resolveObserveSinceUntil(range, nowMs);
  return toShellTimeQuery(sinceMs ?? null, untilMs ?? null);
}

/**
 * 每次发请求时调用：以 localStorage 中的指令分析时间预设 + `nowMs` 解析 since/until，再编码为 `appendShellParams` 用字段。
 * 与「在命令分析页 F5 后」的窗口一致，避免 `useMemo([dateRange], () => resolve(..., Date.now()))` 把「滑动预设」的 until 冻在数小时前的旧 `Date.now` 上，导致与新开的风险概览 7d 窗不一致（死循环/重复读 对不齐）。
 */
export function resolveCommandAnalysisShellTimeQuery(
  nowMs: number = Date.now(),
): Pick<ShellExecQueryParams, "sinceMs" | "untilMs"> {
  if (typeof window === "undefined") {
    return {};
  }
  return resolveCommandAnalysisShellTimeQueryForDateRange(readCommandAnalysisDateRange(), nowMs);
}
