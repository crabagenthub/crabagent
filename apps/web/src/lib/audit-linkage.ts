import type { AuditLinkContext } from "@/lib/audit-linkage-types";

export function mergeAuditContext(base: AuditLinkContext, patch: AuditLinkContext): AuditLinkContext {
  return { ...base, ...patch };
}

export function buildAuditLink(pathname: string, ctx: AuditLinkContext): string {
  const sp = new URLSearchParams();
  if (ctx.trace_id) sp.set("trace_id", ctx.trace_id);
  if (ctx.span_id) sp.set("span_id", ctx.span_id);
  if (ctx.workspace) sp.set("workspace", ctx.workspace);
  if (ctx.since_ms != null) sp.set("since_ms", String(ctx.since_ms));
  if (ctx.until_ms != null) sp.set("until_ms", String(ctx.until_ms));
  if (ctx.risk_flags?.length) sp.set("risk_flags", ctx.risk_flags.join(","));
  if (ctx.policy_id) sp.set("policy_id", ctx.policy_id);
  if (ctx.hint_type) sp.set("hint_type", ctx.hint_type);
  if (ctx.uri_prefix) sp.set("uri_prefix", ctx.uri_prefix);
  if (ctx.source) sp.set("source", ctx.source);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

