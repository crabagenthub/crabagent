"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Message,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import type { TableColumnProps } from "@arco-design/web-react";
import { IconDelete, IconEdit, IconPlus } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/components/app-page-shell";
import { LocalizedLink } from "@/components/localized-link";
import {
  appendAlertHistory,
  newRuleId,
  readAlertHistory,
  readAlertRules,
  writeAlertRules,
  type AlertDelivery,
  type AlertHistoryEntry,
  type AlertMatchType,
  type AlertMetricKey,
  type AlertOperator,
  type AlertRule,
  type AlertSeverity,
  type AlertWebhookType,
} from "@/lib/alert-rules-storage";
import {
  matchAuditSilence,
  readActiveAuditSilences,
  removeAuditSilenceRule,
} from "@/lib/audit-silence-storage";
import { getAuditSeverityColor } from "@/lib/audit-ui-semantics";
import { cn } from "@/lib/utils";

type TemplateDef = {
  id: string;
  code: string;
  severity: AlertSeverity;
  conditionSummary: string;
  aggregateKey: string;
  sourceTable: string;
  conditionField: string;
  matchType: AlertMatchType;
  countThreshold: number;
  metricKey: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
  windowMinutes: number;
};

const TEMPLATES: TemplateDef[] = [
  {
    id: "sec_enforce_hit",
    code: "SEC_ENFORCE_HIT",
    severity: "P0",
    conditionSummary: "agent_security_audit_logs.intercepted = 1",
    aggregateKey: "workspace + trace_id + policy_id",
    sourceTable: "agent_security_audit_logs",
    conditionField: "intercepted",
    matchType: "eq",
    countThreshold: 1,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 1,
    windowMinutes: 1,
  },
  {
    id: "resource_sensitive_path",
    code: "RESOURCE_SENSITIVE_PATH",
    severity: "P0",
    conditionSummary: "agent_resource_access.risk_flags includes sensitive_path",
    aggregateKey: "workspace + resource_uri + agent_name",
    sourceTable: "agent_resource_access",
    conditionField: "risk_flags",
    matchType: "contains",
    countThreshold: 1,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 1,
    windowMinutes: 5,
  },
  {
    id: "resource_secret_credential_hint",
    code: "RESOURCE_SECRET_CREDENTIAL_HINT",
    severity: "P0",
    conditionSummary: "policy_hint_flags/risk_flags include secret_hint or credential_hint",
    aggregateKey: "workspace + trace_id + span_id",
    sourceTable: "agent_resource_access",
    conditionField: "risk_flags/policy_hint_flags",
    matchType: "contains",
    countThreshold: 1,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 1,
    windowMinutes: 5,
  },
  {
    id: "cmd_permission_denied_burst",
    code: "CMD_PERMISSION_DENIED_BURST",
    severity: "P0",
    conditionSummary: "agent_exec_commands.permission_denied = 1 and count >= N",
    aggregateKey: "workspace + agent_name + channel_name",
    sourceTable: "agent_exec_commands",
    conditionField: "permission_denied",
    matchType: "count_gte",
    countThreshold: 3,
    metricKey: "error_rate_pct",
    operator: "gt",
    threshold: 3,
    windowMinutes: 10,
  },
  {
    id: "cmd_not_found_burst",
    code: "CMD_NOT_FOUND_BURST",
    severity: "P1",
    conditionSummary: "command_not_found = 1 and count >= N",
    aggregateKey: "workspace + agent_name",
    sourceTable: "agent_exec_commands",
    conditionField: "command_not_found",
    matchType: "count_gte",
    countThreshold: 5,
    metricKey: "error_rate_pct",
    operator: "gt",
    threshold: 5,
    windowMinutes: 10,
  },
  {
    id: "cmd_token_risk_burst",
    code: "CMD_TOKEN_RISK_BURST",
    severity: "P1",
    conditionSummary: "token_risk = 1 and count >= N",
    aggregateKey: "workspace + agent_name + command_key",
    sourceTable: "agent_exec_commands",
    conditionField: "token_risk",
    matchType: "count_gte",
    countThreshold: 3,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 3,
    windowMinutes: 15,
  },
  {
    id: "cmd_loop_alert",
    code: "CMD_LOOP_ALERT",
    severity: "P1",
    conditionSummary: "loop_alerts hit or repeated count >= threshold",
    aggregateKey: "workspace + trace_id + command_key",
    sourceTable: "agent_exec_commands",
    conditionField: "loop_alerts",
    matchType: "count_gte",
    countThreshold: 3,
    metricKey: "error_rate_pct",
    operator: "gt",
    threshold: 3,
    windowMinutes: 10,
  },
  {
    id: "resource_large_read_burst",
    code: "RESOURCE_LARGE_READ_BURST",
    severity: "P1",
    conditionSummary: "risk_flags include large_read and count >= N",
    aggregateKey: "workspace + agent_name + resource_uri",
    sourceTable: "agent_resource_access",
    conditionField: "risk_flags.large_read",
    matchType: "count_gte",
    countThreshold: 3,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 3,
    windowMinutes: 15,
  },
  {
    id: "resource_redundant_read_burst",
    code: "RESOURCE_REDUNDANT_READ_BURST",
    severity: "P1",
    conditionSummary: "risk_flags include redundant_read or uri_repeat_count >= threshold",
    aggregateKey: "workspace + trace_id + resource_uri",
    sourceTable: "agent_resource_access",
    conditionField: "risk_flags.redundant_read / uri_repeat_count",
    matchType: "count_gte",
    countThreshold: 3,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 3,
    windowMinutes: 15,
  },
  {
    id: "trace_error_rate_high",
    code: "TRACE_ERROR_RATE_HIGH",
    severity: "P2",
    conditionSummary: "failed trace ratio > X%",
    aggregateKey: "workspace + agent_name",
    sourceTable: "trace_stats",
    conditionField: "failed_trace_ratio",
    matchType: "ratio_gt",
    countThreshold: 5,
    metricKey: "error_rate_pct",
    operator: "gt",
    threshold: 5,
    windowMinutes: 15,
  },
  {
    id: "p95_latency_high",
    code: "P95_LATENCY_HIGH",
    severity: "P2",
    conditionSummary: "p95 duration_ms > threshold",
    aggregateKey: "workspace + agent_name",
    sourceTable: "trace_stats",
    conditionField: "p95_duration_ms",
    matchType: "p95_gt",
    countThreshold: 3000,
    metricKey: "p95_latency_ms",
    operator: "gt",
    threshold: 3000,
    windowMinutes: 15,
  },
  {
    id: "sec_audit_only_spike",
    code: "SEC_AUDIT_ONLY_SPIKE",
    severity: "P2",
    conditionSummary: "observe_only = 1 and hits > threshold",
    aggregateKey: "workspace + policy_id",
    sourceTable: "agent_security_audit_logs",
    conditionField: "observe_only",
    matchType: "count_gte",
    countThreshold: 10,
    metricKey: "sensitive_data_hits",
    operator: "gt",
    threshold: 10,
    windowMinutes: 30,
  },
];

