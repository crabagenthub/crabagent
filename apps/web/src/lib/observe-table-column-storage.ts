const STORAGE_PREFIX = "observe-table-cols-v1:";

export function observeTableColumnStorageKey(tableId: string): string {
  return `${STORAGE_PREFIX}${tableId}`;
}

/** Persisted list of optional column keys that are currently hidden. */
export function readHiddenOptionalKeys(
  storageKey: string,
  validOptionalKeys: readonly string[],
  /** When storage is missing or invalid, use this as the hidden set (e.g. default column layout). */
  defaultHiddenWhenEmpty?: readonly string[],
): Set<string> {
  const valid = new Set(validOptionalKeys);
  const defaultHidden = () =>
    new Set((defaultHiddenWhenEmpty ?? []).filter((k) => typeof k === "string" && valid.has(k)));

  if (typeof window === "undefined") {
    return defaultHidden();
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaultHidden();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return defaultHidden();
    }
    const out = new Set<string>();
    for (const x of parsed) {
      if (typeof x === "string" && valid.has(x)) {
        out.add(x);
      }
    }
    return out;
  } catch {
    return defaultHidden();
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
