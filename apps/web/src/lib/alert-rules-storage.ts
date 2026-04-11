/** 浏览器本地告警规则与历史（后续可对接 Collector / 调度器） */

export type AlertOperator = "gt" | "lt" | "eq";

export type AlertDelivery = "webhook" | "email";

export type AlertWebhookType = "slack" | "generic";

export type AlertMetricKey =
  | "error_rate_pct"
  | "estimated_daily_cost_usd"
  | "p95_latency_ms"
  | "sensitive_data_hits"
  | "trace_count";

export type AlertRule = {
  id: string;
  name: string;
  metricKey: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
  windowMinutes: number;
  delivery: AlertDelivery;
  webhookType: AlertWebhookType;
  webhookUrl: string;
  email: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AlertHistoryEntry = {
  id: string;
  ruleId: string;
  ruleName: string;
  firedAt: number;
  summary: string;
  status: "sent" | "failed" | "pending";
};

const RULES_KEY = "crabagent.alertRules.v1";
const HISTORY_KEY = "crabagent.alertHistory.v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    const v = JSON.parse(raw) as unknown;
    return v as T;
  } catch {
    return fallback;
  }
}

export function readAlertRules(): AlertRule[] {
  if (typeof window === "undefined") {
    return [];
  }
  const arr = safeParse<unknown[]>(window.localStorage.getItem(RULES_KEY), []);
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr.filter(Boolean).map((x) => x as AlertRule);
}

export function writeAlertRules(rules: AlertRule[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function readAlertHistory(): AlertHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  const arr = safeParse<unknown[]>(window.localStorage.getItem(HISTORY_KEY), []);
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr.filter(Boolean).map((x) => x as AlertHistoryEntry);
}

export function writeAlertHistory(entries: AlertHistoryEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 500)));
}

export function appendAlertHistory(entry: Omit<AlertHistoryEntry, "id"> & { id?: string }): void {
  const prev = readAlertHistory();
  const id = entry.id ?? `ah_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  writeAlertHistory([{ ...entry, id }, ...prev]);
}

export function newRuleId(): string {
  return `ar_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
