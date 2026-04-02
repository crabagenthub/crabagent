const STORAGE_PREFIX = "observe-table-cols-v1:";

export function observeTableColumnStorageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`;
}

/** Persisted list of optional column keys that are currently hidden. */
export function readHiddenOptionalKeys(storageKey: string, validOptionalKeys: readonly string[]): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  const valid = new Set(validOptionalKeys);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const out = new Set<string>();
    for (const x of parsed) {
      if (typeof x === "string" && valid.has(x)) {
        out.add(x);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

export function writeHiddenOptionalKeys(storageKey: string, hidden: Set<string>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...hidden].sort()));
  } catch {
    /* ignore */
  }
}
