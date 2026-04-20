export type AuditLinkSource = "messages" | "steps" | "resource" | "policy";

export type AuditLinkContext = {
  trace_id?: string;
  span_id?: string;
  workspace?: string;
  since_ms?: number;
  until_ms?: number;
  risk_flags?: string[];
  policy_id?: string;
  uri_prefix?: string;
  source?: AuditLinkSource;
};

