import type { SorterInfo } from "@arco-design/web-react/es/Table/interface";
import type { ObserveListSortParam } from "@/lib/observe-facets";

/** `dataIndex` values that map to API `sort` time ordering (default). */
const TIME_DATA_INDEX = new Set(["start_time", "first_seen_ms", "start_time_ms", "trace_id"]);

/** `dataIndex` for token totals sort (`sort=tokens`). */
const TOKENS_DATA_INDEX = new Set(["total_tokens"]);

/**
 * Controlled `sortOrder` for Arco Table columns (`ascend` | `descend` | undefined).
 */
export function observeColumnSortOrder(
  dataIndex: string,
  sortKey: ObserveListSortParam,
  listOrder: "asc" | "desc",
): "ascend" | "descend" | undefined {
  if (TIME_DATA_INDEX.has(dataIndex) && sortKey === "time") {
    return listOrder === "asc" ? "ascend" : "descend";
  }
  if (TOKENS_DATA_INDEX.has(dataIndex) && sortKey === "tokens") {
    return listOrder === "asc" ? "ascend" : "descend";
  }
  return undefined;
}

/**
 * Server-side sort: `sorter: true` + this handler on `Table.onChange`.
 */
export function applyObserveTableSortChange(
  sorter: SorterInfo | SorterInfo[],
  extra: { action: "paginate" | "sort" | "filter" },
  onColumnSort: (sort: ObserveListSortParam, order: "asc" | "desc") => void,
  currentSortKey?: ObserveListSortParam,
  currentListOrder?: "asc" | "desc",
): void {
  if (extra.action !== "sort") {
    return;
  }
  const s = Array.isArray(sorter) ? sorter[0] : sorter;
  if (!s?.field) {
    return;
  }
  const field = String(s.field);
  const dimension = TIME_DATA_INDEX.has(field) ? "time" : TOKENS_DATA_INDEX.has(field) ? "tokens" : null;
  if (!dimension) {
    return;
  }
  if (!s.direction) {
    if (currentSortKey === dimension && currentListOrder) {
      onColumnSort(dimension, currentListOrder === "desc" ? "asc" : "desc");
      return;
    }
    onColumnSort(dimension, "desc");
    return;
  }
  const order = s.direction === "ascend" ? "asc" : "desc";
  if (dimension === "time") {
    onColumnSort("time", order);
    return;
  }
  if (dimension === "tokens") {
    onColumnSort("tokens", order);
  }
}

export function sortObserveRows<T>(
  rows: T[],
  sortKey: ObserveListSortParam,
  listOrder: "asc" | "desc",
  pickTime: (row: T) => number | null | undefined,
  pickTokens: (row: T) => number | null | undefined,
): T[] {
  const dir = listOrder === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortKey === "tokens" ? pickTokens(a) ?? -1 : pickTime(a) ?? -1;
    const bv = sortKey === "tokens" ? pickTokens(b) ?? -1 : pickTime(b) ?? -1;
    if (av === bv) {
      return 0;
    }
    return av > bv ? dir : -dir;
  });
}
