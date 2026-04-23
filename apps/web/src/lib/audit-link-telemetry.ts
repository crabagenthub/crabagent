export const AUDIT_LINK_CLICK_EVENT = "crabagent-audit-link-click";

export type AuditLinkClickPayload = {
  label: string;
  href: string;
  targetPath: string;
  source?: string;
  traceId?: string;
  spanId?: string;
  policyId?: string;
  timestampMs: number;
};

export function trackAuditLinkClick(payload: Omit<AuditLinkClickPayload, "timestampMs">): void {
  if (typeof window === "undefined") {
    return;
  }
  const fullPayload: AuditLinkClickPayload = {
    ...payload,
    timestampMs: Date.now(),
  };
  try {
    window.dispatchEvent(new CustomEvent(AUDIT_LINK_CLICK_EVENT, { detail: fullPayload }));
  } catch {
    // ignore analytics failure
  }
}

export function parseAuditLinkForTelemetry(href: string): {
  targetPath: string;
  source?: string;
  traceId?: string;
  spanId?: string;
  policyId?: string;
} {
  const [targetPathRaw, queryRaw = ""] = href.split("?");
  const targetPath = targetPathRaw || "/";
  const sp = new URLSearchParams(queryRaw);
  return {
    targetPath,
    source: sp.get("source")?.trim() || undefined,
    traceId: sp.get("trace_id")?.trim() || undefined,
    spanId: sp.get("span_id")?.trim() || undefined,
    policyId: sp.get("policy_id")?.trim() || undefined,
  };
}