function templateCardGradientClass(id: string): string {
  switch (id) {
    case "sec_enforce_hit":
    case "resource_sensitive_path":
    case "resource_secret_credential_hint":
    case "cmd_permission_denied_burst":
      return "border-[#ffd6d6] bg-gradient-to-br from-[#fff2f0] via-[#fff7f7] to-[#fff1f1]";
    case "cmd_not_found_burst":
    case "cmd_token_risk_burst":
    case "cmd_loop_alert":
    case "resource_large_read_burst":
    case "resource_redundant_read_burst":
      return "border-[#e3dbff] bg-gradient-to-br from-[#f7f2ff] via-[#faf7ff] to-[#f1ecff]";
    case "trace_error_rate_high":
    case "p95_latency_high":
    case "sec_audit_only_spike":
      return "border-[#d8e2ff] bg-gradient-to-br from-[#f1f4ff] via-[#f7f9ff] to-[#edf3ff]";
    default:
      return "border-[#E5E6EB] bg-white";
  }
}

function templateTitle(t: ReturnType<typeof useTranslations<"Alerts">>, id: string): string {
  return t(`tpl_${id}_name`);
}

function templateDesc(t: ReturnType<typeof useTranslations<"Alerts">>, id: string): string {
  return t(`tpl_${id}_desc`);
}

function severityTagColor(severity: AlertSeverity): string {
  return getAuditSeverityColor(severity);
}

function severityWeight(severity?: AlertSeverity): number {
  if (severity === "P0") return 0;
  if (severity === "P1") return 1;
  if (severity === "P2") return 2;
  return 9;
}

const METRIC_OPTIONS: AlertMetricKey[] = [
  "error_rate_pct",
  "estimated_daily_cost_usd",
  "p95_latency_ms",
  "sensitive_data_hits",
];

function defaultPresetByEventType(eventType: string): {
  metricKey: AlertMetricKey;
  operator: AlertOperator;
  threshold: number;
  windowMinutes: number;
} {
  if (eventType === "policy_hit") {
    return { metricKey: "sensitive_data_hits", operator: "gt", threshold: 1, windowMinutes: 5 };
  }
  if (eventType === "command") {
    return { metricKey: "error_rate_pct", operator: "gt", threshold: 5, windowMinutes: 5 };
  }
  return { metricKey: "sensitive_data_hits", operator: "gt", threshold: 1, windowMinutes: 5 };
}

function metricLabel(t: ReturnType<typeof useTranslations<"Alerts">>, k: AlertMetricKey): string {
  const map: Record<AlertMetricKey, string> = {
    error_rate_pct: t("metric_error_rate_pct"),
    estimated_daily_cost_usd: t("metric_estimated_daily_cost_usd"),
    p95_latency_ms: t("metric_p95_latency_ms"),
    sensitive_data_hits: t("metric_sensitive_data_hits"),
  };
  return map[k] ?? k;
}

function opLabel(t: ReturnType<typeof useTranslations<"Alerts">>, o: AlertOperator): string {
  if (o === "gt") {
    return t("opGt");
  }
  if (o === "lt") {
    return t("opLt");
  }
  return t("opEq");
}

function formatRuleSummary(rule: AlertRule, t: ReturnType<typeof useTranslations<"Alerts">>): string {
  return `${metricLabel(t, rule.metricKey)} ${opLabel(t, rule.operator)} ${rule.threshold} · ${t("windowSummary", { n: String(rule.windowMinutes) })}`;
}

function formatConditionPreview(rule: Pick<AlertRule, "sourceTable" | "conditionField" | "matchType" | "countThreshold">): string {
  const table = rule.sourceTable?.trim() || "?";
  const field = rule.conditionField?.trim() || "?";
  const match = rule.matchType ?? "eq";
  const threshold = rule.countThreshold ?? 1;
  if (match === "eq") {
    return `${table}.${field} = 1`;
  }
  if (match === "contains") {
    return `${table}.${field} CONTAINS (...)`;
  }
  if (match === "count_gte") {
    return `COUNT(${table}.${field}) >= ${threshold}`;
  }
  if (match === "ratio_gt") {
    return `RATIO(${table}.${field}) > ${threshold}%`;
  }
  return `P95(${table}.${field}) > ${threshold}`;
}

function formatConditionPreviewSqlLike(
  rule: Pick<AlertRule, "sourceTable" | "conditionField" | "matchType" | "countThreshold">,
): string {
  const table = rule.sourceTable?.trim() || "unknown_table";
  const field = rule.conditionField?.trim() || "unknown_field";
  const match = rule.matchType ?? "eq";
  const threshold = rule.countThreshold ?? 1;
  if (match === "eq") {
    return `SELECT * FROM ${table} WHERE ${field} = 1;`;
  }
  if (match === "contains") {
    return `SELECT * FROM ${table} WHERE ${field} LIKE '%...%';`;
  }
  if (match === "count_gte") {
    return `SELECT COUNT(*) FROM ${table} WHERE ${field} = 1 HAVING COUNT(*) >= ${threshold};`;
  }
  if (match === "ratio_gt") {
    return `SELECT (SUM(CASE WHEN ${field} = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS ratio FROM ${table} HAVING ratio > ${threshold};`;
  }
  return `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${field}) AS p95 FROM ${table} HAVING p95 > ${threshold};`;
}

function formatMatchTypeLabel(matchType: AlertMatchType | undefined): string {
  if (matchType === "contains") return "contains";
  if (matchType === "count_gte") return "count_gte";
  if (matchType === "ratio_gt") return "ratio_gt";
  if (matchType === "p95_gt") return "p95_gt";
  return "eq";
}

type PrefillSource = "investigation" | "risk" | "";

