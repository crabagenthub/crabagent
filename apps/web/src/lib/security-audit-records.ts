import { appendWorkspaceNameParam, collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_API } from "@/lib/collector-api-paths";

/** Collector `findings_json` 解析后单项（无明文、无 vault 原文）。 */
export type SecurityAuditFinding = {
  policy_id: string;
  policy_name: string;
  match_count: number;
  policy_action: string;
  redact_type: string;
  hint_type?: string | null;
};

export type SecurityAuditEventRow = {
  id: string;
  created_at_ms: number;
  trace_id: string;
  span_id: string | null;
  workspace_name: string;
  project_name: string;
  findings_json: string;
  total_findings: number;
  hit_count: number;
  intercepted: number;
  observe_only: number;
};

export type SecurityAuditPolicyEventCountRow = {
  policy_id: string;
  event_count: number;
};

export type LoadSecurityAuditEventsParams = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  sinceMs?: number;
  untilMs?: number;
  traceId?: string;
  spanId?: string;
  policyId?: string;
  hintType?: string;
};

export function parseSecurityAuditFindings(raw: string | null | undefined): SecurityAuditFinding[] {
  if (raw == null || !String(raw).trim()) {
    return [];
  }
  try {
    const v = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    return v.filter(Boolean).map((x) => {
      const o = x as Record<string, unknown>;
      return {
        policy_id: String(o.policy_id ?? ""),
        policy_name: String(o.policy_name ?? ""),
        match_count: Number(o.match_count ?? 0) || 0,
        policy_action: String(o.policy_action ?? ""),
        redact_type: String(o.redact_type ?? ""),
        hint_type: typeof o.hint_type === "string" ? o.hint_type : null,
      };
    });
  } catch {
    return [];
  }
}

export async function loadSecurityAuditEvents(
  baseUrl: string,
  apiKey: string,
  params: LoadSecurityAuditEventsParams,
): Promise<{ items: SecurityAuditEventRow[]; total: number }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit ?? 50));
  sp.set("offset", String(params.offset ?? 0));
  sp.set("order", params.order ?? "desc");
  if (params.sinceMs != null && params.sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(params.sinceMs)));
  }
  if (params.untilMs != null && params.untilMs > 0) {
    sp.set("until_ms", String(Math.floor(params.untilMs)));
  }
  if (params.traceId?.trim()) {
    sp.set("trace_id", params.traceId.trim());
  }
  if (params.spanId?.trim()) {
    sp.set("span_id", params.spanId.trim());
  }
  if (params.policyId?.trim()) {
    sp.set("policy_id", params.policyId.trim());
  }
  if (params.hintType?.trim()) {
    sp.set("hint_type", params.hintType.trim());
  }
  appendWorkspaceNameParam(sp);
  const url = `${b}${COLLECTOR_API.securityAuditEvents}?${sp.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json", ...collectorAuthHeaders(apiKey) } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: unknown[]; total?: number };
  const items = Array.isArray(data.items)
    ? data.items.map((r) => {
        const o = r as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          created_at_ms: Number(o.created_at_ms ?? 0) || 0,
          trace_id: String(o.trace_id ?? ""),
          span_id: o.span_id != null && String(o.span_id).trim() ? String(o.span_id) : null,
          workspace_name: String(o.workspace_name ?? ""),
          project_name: String(o.project_name ?? ""),
          findings_json: typeof o.findings_json === "string" ? o.findings_json : "[]",
          total_findings: Number(o.total_findings ?? 0) || 0,
          hit_count: Number(o.hit_count ?? 0) || 0,
          intercepted: Number(o.intercepted ?? 0) ? 1 : 0,
          observe_only: Number(o.observe_only ?? 0) ? 1 : 0,
        } satisfies SecurityAuditEventRow;
      })
    : [];
  return { items, total: Number(data.total ?? items.length) || 0 };
}

export async function loadSecurityAuditPolicyEventCounts(
  baseUrl: string,
  apiKey: string,
): Promise<SecurityAuditPolicyEventCountRow[]> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const url = `${b}${COLLECTOR_API.securityAuditPolicyEventCounts}?${sp.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json", ...collectorAuthHeaders(apiKey) } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) {
    return [];
  }
  return data.items
    .map((row) => {
      const o = row as Record<string, unknown>;
      return {
        policy_id: String(o.policy_id ?? "").trim(),
        event_count: Number(o.event_count ?? 0) || 0,
      } satisfies SecurityAuditPolicyEventCountRow;
    })
    .filter((row) => !!row.policy_id);
}
