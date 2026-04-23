export type AuditSeverity = "P0" | "P1" | "P2" | "P3";
export type AuditEventType = "command" | "resource" | "policy_hit";

export function getAuditSeverityColor(severity: AuditSeverity): string {
  if (severity === "P0") return "red";
  if (severity === "P1") return "orangered";
  if (severity === "P2") return "orange";
  return "gray";
}

export function getAuditEventTypeColor(eventType: AuditEventType): string {
  if (eventType === "command") return "arcoblue";
  if (eventType === "resource") return "purple";
  return "cyan";
}