function normalizePrefillSource(raw: string): PrefillSource {
  if (raw === "investigation" || raw === "risk") {
    return raw;
  }
  return "";
}

function inferAdvancedCondition(
  eventType: string,
  metricKey: AlertMetricKey,
): Pick<AlertRule, "sourceTable" | "conditionField" | "matchType" | "countThreshold"> {
  if (eventType === "policy_hit") {
    return { sourceTable: "agent_security_audit_logs", conditionField: "intercepted", matchType: "eq", countThreshold: 1 };
  }
  if (eventType === "resource") {
    return { sourceTable: "agent_resource_access", conditionField: "risk_flags", matchType: "contains", countThreshold: 1 };
  }
  if (eventType === "command") {
    return { sourceTable: "agent_exec_commands", conditionField: "permission_denied", matchType: "count_gte", countThreshold: 3 };
  }
  if (metricKey === "p95_latency_ms") {
    return { sourceTable: "trace_stats", conditionField: "p95_duration_ms", matchType: "p95_gt", countThreshold: 1 };
  }
  if (metricKey === "estimated_daily_cost_usd") {
    return { sourceTable: "trace_stats", conditionField: "estimated_daily_cost_usd", matchType: "ratio_gt", countThreshold: 1 };
  }
  if (metricKey === "sensitive_data_hits") {
    return { sourceTable: "agent_resource_access", conditionField: "risk_flags", matchType: "contains", countThreshold: 1 };
  }
  return { sourceTable: "agent_exec_commands", conditionField: "permission_denied", matchType: "count_gte", countThreshold: 3 };
}

/** 与总览 / 资源审计等页一致的卡片壳 */
const cardShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border dark:bg-card dark:shadow-sm";

