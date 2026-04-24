import { appendWorkspaceNameParam, collectorAuthHeaders, loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
import type { AlertFrequencyMode, AlertHistoryEntry, AlertRule } from "@/lib/alert-rules-storage";

const RULES_KEY = "crabagent.alertRules.v1";
const HISTORY_KEY = "crabagent.alertHistory.v1";

function base() {
  return loadCollectorUrl().replace(/\/+$/, "");
}

function parseFrequencyMode(raw: unknown): AlertFrequencyMode | undefined {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "immediate" || s === "instant") {
    return "immediate";
  }
  if (s === "windowed" || s === "sliding_window" || s === "window") {
    return "windowed";
  }
  return undefined;
}

function mapRuleFromApi(r: Record<string, unknown>): AlertRule {
  const op = r.operator;
  const metricKey = r.metric_key;
  const freq =
    parseFrequencyMode(r.frequency_mode) ?? parseFrequencyMode(r.frequencyMode);
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    alertCode: typeof r.alert_code === "string" ? r.alert_code : undefined,
    templateId:
      typeof r.template_id === "string" && (r.template_id as string).trim() !== ""
        ? (r.template_id as string)
        : typeof r.templateId === "string" && (r.templateId as string).trim() !== ""
          ? (r.templateId as string)
          : undefined,
    frequencyMode: freq,
    ruleLanguage:
      typeof r.rule_language === "string"
        ? r.rule_language
        : typeof r.ruleLanguage === "string"
          ? r.ruleLanguage
          : undefined,
    subWindowMinutes:
      typeof r.sub_window_minutes === "number"
        ? r.sub_window_minutes
        : typeof r.subWindowMinutes === "number"
          ? r.subWindowMinutes
          : undefined,
    subWindowMode:
      typeof r.sub_window_mode === "string"
        ? r.sub_window_mode
        : typeof r.subWindowMode === "string"
          ? r.subWindowMode
          : undefined,
    severity: (r.severity as AlertRule["severity"]) ?? undefined,
    aggregateKey: typeof r.aggregate_key === "string" ? r.aggregate_key : undefined,
    conditionSummary: typeof r.condition_summary === "string" ? r.condition_summary : undefined,
    sourceTable: typeof r.sourceTable === "string" ? r.sourceTable : (r.source_table as string | undefined),
    conditionField: typeof r.conditionField === "string" ? r.conditionField : (r.condition_field as string | undefined),
    matchType: (r.matchType ?? r.match_type) as AlertRule["matchType"] | undefined,
    countThreshold: typeof r.countThreshold === "number" ? r.countThreshold : (typeof r.count_threshold === "number" ? r.count_threshold : undefined),
    metricKey: (metricKey as AlertRule["metricKey"]) || "error_rate_pct",
    operator: (op === "lt" || op === "eq" || op === "gt" ? op : "gt") as AlertRule["operator"],
    threshold: typeof r.threshold === "number" ? r.threshold : Number(r.threshold) || 0,
    windowMinutes: typeof r.window_minutes === "number" ? r.window_minutes : 5,
    delivery: "webhook",
    webhookType: (r.webhook_type as AlertRule["webhookType"]) || "generic",
    webhookUrl: String(r.webhook_url ?? ""),
    enabled: Boolean(r.enabled),
    createdAt: typeof r.created_at === "number" ? r.created_at : Date.now(),
    updatedAt: typeof r.updated_at === "number" ? r.updated_at : Date.now(),
  };
}

function ruleToJsonBody(r: Partial<AlertRule> & { id?: string }): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    metric_key: r.metricKey,
    operator: r.operator,
    threshold: r.threshold,
    window_minutes: r.windowMinutes,
    delivery: r.delivery ?? "webhook",
    webhook_type: r.webhookType ?? "generic",
    webhook_url: r.webhookUrl ?? "",
  };
  if (r.alertCode != null) o.alert_code = r.alertCode;
  if (r.severity != null) o.severity = r.severity;
  if (r.aggregateKey != null) o.aggregate_key = r.aggregateKey;
  if (r.conditionSummary != null) o.condition_summary = r.conditionSummary;
  if (r.sourceTable != null) o.source_table = r.sourceTable;
  if (r.conditionField != null) o.condition_field = r.conditionField;
  if (r.matchType != null) o.match_type = r.matchType;
  if (r.countThreshold != null) o.count_threshold = r.countThreshold;
  if (r.createdAt != null) o.created_at = r.createdAt;
  if (r.updatedAt != null) o.updated_at = r.updatedAt;
  if (r.templateId != null && String(r.templateId).trim() !== "") {
    o.template_id = r.templateId;
  }
  if (r.frequencyMode != null) {
    o.frequency_mode = r.frequencyMode;
  }
  if (r.ruleLanguage != null && String(r.ruleLanguage).trim() !== "") {
    o.rule_language = r.ruleLanguage;
  }
  if (typeof r.subWindowMinutes === "number" && !Number.isNaN(r.subWindowMinutes)) {
    o.sub_window_minutes = r.subWindowMinutes;
  }
  if (r.subWindowMode != null && String(r.subWindowMode).trim() !== "") {
    o.sub_window_mode = r.subWindowMode;
  }
  return o;
}

