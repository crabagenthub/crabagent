import { appendWorkspaceNameParam, collectorAuthHeaders } from "@/lib/collector";
import { readCollectorFetchResult } from "@/lib/collector-json";

/** Matches Collector list query `status`（可重复键或逗号分隔，多选为 OR）. */
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
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const res = await fetch(`${b}/v1/observe-facets?${sp.toString()}`, { headers: collectorAuthHeaders(apiKey) });
  const j = await readCollectorFetchResult<{ agents?: unknown; channels?: unknown }>(
    res,
    `observe-facets HTTP ${res.status}`,
  );
  const agents = Array.isArray(j.agents)
    ? j.agents.map((x) => String(x)).filter((s) => s.trim().length > 0)
    : [];
  const channels = Array.isArray(j.channels)
    ? j.channels.map((x) => String(x)).filter((s) => s.trim().length > 0)
    : [];
  return { agents, channels };
}
