import { collectorAuthHeaders } from "@/lib/collector";

/** Matches Collector `parseObserveListStatus` / list query `status` query key. */
export type ObserveListStatusParam = "running" | "success" | "error" | "timeout";

export const OBSERVE_LIST_STATUS_OPTIONS: readonly ObserveListStatusParam[] = [
  "running",
  "success",
  "error",
  "timeout",
];

/** Matches Collector `parseObserveListSort` / list query `sort`. */
export type ObserveListSortParam = "time" | "tokens";

export type ObserveFacets = { agents: string[]; channels: string[] };

export async function loadObserveFacets(baseUrl: string, apiKey: string): Promise<ObserveFacets> {
  const b = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${b}/v1/observe-facets`, { headers: collectorAuthHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const j = (await res.json()) as { agents?: unknown; channels?: unknown };
  const agents = Array.isArray(j.agents)
    ? j.agents.map((x) => String(x)).filter((s) => s.trim().length > 0)
    : [];
  const channels = Array.isArray(j.channels)
    ? j.channels.map((x) => String(x)).filter((s) => s.trim().length > 0)
    : [];
  return { agents, channels };
}
