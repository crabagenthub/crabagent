/** 浏览器本地告警规则与历史（后续可对接 Collector / 调度器） */

export type AlertOperator = "gt" | "lt" | "eq";

export type AlertDelivery = "webhook";

export type AlertWebhookType = "generic";

export type AlertMetricKey =
  | "error_rate_pct"
  | "estimated_daily_cost_usd"
  | "p95_latency_ms"
  | "sensitive_data_hits";

export type AlertSeverity = "P0" | "P1" | "P2";
export type AlertMatchType = "eq" | "contains" | "count_gte" | "ratio_gt" | "p95_gt";

export type AlertRule = {
  id: string;
  name: string;
  alertCode?: string;
  severity?: AlertSeverity;
  aggregateKey?: string;
  conditionSummary?: string;
  sourceTable?: string;
  conditionField?: string;
  matchType?: AlertMatchType;
  countThreshold?: number;
  metricKey: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
  windowMinutes: number;
  delivery: AlertDelivery;
  webhookType: AlertWebhookType;
  webhookUrl: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AlertHistoryEntry = {
  id: string;
  ruleId: string;
  ruleName: string;
  alertCode?: string;
  severity?: AlertSeverity;
  firedAt: number;
  summary: string;
  conditionPreview?: string;
  sourceTable?: string;
  conditionField?: string;
  matchType?: AlertMatchType;
  countThreshold?: number;
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
  return arr
    .filter(Boolean)
    .map((x) => x as Partial<AlertRule> & Record<string, unknown>)
    .map((r) => {
      const now = Date.now();
      return {
        id: typeof r.id === "string" ? r.id : `ar_${now}_${Math.random().toString(36).slice(2, 9)}`,
        name: typeof r.name === "string" ? r.name : "Untitled",
        alertCode: typeof r.alertCode === "string" ? r.alertCode : undefined,
        severity: r.severity === "P0" || r.severity === "P1" || r.severity === "P2" ? r.severity : undefined,
        aggregateKey: typeof r.aggregateKey === "string" ? r.aggregateKey : undefined,
        conditionSummary: typeof r.conditionSummary === "string" ? r.conditionSummary : undefined,
        sourceTable: typeof r.sourceTable === "string" ? r.sourceTable : undefined,
        conditionField: typeof r.conditionField === "string" ? r.conditionField : undefined,
        matchType:
          r.matchType === "eq" ||
          r.matchType === "contains" ||
          r.matchType === "count_gte" ||
          r.matchType === "ratio_gt" ||
          r.matchType === "p95_gt"
            ? r.matchType
            : undefined,
        countThreshold: typeof r.countThreshold === "number" ? r.countThreshold : undefined,
        metricKey:
          r.metricKey === "error_rate_pct" ||
          r.metricKey === "estimated_daily_cost_usd" ||
          r.metricKey === "p95_latency_ms" ||
          r.metricKey === "sensitive_data_hits"
            ? r.metricKey
            : "error_rate_pct",
        operator: r.operator === "lt" || r.operator === "eq" ? r.operator : "gt",
        threshold: typeof r.threshold === "number" ? r.threshold : 1,
        windowMinutes: typeof r.windowMinutes === "number" ? r.windowMinutes : 5,
        delivery: "webhook",
        webhookType: "generic",
        webhookUrl: typeof r.webhookUrl === "string" ? r.webhookUrl : "",
        enabled: typeof r.enabled === "boolean" ? r.enabled : true,
        createdAt: typeof r.createdAt === "number" ? r.createdAt : now,
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : now,
      };
    });
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