export async function fetchAlertRules(): Promise<AlertRule[]> {
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const res = await fetch(`${base()}/v1/alert-rules?${sp.toString()}`, {
    headers: { Accept: "application/json", ...collectorAuthHeaders(loadApiKey()) } as Record<string, string>,
  });
  const body = await readCollectorFetchResult<{ items?: unknown }>(res, "alert rules");
  const items = collectorItemsArray<Record<string, unknown>>(body.items);
  return items.map(mapRuleFromApi);
}

export async function fetchAlertEvents(): Promise<AlertHistoryEntry[]> {
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const res = await fetch(`${base()}/v1/alert-events?${sp.toString()}`, {
    headers: { Accept: "application/json", ...collectorAuthHeaders(loadApiKey()) } as Record<string, string>,
  });
  const body = await readCollectorFetchResult<{ items?: unknown }>(res, "alert events");
  const items = collectorItemsArray<Record<string, unknown>>(body.items);
  return items.map((row) => ({
    id: String(row.id ?? ""),
    ruleId: String(row.rule_id ?? ""),
    ruleName: "",
    alertCode: typeof row.severity === "string" ? undefined : undefined,
    severity: (row.severity as AlertHistoryEntry["severity"]) ?? undefined,
    firedAt: typeof row.fired_at === "number" ? row.fired_at : Number(row.fired_at) || 0,
    summary: String(row.summary ?? ""),
    conditionPreview: typeof row.condition_preview === "string" ? row.condition_preview : undefined,
    sourceTable: undefined,
    conditionField: undefined,
    matchType: undefined,
    countThreshold: undefined,
    status: (row.status as AlertHistoryEntry["status"]) || "pending",
    errorMessage: typeof row.error_text === "string" ? row.error_text : undefined,
    kind: typeof row.kind === "string" ? row.kind : undefined,
  }));
}

export async function saveAlertRuleApi(rule: AlertRule, editingId: string | null): Promise<AlertRule> {
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const body = ruleToJsonBody({ ...rule, id: editingId ?? rule.id });
  const res = await fetch(`${base()}/v1/alert-rules?${sp.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...collectorAuthHeaders(loadApiKey()),
    } as Record<string, string>,
    body: JSON.stringify(body),
  });
  const result = await readCollectorFetchResult<Record<string, unknown>>(res, "save alert");
  return mapRuleFromApi(result);
}

export async function deleteAlertRuleApi(id: string): Promise<void> {
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const res = await fetch(
    `${base()}/v1/alert-rules/${encodeURIComponent(id)}?${sp.toString()}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json", ...collectorAuthHeaders(loadApiKey()) } as Record<string, string>,
    },
  );
  await readCollectorFetchResult(res, "delete alert");
}

export async function postAlertRuleTest(id: string): Promise<void> {
  const sp = new URLSearchParams();
  appendWorkspaceNameParam(sp);
  const res = await fetch(
    `${base()}/v1/alert-rules/${encodeURIComponent(id)}/test?${sp.toString()}`,
    {
      method: "POST",
      headers: { Accept: "application/json", ...collectorAuthHeaders(loadApiKey()) } as Record<string, string>,
    },
  );
  await readCollectorFetchResult(res, "test notify");
}

/** One-time: push localStorage rules to API then clear. */
export async function migrateLocalStorageRulesToServer(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const raw = window.localStorage.getItem(RULES_KEY);
  if (!raw) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return;
  }
  const remote = await fetchAlertRules().catch(() => []);
  if (remote.length > 0) {
    return;
  }
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const r = item as Record<string, unknown>;
    const rule = mapRuleFromApi(r);
    try {
      await saveAlertRuleApi(rule, null);
    } catch {
      // ignore per-row
    }
  }
  window.localStorage.removeItem(RULES_KEY);
  window.localStorage.removeItem(HISTORY_KEY);
}
