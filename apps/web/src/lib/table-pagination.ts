export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 60, 80, 100] as const;
export const PAGE_SIZE_STORAGE_KEY = "crabagent-observe-list-page-size";

export function readStoredPageSize(defaultSize: number): number {
  if (typeof window === "undefined") {
    return defaultSize;
  }
  try {
    const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const n = raw != null ? Number(raw) : Number.NaN;
    if (PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) {
      return n;
    }
  } catch {
    /* ignore */
  }
  return defaultSize;
}

export function writeStoredPageSize(next: number): void {
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
}
