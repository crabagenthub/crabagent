export type SearchParamValue = string | null | undefined;

/**
 * Return a new query string after applying partial param updates.
 * - null/undefined/empty string => delete key
 * - other string values => set key
 */
export function buildSearchParamsString(
  current: URLSearchParams | string,
  updates: Record<string, SearchParamValue>,
): string {
  const params = typeof current === "string" ? new URLSearchParams(current) : new URLSearchParams(current.toString());
  for (const [key, rawValue] of Object.entries(updates)) {
    const value = rawValue?.trim();
    if (!value) {
      params.delete(key);
      continue;
    }
    params.set(key, value);
  }
  return params.toString();
}