export function AlertsDashboard() {
  const t = useTranslations("Alerts");
  const sp = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlertRule | null>(null);

  const [name, setName] = useState("");
  const [alertCode, setAlertCode] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity>("P1");
  const [aggregateKey, setAggregateKey] = useState("");
  const [conditionSummary, setConditionSummary] = useState("");
  const [sourceTable, setSourceTable] = useState("");
  const [conditionField, setConditionField] = useState("");
  const [matchType, setMatchType] = useState<AlertMatchType>("eq");
  const [countThreshold, setCountThreshold] = useState(1);
  const [ruleSeverityFilter, setRuleSeverityFilter] = useState<"all" | AlertSeverity>("all");
  const [ruleCodeKeyword, setRuleCodeKeyword] = useState("");
  const [conditionPreviewMode, setConditionPreviewMode] = useState<"human" | "sql">("human");
  const [expandedRuleIds, setExpandedRuleIds] = useState<Record<string, boolean>>({});
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});
  const [metricKey, setMetricKey] = useState<AlertMetricKey>("error_rate_pct");
  const [operator, setOperator] = useState<AlertOperator>("gt");
  const [threshold, setThreshold] = useState<number>(5);
  const [windowMinutes, setWindowMinutes] = useState<number>(5);
  const [delivery] = useState<AlertDelivery>("webhook");
  const [webhookType, setWebhookType] = useState<AlertWebhookType>("generic");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [hasAppliedInvestigationPreset, setHasAppliedInvestigationPreset] = useState(false);
  const [silenceVersion, setSilenceVersion] = useState(0);
  const [silenceScopeFilter, setSilenceScopeFilter] = useState<"all" | "trace" | "event_type">("all");
  const [advancedConfigOpen, setAdvancedConfigOpen] = useState(false);
  const source = normalizePrefillSource(sp.get("from")?.trim() ?? "");
  const traceIdFromUrl = sp.get("trace_id")?.trim() ?? "";
  const spanIdFromUrl = sp.get("span_id")?.trim() ?? "";
  const eventTypeFromUrl = sp.get("event_type")?.trim() ?? "";
  const recommendedMetric = sp.get("recommended_metric")?.trim() as AlertMetricKey | null;
  const recommendedOperator = sp.get("recommended_operator")?.trim() as AlertOperator | null;
  const recommendedThresholdRaw = sp.get("recommended_threshold")?.trim() ?? "";
  const recommendedWindowRaw = sp.get("recommended_window_minutes")?.trim() ?? "";
  const recommendedPreset = useMemo(() => {
    const fallback = defaultPresetByEventType(eventTypeFromUrl);
    const metricValid = recommendedMetric != null && METRIC_OPTIONS.includes(recommendedMetric);
    const operatorValid = recommendedOperator === "gt" || recommendedOperator === "lt" || recommendedOperator === "eq";
    const threshold = Number(recommendedThresholdRaw);
    const window = Number(recommendedWindowRaw);
    const thresholdValid = Number.isFinite(threshold);
    const windowValid = Number.isFinite(window) && window > 0;
    const valid = metricValid && operatorValid;
    return {
      valid,
      metricKey: valid ? (recommendedMetric as AlertMetricKey) : fallback.metricKey,
      operator: valid ? (recommendedOperator as AlertOperator) : fallback.operator,
      threshold: valid && thresholdValid ? threshold : fallback.threshold,
      windowMinutes: valid && windowValid ? Math.floor(window) : fallback.windowMinutes,
      usedFallback: !valid || !thresholdValid || !windowValid,
    };
  }, [eventTypeFromUrl, recommendedMetric, recommendedOperator, recommendedThresholdRaw, recommendedWindowRaw]);
  const silenceMatched = useMemo(() => {
    if (!source || !traceIdFromUrl) {
      return null;
    }
    if (eventTypeFromUrl !== "command" && eventTypeFromUrl !== "resource" && eventTypeFromUrl !== "policy_hit") {
      return null;
    }
    return matchAuditSilence({
      traceId: traceIdFromUrl,
      eventType: eventTypeFromUrl,
    });
  }, [eventTypeFromUrl, source, traceIdFromUrl]);
  const silenceRules = useMemo(() => {
    void silenceVersion;
    return readActiveAuditSilences();
  }, [silenceVersion]);
  const silenceOverview = useMemo(() => {
    const now = Date.now();
    const soonCutoff = now + 30 * 60_000;
    return {
      activeCount: silenceRules.length,
      expiringSoonCount: silenceRules.filter((rule) => rule.expireAt <= soonCutoff).length,
    };
  }, [silenceRules]);
  const filteredSilenceRules = useMemo(
    () =>
      [...silenceRules]
        .filter((rule) => (silenceScopeFilter === "all" ? true : rule.scope === silenceScopeFilter))
        .sort((a, b) => a.expireAt - b.expireAt),
    [silenceRules, silenceScopeFilter],
  );
  const eventTypeLabel = useMemo(() => {
    if (eventTypeFromUrl === "command" || eventTypeFromUrl === "resource" || eventTypeFromUrl === "policy_hit") {
      return eventTypeFromUrl;
    }
    return "unknown";
  }, [eventTypeFromUrl]);

  const reload = useCallback(() => {
    setRules(readAlertRules());
    setHistory(readAlertHistory());
  }, []);

  useEffect(() => {
    setMounted(true);
    reload();
  }, [reload]);

  useEffect(() => {
    if (hasAppliedInvestigationPreset || !source) {
      return;
    }
    setHasAppliedInvestigationPreset(true);
    setEditingId(null);
    const prefillBase = traceIdFromUrl
      ? t("prefillNameWithTrace", { traceId: traceIdFromUrl.slice(0, 12) })
      : t("prefillName");
    setName(`[${eventTypeLabel}] ${prefillBase}`);
    setAlertCode("");
    setSeverity(eventTypeFromUrl === "policy_hit" ? "P0" : eventTypeFromUrl === "command" ? "P1" : "P0");
    setAggregateKey("workspace + trace_id");
    setConditionSummary(`from ${source} event_type=${eventTypeLabel}`);
    const advancedPreset = inferAdvancedCondition(eventTypeFromUrl, recommendedPreset.metricKey);
    setSourceTable(advancedPreset.sourceTable ?? "");
    setConditionField(advancedPreset.conditionField ?? "");
    setMatchType(advancedPreset.matchType ?? "eq");
    setCountThreshold(advancedPreset.countThreshold ?? 1);
    setMetricKey(recommendedPreset.metricKey);
    setOperator(recommendedPreset.operator);
    setThreshold(recommendedPreset.threshold);
    setWindowMinutes(recommendedPreset.windowMinutes);
    setWebhookType("generic");
    setWebhookUrl("");
    setEnabled(true);
    setAdvancedConfigOpen(false);
    setModalOpen(true);
  }, [
    eventTypeFromUrl,
    hasAppliedInvestigationPreset,
    recommendedPreset,
    source,
    t,
    eventTypeLabel,
    traceIdFromUrl,
  ]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setName("");
    setAlertCode("");
    setSeverity("P1");
    setAggregateKey("");
    setConditionSummary("");
    setSourceTable("");
    setConditionField("");
    setMatchType("eq");
    setCountThreshold(1);
    setMetricKey("error_rate_pct");
    setOperator("gt");
    setThreshold(5);
    setWindowMinutes(5);
    setWebhookType("generic");
    setWebhookUrl("");
    setEnabled(true);
    setAdvancedConfigOpen(false);
    setModalOpen(true);
  }, []);

  const applyTemplate = useCallback(
    (tpl: TemplateDef) => {
      setEditingId(null);
      setName(templateTitle(t, tpl.id));
      setAlertCode(tpl.code);
      setSeverity(tpl.severity);
      setAggregateKey(tpl.aggregateKey);
      setConditionSummary(tpl.conditionSummary);
      setSourceTable(tpl.sourceTable);
      setConditionField(tpl.conditionField);
      setMatchType(tpl.matchType);
      setCountThreshold(tpl.countThreshold);
      setMetricKey(tpl.metricKey);
      setOperator(tpl.operator);
      setThreshold(tpl.threshold);
      setWindowMinutes(tpl.windowMinutes);
      setWebhookType("generic");
      setWebhookUrl("");
      setEnabled(true);
      setAdvancedConfigOpen(false);
      setModalOpen(true);
    },
    [t],
  );
  const restoreRecommendedPreset = useCallback(() => {
    setMetricKey(recommendedPreset.metricKey);
    setOperator(recommendedPreset.operator);
    setThreshold(recommendedPreset.threshold);
    setWindowMinutes(recommendedPreset.windowMinutes);
  }, [recommendedPreset]);

  const openEdit = useCallback((rule: AlertRule) => {
    setEditingId(rule.id);
    setName(rule.name);
    setAlertCode(rule.alertCode ?? "");
    setSeverity(rule.severity ?? "P1");
    setAggregateKey(rule.aggregateKey ?? "");
    setConditionSummary(rule.conditionSummary ?? "");
    setSourceTable(rule.sourceTable ?? "");
    setConditionField(rule.conditionField ?? "");
    setMatchType(rule.matchType ?? "eq");
    setCountThreshold(rule.countThreshold ?? 1);
    setMetricKey(rule.metricKey);
    setOperator(rule.operator);
    setThreshold(rule.threshold);
    setWindowMinutes(rule.windowMinutes);
    setWebhookType(rule.webhookType);
    setWebhookUrl(rule.webhookUrl);
    setEnabled(rule.enabled);
    setAdvancedConfigOpen(true);
    setModalOpen(true);
  }, []);

  const saveRule = useCallback(() => {
    const n = name.trim();
    if (!n) {
      Message.warning(t("validateName"));
      return;
    }
    const now = Date.now();
    const fallbackAdvanced = inferAdvancedCondition(eventTypeFromUrl, metricKey);
    const resolvedSourceTable = sourceTable.trim() || fallbackAdvanced.sourceTable || undefined;
    const resolvedConditionField = conditionField.trim() || fallbackAdvanced.conditionField || undefined;
    const resolvedMatchType = matchType || fallbackAdvanced.matchType;
    const resolvedCountThreshold = Math.max(1, Math.floor(Number(countThreshold)) || fallbackAdvanced.countThreshold || 1);
    const next: AlertRule = {
      id: editingId ?? newRuleId(),
      name: n,
      alertCode: alertCode.trim() || undefined,
      severity,
      aggregateKey: aggregateKey.trim() || undefined,
      conditionSummary: conditionSummary.trim() || undefined,
      sourceTable: resolvedSourceTable,
      conditionField: resolvedConditionField,
      matchType: resolvedMatchType,
      countThreshold: resolvedCountThreshold,
      metricKey,
      operator,
      threshold: Number(threshold),
      windowMinutes: Math.max(1, Math.floor(Number(windowMinutes)) || 1),
      delivery,
      webhookType,
      webhookUrl: webhookUrl.trim(),
      enabled,
      createdAt: editingId ? rules.find((r) => r.id === editingId)?.createdAt ?? now : now,
      updatedAt: now,
    };
    const others = editingId ? rules.filter((r) => r.id !== editingId) : rules;
    writeAlertRules([next, ...others]);
    reload();
    setModalOpen(false);
    Message.success(t("saveOk"));
  }, [
    delivery,
    alertCode,
    aggregateKey,
    countThreshold,
    conditionField,
    conditionSummary,
    editingId,
    enabled,
    metricKey,
    name,
    operator,
    reload,
    rules,
    sourceTable,
    matchType,
    severity,
    t,
    threshold,
    webhookType,
    webhookUrl,
    windowMinutes,
    eventTypeFromUrl,
  ]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) {
      return;
    }
    writeAlertRules(rules.filter((r) => r.id !== deleteTarget.id));
    reload();
    setDeleteTarget(null);
    Message.success(t("deleteOk"));
  }, [deleteTarget, reload, rules, t]);

  const toggleEnabled = useCallback(
    (rule: AlertRule, on: boolean) => {
      const now = Date.now();
      writeAlertRules(
        rules.map((r) => (r.id === rule.id ? { ...r, enabled: on, updatedAt: now } : r)),
      );
      reload();
    },
    [reload, rules],
  );

  const testNotify = useCallback(
    (rule: AlertRule) => {
      const preview = formatConditionPreview(rule);
      appendAlertHistory({
        ruleId: rule.id,
        ruleName: rule.name,
        alertCode: rule.alertCode,
        severity: rule.severity,
        firedAt: Date.now(),
        summary: `${formatRuleSummary(rule, t)} · ${t("conditionPreviewLabel")}: ${preview}`,
        conditionPreview: preview,
        sourceTable: rule.sourceTable,
        conditionField: rule.conditionField,
        matchType: rule.matchType,
        countThreshold: rule.countThreshold,
        status: "pending",
      });
      reload();
      Message.info(t("testNotifyQueued"));
    },
    [reload, t],
  );
  const clearSilenceById = useCallback(
    (id: string) => {
      removeAuditSilenceRule(id);
      setSilenceVersion((v) => v + 1);
      Message.success(t("silenceCleared"));
    },
    [t],
  );
  const copyConditionPreview = useCallback(
    async (
      rule: Pick<AlertRule, "sourceTable" | "conditionField" | "matchType" | "countThreshold">,
      mode: "human" | "sql",
    ) => {
      try {
        const text = mode === "sql" ? formatConditionPreviewSqlLike(rule) : formatConditionPreview(rule);
        await navigator.clipboard.writeText(text);
        Message.success(t("conditionCopied"));
      } catch {
        Message.error(t("conditionCopyFailed"));
      }
    },
    [t],
  );
  const toggleHistoryExpanded = useCallback((historyId: string) => {
    setExpandedHistoryIds((prev) => ({ ...prev, [historyId]: !prev[historyId] }));
  }, []);

  const historyColumns: TableColumnProps<AlertHistoryEntry>[] = useMemo(
    () => [
      {
        title: t("historyColTime"),
        dataIndex: "firedAt",
        width: 168,
        render: (ms: number) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {new Date(ms).toLocaleString()}
          </span>
        ),
      },
      {
        title: t("historyColRule"),
        dataIndex: "ruleName",
        ellipsis: true,
        render: (v: string) => (
          <Typography.Text className="text-xs text-foreground" ellipsis={{ showTooltip: true }}>
            {v}
          </Typography.Text>
        ),
      },
      {
        title: t("historyColSummary"),
        dataIndex: "summary",
        ellipsis: true,
        render: (v: string) => (
          <Typography.Text className="text-xs text-muted-foreground" ellipsis={{ showTooltip: true }}>
            {v}
          </Typography.Text>
        ),
      },
      {
        title: t("historyColContext"),
        dataIndex: "id",
        width: 260,
        render: (_: unknown, row: AlertHistoryEntry) => (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              {row.severity ? <Tag size="small" color={severityTagColor(row.severity)}>{row.severity}</Tag> : null}
              {row.alertCode ? <Tag size="small">{row.alertCode}</Tag> : null}
            </div>
            {row.conditionPreview ? (
              <Typography.Text className="block text-[11px] text-muted-foreground" ellipsis={{ showTooltip: true }}>
                {row.conditionPreview}
              </Typography.Text>
            ) : null}
            <Button type="text" size="mini" onClick={() => toggleHistoryExpanded(row.id)}>
              {expandedHistoryIds[row.id] ? t("hideHistoryContext") : t("showHistoryContext")}
            </Button>
            {expandedHistoryIds[row.id] ? (
              <div className="rounded border border-border/70 bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground">
                <div className="mb-1 text-foreground">
                  {t("historyContextSummary", {
                    sourceTable: row.sourceTable ?? "-",
                    conditionField: row.conditionField ?? "-",
                    matchType: formatMatchTypeLabel(row.matchType),
                    countThreshold: String(row.countThreshold ?? "-"),
                  })}
                </div>
                <div>sourceTable: {row.sourceTable ?? "-"}</div>
                <div>conditionField: {row.conditionField ?? "-"}</div>
                <div>matchType: {row.matchType ?? "-"}</div>
                <div>countThreshold: {row.countThreshold ?? "-"}</div>
              </div>
            ) : null}
          </div>
        ),
      },
      {
        title: t("historyColStatus"),
        dataIndex: "status",
        width: 100,
        render: (s: string) => (
          <Tag size="small" color={s === "sent" ? "green" : s === "failed" ? "red" : "gray"}>
            {s === "sent" ? t("status_sent") : s === "failed" ? t("status_failed") : t("status_pending")}
          </Tag>
        ),
      },
    ],
    [expandedHistoryIds, t, toggleHistoryExpanded],
  );
  const templateGroups = useMemo(
    () => ({
      P0: TEMPLATES.filter((tpl) => tpl.severity === "P0"),
      P1: TEMPLATES.filter((tpl) => tpl.severity === "P1"),
      P2: TEMPLATES.filter((tpl) => tpl.severity === "P2"),
    }),
    [],
  );
  const filteredRules = useMemo(() => {
    const kw = ruleCodeKeyword.trim().toLowerCase();
    return [...rules]
      .filter((r) => (ruleSeverityFilter === "all" ? true : r.severity === ruleSeverityFilter))
      .filter((r) => {
        if (!kw) {
          return true;
        }
        return (r.alertCode ?? "").toLowerCase().includes(kw) || r.name.toLowerCase().includes(kw);
      })
      .sort((a, b) => {
        const s = severityWeight(a.severity) - severityWeight(b.severity);
        if (s !== 0) {
          return s;
        }
        return b.updatedAt - a.updatedAt;
      });
  }, [ruleCodeKeyword, ruleSeverityFilter, rules]);
  const toggleRuleExpanded = useCallback((ruleId: string) => {
    setExpandedRuleIds((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
  }, []);

  if (!mounted) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1] flex justify-center py-16">
          <Spin />
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Typography.Title heading={3} className="ca-page-title !m-0 text-2xl font-semibold">
                {t("title")}
              </Typography.Title>
              <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
                {t("pageBlurb")}
              </Typography.Paragraph>
            </div>
            <Button type="primary" size="large" className="shrink-0 rounded-full" onClick={openCreate}>
              <IconPlus className="mr-1 inline" />
              {t("newRule")}
            </Button>
          </div>
          
          {source ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
              <Typography.Paragraph type="secondary" className="!mb-0 text-sm text-blue-600 dark:text-blue-400">
                {t("investigationContextHint", {
                  traceId: traceIdFromUrl || "—",
                  eventType: eventTypeFromUrl || "unknown",
                })}
              </Typography.Paragraph>
            </div>
          ) : null}
          
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{t("localModeTitle")}</span>
              <span className="ml-2">{t("localModeBody")}</span>
            </div>
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{t("mappingTitle")}</span>
              <span className="ml-2">{t("mappingBody")}</span>
            </div>
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{t("silenceOverviewTitle")}</span>
              <span className="ml-2">
                {t("silenceOverviewBody", {
                  activeCount: String(silenceOverview.activeCount),
                  expiringSoonCount: String(silenceOverview.expiringSoonCount),
                })}
              </span>
            </div>
          </div>
        </header>

        <section aria-label={t("activeRules")} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">🚨</span>
            <Typography.Title heading={6} className="!m-0 text-base font-semibold text-gray-800 dark:text-gray-200">
              {t("activeRules")}
            </Typography.Title>
          </div>

          {rules.length === 0 ? (
            <Card bordered={false} className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" bodyStyle={{ padding: "32px" }}>
              <div className="text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl dark:bg-gray-800">📋</div>
                <Typography.Title heading={6} className="!m-0 text-gray-800 dark:text-gray-200">
                  {t("noRulesTitle")}
                </Typography.Title>
                <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 text-sm text-gray-500">
                  {t("noRulesHint")}
                </Typography.Paragraph>
              </div>
            </Card>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("rulesFilterLabel")}</span>
                <Button type={ruleSeverityFilter === "all" ? "primary" : "outline"} size="small" className="rounded-full" onClick={() => setRuleSeverityFilter("all")}>
                  {t("filterAll")}
                </Button>
                <Button type={ruleSeverityFilter === "P0" ? "primary" : "outline"} size="small" className="rounded-full" onClick={() => setRuleSeverityFilter("P0")}>
                  P0
                </Button>
                <Button type={ruleSeverityFilter === "P1" ? "primary" : "outline"} size="small" className="rounded-full" onClick={() => setRuleSeverityFilter("P1")}>
                  P1
                </Button>
                <Button type={ruleSeverityFilter === "P2" ? "primary" : "outline"} size="small" className="rounded-full" onClick={() => setRuleSeverityFilter("P2")}>
                  P2
                </Button>
                <Input
                  className="w-[220px] rounded-lg border-gray-200 dark:border-gray-700"
                  size="small"
                  value={ruleCodeKeyword}
                  onChange={setRuleCodeKeyword}
                  placeholder={t("ruleCodeSearchPlaceholder")}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filteredRules.map((rule) => (
                  <Card key={rule.id} bordered={false} className="rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800/50" bodyStyle={{ padding: "20px" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Typography.Text bold className="block truncate text-[#1D2129] dark:text-foreground">
                          {rule.name}
                        </Typography.Text>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {rule.severity ? <Tag size="small" color={severityTagColor(rule.severity)}>{rule.severity}</Tag> : null}
                          {rule.alertCode ? <Tag size="small">{rule.alertCode}</Tag> : null}
                        </div>
                        <p className="mt-1 text-xs leading-snug text-muted-foreground">{formatRuleSummary(rule, t)}</p>
                        {rule.aggregateKey ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">{t("aggregateKeyLabel")}: {rule.aggregateKey}</p>
                        ) : null}
                        {rule.conditionSummary ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">{t("conditionLabel")}: {rule.conditionSummary}</p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("conditionPreviewLabel")}: {formatConditionPreviewSqlLike(rule)}
                        </p>
                        {expandedRuleIds[rule.id] ? (
                          <div className="mt-1 rounded border border-border/70 bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground">
                            <div>sourceTable: {rule.sourceTable ?? "-"}</div>
                            <div>conditionField: {rule.conditionField ?? "-"}</div>
                            <div>matchType: {rule.matchType ?? "-"}</div>
                            <div>countThreshold: {rule.countThreshold ?? "-"}</div>
                          </div>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Button type="text" size="mini" onClick={() => toggleRuleExpanded(rule.id)}>
                            {expandedRuleIds[rule.id] ? t("hideRuleDetails") : t("showRuleDetails")}
                          </Button>
                          <Button type="text" size="mini" onClick={() => void copyConditionPreview(rule, "sql")}>
                            {t("copyConditionPreview")}
                          </Button>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {rule.delivery === "webhook"
                            ? `${t("deliveryWebhookShort")}: ${rule.webhookType}`
                            : t("deliveryWebhookShort")}
                        </p>
                      </div>
                      <Switch checked={rule.enabled} size="small" onChange={(v) => toggleEnabled(rule, v)} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="outline" size="small" onClick={() => testNotify(rule)}>
                        {t("testNotify")}
                      </Button>
                      <Button type="outline" size="small" icon={<IconEdit />} onClick={() => openEdit(rule)}>
                        {t("editRule")}
                      </Button>
                      <Button type="outline" size="small" status="danger" icon={<IconDelete />} onClick={() => setDeleteTarget(rule)}>
                        {t("deleteRule")}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">📋</span>
              <Typography.Title heading={6} className="!m-0 text-base font-semibold text-gray-800 dark:text-gray-200">
                {t("templateLibraryTitle")}
              </Typography.Title>
            </div>
            <div className="space-y-4">
          {(["P0", "P1", "P2"] as const).map((sev) => (
            <div key={sev} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold",
                  sev === "P0" ? "bg-red-100 text-red-600 dark:bg-red-900/30" :
                  sev === "P1" ? "bg-orange-100 text-orange-600 dark:bg-orange-900/30" :
                  "bg-blue-100 text-blue-600 dark:bg-blue-900/30"
                )}>
                  {sev}
                </span>
                <Typography.Text bold className="text-sm text-gray-700 dark:text-gray-300">
                  {t("severityGroupTitle", { severity: sev })}
                </Typography.Text>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {templateGroups[sev].map((tpl) => (
                  <Card
                    key={tpl.id}
                    bordered={false}
                    className={cn(
                      "rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col transition-all hover:shadow-md hover:border-blue-200 dark:border-gray-700 dark:bg-gray-800/50",
                      templateCardGradientClass(tpl.id),
                    )}
                    bodyStyle={{ padding: "20px" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Typography.Text bold className="text-sm text-[#1D2129] dark:text-foreground">
                        {templateTitle(t, tpl.id)}
                      </Typography.Text>
                      <Tag size="small" color={severityTagColor(tpl.severity)}>{tpl.severity}</Tag>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{tpl.code}</p>
                    <p className="mt-2 min-h-[3rem] flex-1 text-xs leading-relaxed text-muted-foreground">
                      {templateDesc(t, tpl.id)}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {t("aggregateKeyLabel")}: {tpl.aggregateKey}
                    </p>
                    <Button type="primary" size="small" className="mt-3 w-full" onClick={() => applyTemplate(tpl)}>
                      {t("templateAdd")}
                    </Button>
                  </Card>
                ))}
              </div>
            </div>
          ))}
            </div>
          </div>
        </section>

        <section aria-label={t("alertHistory")} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">📜</span>
            <Typography.Title heading={6} className="!m-0 text-base font-semibold text-gray-800 dark:text-gray-200">
              {t("alertHistory")}
            </Typography.Title>
          </div>
          <Card bordered={false} className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" bodyStyle={{ padding: 0 }}>
            {history.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">{t("noHistory")}</div>
            ) : (
              <Table
                size="small"
                rowKey="id"
                columns={historyColumns}
                data={history}
                pagination={false}
                border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
                className="[&_.arco-table-th]:bg-[#f7f9fc] [&_.arco-table-th.arco-table-col-sorted]:bg-[#f7f9fc] dark:[&_.arco-table-th]:bg-muted/50"
              />
            )}
          </Card>
        </section>
        <section aria-label={t("silenceSectionTitle")} className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">🔇</span>
            <Typography.Title heading={6} className="!m-0 text-base font-semibold text-gray-800 dark:text-gray-200">
              {t("silenceSectionTitle")}
            </Typography.Title>
          </div>
          <Card bordered={false} className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" bodyStyle={{ padding: "16px" }}>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
              <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("silenceFilterLabel")}</span>
              <Button
                type={silenceScopeFilter === "all" ? "primary" : "outline"}
                size="small"
                className="rounded-full"
                onClick={() => setSilenceScopeFilter("all")}
              >
                {t("filterAll")}
              </Button>
              <Button
                type={silenceScopeFilter === "trace" ? "primary" : "outline"}
                size="small"
                className="rounded-full"
                onClick={() => setSilenceScopeFilter("trace")}
              >
                {t("silenceScopeTrace")}
              </Button>
              <Button
                type={silenceScopeFilter === "event_type" ? "primary" : "outline"}
                size="small"
                className="rounded-full"
                onClick={() => setSilenceScopeFilter("event_type")}
              >
                {t("silenceScopeEventType")}
              </Button>
            </div>
            {filteredSilenceRules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl dark:bg-gray-800">🔇</div>
                <p className="text-sm text-gray-500">{t("silenceListEmpty")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSilenceRules.slice(0, 20).map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30"
                  >
                    <div className="min-w-0 text-sm">
                      <div className="font-medium text-gray-700 dark:text-gray-300">
                        {rule.scope === "trace" ? t("silenceScopeTrace") : t("silenceScopeEventType")}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">
                        {rule.scope === "trace" ? `trace=${rule.traceId ?? "-"}` : `event=${rule.eventType ?? "-"}`}
                        {" · "}
                        {t("silenceActiveUntil", { time: new Date(rule.expireAt).toLocaleString() })}
                      </div>
                    </div>
                    <Button type="outline" size="small" className="rounded-full" onClick={() => clearSilenceById(rule.id)}>
                      {t("silenceCancel")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <Modal
          title={editingId ? t("modalEditTitle") : t("modalCreateTitle")}
          visible={modalOpen}
          onOk={saveRule}
          onCancel={() => setModalOpen(false)}
          okText={t("saveRule")}
          cancelText={t("cancel")}
          unmountOnExit
        >
          <div className="space-y-4 pt-2">
            {source ? (
              <Card bordered={false} className="border border-solid border-[#E5E6EB] bg-[#F7F8FA]" bodyStyle={{ padding: "10px 12px" }}>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-foreground">{t("prefillSourceCardTitle")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("prefillSourceCardSummary", {
                      traceId: traceIdFromUrl || "—",
                      spanId: spanIdFromUrl || "—",
                      eventType: eventTypeFromUrl || "unknown",
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {recommendedPreset.usedFallback
                      ? t("prefillRecommendedFallback", {
                          metric: recommendedPreset.metricKey,
                          operator: recommendedPreset.operator,
                          threshold: String(recommendedPreset.threshold),
                          windowMinutes: String(recommendedPreset.windowMinutes),
                        })
                      : t("prefillRecommended", {
                          metric: recommendedPreset.metricKey,
                          operator: recommendedPreset.operator,
                          threshold: String(recommendedPreset.threshold),
                          windowMinutes: String(recommendedPreset.windowMinutes),
                        })}
                  </div>
                  <Button type="text" size="mini" className="!px-0" onClick={restoreRecommendedPreset}>
                    {t("prefillRestoreRecommended")}
                  </Button>
                  {silenceMatched ? (
                    <Tag color="green" size="small">
                      {t("prefillSilenceActive", { time: new Date(silenceMatched.expireAt).toLocaleString() })}
                    </Tag>
                  ) : (
                    <Tag color="gray" size="small">
                      {t("prefillSilenceInactive")}
                    </Tag>
                  )}
                  <LocalizedLink
                    href={`${source === "risk" ? "/risk-center" : "/investigation-center"}?trace_id=${encodeURIComponent(traceIdFromUrl)}${spanIdFromUrl ? `&span_id=${encodeURIComponent(spanIdFromUrl)}` : ""}`}
                    className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {source === "risk" ? t("backToRiskCenter") : t("backToInvestigation")}
                  </LocalizedLink>
                </div>
              </Card>
            ) : null}
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formName")}</div>
              <Input value={name} onChange={setName} placeholder={t("formNamePh")} />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("alertCodeLabel")}</div>
              <Input value={alertCode} onChange={setAlertCode} placeholder="SEC_ENFORCE_HIT" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("severityLabel")}</div>
              <Select value={severity} onChange={(v) => setSeverity(v as AlertSeverity)} style={{ width: 160 }}>
                <Select.Option value="P0">P0</Select.Option>
                <Select.Option value="P1">P1</Select.Option>
                <Select.Option value="P2">P2</Select.Option>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formWhen")}</div>
              <Space wrap className="w-full">
                <Select value={metricKey} onChange={(v) => setMetricKey(v as AlertMetricKey)} style={{ minWidth: 200 }}>
                  {METRIC_OPTIONS.map((k) => (
                    <Select.Option key={k} value={k}>
                      {metricLabel(t, k)}
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  size="mini"
                  onClick={() => {
                    const advancedPreset = inferAdvancedCondition(eventTypeFromUrl, metricKey);
                    setSourceTable(advancedPreset.sourceTable ?? "");
                    setConditionField(advancedPreset.conditionField ?? "");
                    setMatchType(advancedPreset.matchType ?? "eq");
                    setCountThreshold(advancedPreset.countThreshold ?? 1);
                  }}
                >
                  {t("syncAdvancedFromMetric")}
                </Button>
                <Select value={operator} onChange={(v) => setOperator(v as AlertOperator)} style={{ width: 140 }}>
                  <Select.Option value="gt">{t("opGt")}</Select.Option>
                  <Select.Option value="lt">{t("opLt")}</Select.Option>
                  <Select.Option value="eq">{t("opEq")}</Select.Option>
                </Select>
                <InputNumber value={threshold} onChange={(v) => setThreshold(Number(v ?? 0))} min={0} style={{ width: 120 }} />
              </Space>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formWindow")}</div>
              <Space>
                <InputNumber value={windowMinutes} onChange={(v) => setWindowMinutes(Number(v ?? 1))} min={1} style={{ width: 120 }} />
                <span className="text-sm text-muted-foreground">{t("minutesLabel")}</span>
              </Space>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formWebhookType")}</div>
              <Select value={webhookType} onChange={(v) => setWebhookType(v as AlertWebhookType)} style={{ width: 220 }}>
                <Select.Option value="generic">{t("webhookGeneric")}</Select.Option>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formWebhookUrl")}</div>
              <Input value={webhookUrl} onChange={setWebhookUrl} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onChange={setEnabled} />
              <span className="text-sm text-muted-foreground">{t("formEnabled")}</span>
            </div>
            <div className="rounded border border-border/70 bg-muted/20 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">{t("advancedConfigTitle")}</div>
                <Button type="text" size="mini" onClick={() => setAdvancedConfigOpen((v) => !v)}>
                  {advancedConfigOpen ? t("advancedHide") : t("advancedShow")}
                </Button>
              </div>
              {advancedConfigOpen ? (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("aggregateKeyLabel")}</div>
                    <Input value={aggregateKey} onChange={setAggregateKey} placeholder="workspace + trace_id + policy_id" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("conditionLabel")}</div>
                    <Input value={conditionSummary} onChange={setConditionSummary} placeholder="intercepted = 1" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("sourceTableLabel")}</div>
                    <Input value={sourceTable} onChange={setSourceTable} placeholder="agent_exec_commands" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("conditionFieldLabel")}</div>
                    <Input value={conditionField} onChange={setConditionField} placeholder="permission_denied" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("matchTypeLabel")}</div>
                    <Select value={matchType} onChange={(v) => setMatchType(v as AlertMatchType)} style={{ width: 200 }}>
                      <Select.Option value="eq">eq</Select.Option>
                      <Select.Option value="contains">contains</Select.Option>
                      <Select.Option value="count_gte">count_gte</Select.Option>
                      <Select.Option value="ratio_gt">ratio_gt</Select.Option>
                      <Select.Option value="p95_gt">p95_gt</Select.Option>
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("countThresholdLabel")}</div>
                    <InputNumber
                      value={countThreshold}
                      onChange={(v) => setCountThreshold(Number(v ?? 1))}
                      min={1}
                      style={{ width: 120 }}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t("conditionPreviewLabel")}</div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Button
                        type={conditionPreviewMode === "human" ? "primary" : "outline"}
                        size="mini"
                        onClick={() => setConditionPreviewMode("human")}
                      >
                        {t("conditionModeHuman")}
                      </Button>
                      <Button
                        type={conditionPreviewMode === "sql" ? "primary" : "outline"}
                        size="mini"
                        onClick={() => setConditionPreviewMode("sql")}
                      >
                        {t("conditionModeSql")}
                      </Button>
                    </div>
                    <div className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                      {conditionPreviewMode === "sql"
                        ? formatConditionPreviewSqlLike({ sourceTable, conditionField, matchType, countThreshold })
                        : formatConditionPreview({ sourceTable, conditionField, matchType, countThreshold })}
                    </div>
                    <Button
                      className="mt-1"
                      type="text"
                      size="mini"
                      onClick={() =>
                        void copyConditionPreview({
                          sourceTable,
                          conditionField,
                          matchType,
                          countThreshold,
                        }, conditionPreviewMode)
                      }
                    >
                      {t("copyConditionPreview")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Modal>

        <Modal
          title={t("deleteConfirmTitle")}
          visible={deleteTarget != null}
          onOk={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          okText={t("confirmDelete")}
          cancelText={t("cancel")}
          okButtonProps={{ status: "danger" }}
        >
          <p className="text-sm text-muted-foreground">{t("deleteConfirmBody", { name: deleteTarget?.name ?? "" })}</p>
        </Modal>
      </main>
    </AppPageShell>
  );
}
