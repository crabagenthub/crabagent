export type ObserveDatePreset = "all" | "24h" | "3d" | "7d" | "30d" | "60d";

export type ObserveDateRange =
  | { kind: "preset"; preset: ObserveDatePreset }
  | { kind: "custom"; startMs: number; endMs: number };

const MS_DAY = 86_400_000;
const HOUR_MS = 3600 * 1000;

const PRESET_MS: Record<Exclude<ObserveDatePreset, "all">, number> = {
  "24h": 24 * HOUR_MS,
  "3d": 3 * MS_DAY,
  "7d": 7 * MS_DAY,
  "30d": 30 * MS_DAY,
  "60d": 60 * MS_DAY,
};

/** Server query bounds for Collector list APIs. */
export function resolveObserveSinceUntil(
  range: ObserveDateRange,
  nowMs: number = Date.now(),
): { sinceMs?: number; untilMs?: number } {
  if (range.kind === "custom") {
    return { sinceMs: range.startMs, untilMs: range.endMs };
  }
  if (range.preset === "all") {
    return {};
  }
  const windowMs = PRESET_MS[range.preset];
  return { sinceMs: Math.floor(nowMs - windowMs), untilMs: Math.floor(nowMs) };
}

/** Default time window when no saved preference exists (or after reset). */
export function defaultObserveDateRange(): ObserveDateRange {
  return { kind: "preset", preset: "7d" };
}

const DATE_RANGE_STORAGE_KEY = "crabagent-observe-date-range";

const PRESET_SET: ReadonlySet<ObserveDatePreset> = new Set(["all", "24h", "3d", "7d", "30d", "60d"]);

/** Restore last time range from `localStorage`, or `null` if missing / invalid. */
export function readStoredObserveDateRange(): ObserveDateRange | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(DATE_RANGE_STORAGE_KEY);
    if (raw == null || raw === "") {
      return null;
    }
    const o = JSON.parse(raw) as { kind?: string; preset?: string; startMs?: unknown; endMs?: unknown };
    if (o?.kind === "preset" && typeof o.preset === "string" && PRESET_SET.has(o.preset as ObserveDatePreset)) {
      return { kind: "preset", preset: o.preset as ObserveDatePreset };
    }
    if (
      o?.kind === "custom" &&
      typeof o.startMs === "number" &&
      typeof o.endMs === "number" &&
      Number.isFinite(o.startMs) &&
      Number.isFinite(o.endMs) &&
      o.startMs <= o.endMs
    ) {
      return { kind: "custom", startMs: o.startMs, endMs: o.endMs };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredObserveDateRange(range: ObserveDateRange): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {
    /* ignore */
  }
}

export function isObserveDateRangeAll(range: ObserveDateRange): boolean {
  return range.kind === "preset" && range.preset === "all";
}
