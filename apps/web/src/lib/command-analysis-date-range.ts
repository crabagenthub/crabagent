import type { ObserveDateRange } from "@/lib/observe-date-range";

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
