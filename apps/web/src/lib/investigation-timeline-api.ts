import { appendWorkspaceNameParam, collectorAuthHeaders } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
import { COLLECTOR_API } from "@/lib/collector-api-paths";

export type InvestigationTimelineEventType = "command" | "resource" | "policy_hit";
export type InvestigationTimelineSourcePage = "/command-analysis" | "/resource-audit";

export type InvestigationTimelineRow = {
  key: string;
  event_type: InvestigationTimelineEventType;
  time_ms: number;
  trace_id: string;
  span_id?: string | null;
  subject: string;
  evidence: string;
  actor: string;
  target: string;
  result: string;
  why_flagged: string;
  source_page: InvestigationTimelineSourcePage;
};

export type LoadInvestigationTimelineParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  traceId?: string;
  sinceMs?: number;
  untilMs?: number;
  eventType?: "all" | InvestigationTimelineEventType;
  sourcePage?: "all" | InvestigationTimelineSourcePage;
  keyword?: string;
};

export async function loadInvestigationTimeline(
  baseUrl: string,
  apiKey: string,
  params: LoadInvestigationTimelineParams,
): Promise<{ items: InvestigationTimelineRow[]; total: number }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit ?? 120));
  sp.set("offset", String(params.offset ?? 0));
  sp.set("order", params.order ?? "desc");
  if (params.traceId?.trim()) {
    sp.set("trace_id", params.traceId.trim());
  }
  if (params.sinceMs != null && params.sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(params.sinceMs)));
  }
  if (params.untilMs != null && params.untilMs > 0) {
    sp.set("until_ms", String(Math.floor(params.untilMs)));
  }
  if (params.eventType && params.eventType !== "all") {
    sp.set("event_type", params.eventType);
  }
  if (params.sourcePage && params.sourcePage !== "all") {
    sp.set("source_page", params.sourcePage);
  }
  if (params.keyword?.trim()) {
    sp.set("keyword", params.keyword.trim());
  }
  appendWorkspaceNameParam(sp);

  const res = await fetch(`${b}${COLLECTOR_API.investigationTimeline}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
    cache: "no-store",
  });
  const raw = await readCollectorFetchResult<{ items?: InvestigationTimelineRow[]; total?: number }>(
    res,
    `investigation timeline HTTP ${res.status}`,
  );
  return {
    items: collectorItemsArray<InvestigationTimelineRow>(raw.items),
    total: Number(raw.total ?? 0),
  };
}
