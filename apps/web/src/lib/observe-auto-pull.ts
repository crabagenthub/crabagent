const STORAGE_KEY = "crabagent-observe-auto-pull";

/** 默认开启，与原先固定 `refetchInterval` 行为一致 */
export function readObserveAutoPull(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "0") {
      return false;
    }
    if (raw === "1") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return true;
}

export function writeObserveAutoPull(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
