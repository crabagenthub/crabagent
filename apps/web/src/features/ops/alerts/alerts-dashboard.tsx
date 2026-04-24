"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Dropdown,
  Input,
  InputNumber,
  Message,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import type { TableColumnProps } from "@arco-design/web-react";
import { IconDelete, IconEdit, IconMore, IconPlus, IconRefresh } from "@arco-design/web-react/icon";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/components/app-page-shell";
import { LocalizedLink } from "@/components/localized-link";
import {
  deleteAlertRuleApi,
  fetchAlertEvents,
  fetchAlertRules,
  migrateLocalStorageRulesToServer,
  postAlertRuleTest,
  saveAlertRuleApi,
} from "@/lib/alert-rules-api";
import {
  newRuleId,
  type AlertDelivery,
  type AlertFrequencyMode,
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
];

const TEMPLATE_GROUP_IDS: { labelKey: "templateGroupSec" | "templateGroupResource" | "templateGroupCmd"; ids: string[] }[] = [
  { labelKey: "templateGroupSec", ids: ["sec_enforce_hit"] },
  {
    labelKey: "templateGroupResource",
    ids: [
      "resource_sensitive_path",
      "resource_secret_credential_hint",
      "resource_large_read_burst",
      "resource_redundant_read_burst",
    ],
  },
  {
    labelKey: "templateGroupCmd",
    ids: ["cmd_permission_denied_burst", "cmd_not_found_burst", "cmd_token_risk_burst", "cmd_loop_alert"],
  },
];

const CUSTOM_TEMPLATE_ID = "custom" as const;

function findTemplateIdForRule(rule: AlertRule): string {
  if (rule.templateId && TEMPLATES.some((x) => x.id === rule.templateId)) {
    return rule.templateId;
  }
  if (rule.alertCode) {
    const byCode = TEMPLATES.find((x) => x.code === rule.alertCode);
    if (byCode) {
      return byCode.id;
    }
  }
  return CUSTOM_TEMPLATE_ID;
}

function templateEmoji(id: string): string {
  switch (id) {
    case "sec_enforce_hit":
      return "🛡️";
    case "resource_sensitive_path":
      return "📁";
    case "resource_secret_credential_hint":
      return "🔑";
    case "cmd_permission_denied_burst":
      return "⛔";
    case "cmd_not_found_burst":
      return "❓";
    case "cmd_token_risk_burst":
      return "⚠️";
    case "cmd_loop_alert":
      return "🔁";
    case "resource_large_read_burst":
      return "📖";
    case "resource_redundant_read_burst":
      return "🔂";
    default:
      return "📋";
  }
}

function templateTitle(t: ReturnType<typeof useTranslations<"Alerts">>, id: string): string {
  return t(`tpl_${id}_name`);
}

function templateDesc(t: ReturnType<typeof useTranslations<"Alerts">>, id: string): string {
  return t(`tpl_${id}_desc`);
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
  const tid = findTemplateIdForRule(rule);
  const label =
    tid !== CUSTOM_TEMPLATE_ID ? templateTitle(t, tid) : metricLabel(t, rule.metricKey);
  const isImmediate = rule.frequencyMode === "immediate";
  const freq = isImmediate
    ? t("summaryFrequencyImmediate")
    : t("summaryFrequencyWindowed", { n: String(rule.windowMinutes) });
  return `${label} · ${freq} · ${opLabel(t, rule.operator)} ${rule.threshold}`;
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
  const locale = useLocale();
  const sp = useSearchParams();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const rulesQuery = useQuery({
    queryKey: ["alertRules"],
    queryFn: fetchAlertRules,
    enabled: mounted,
  });
  const historyQuery = useQuery({
    queryKey: ["alertEvents"],
    queryFn: fetchAlertEvents,
    enabled: mounted,
  });
  const rules = rulesQuery.data ?? [];
  const historyWithNames = useMemo((): AlertHistoryEntry[] => {
    const h = historyQuery.data ?? [];
    return h.map((row) => {
      const r = rules.find((x) => x.id === row.ruleId);
      return { ...row, ruleName: r?.name?.trim() ? r.name : row.ruleId || "—" };
    });
  }, [historyQuery.data, rules]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [alertCode, setAlertCode] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity>("P1");
  const [aggregateKey, setAggregateKey] = useState("");
  const [conditionSummary, setConditionSummary] = useState("");
  const [sourceTable, setSourceTable] = useState("");
  const [conditionField, setConditionField] = useState("");
  const [matchType, setMatchType] = useState<AlertMatchType>("eq");
  const [countThreshold, setCountThreshold] = useState(1);
  const [ruleNameKeyword, setRuleNameKeyword] = useState("");
  const [metricKey, setMetricKey] = useState<AlertMetricKey>("error_rate_pct");
  const [operator, setOperator] = useState<AlertOperator>("gt");
  const [threshold, setThreshold] = useState<number>(5);
  const [windowMinutes, setWindowMinutes] = useState<number>(5);
  const [delivery] = useState<AlertDelivery>("webhook");
  const [webhookType, setWebhookType] = useState<AlertWebhookType>("generic");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(TEMPLATES[0]!.id);
  const [frequencyMode, setFrequencyMode] = useState<AlertFrequencyMode>("windowed");
  const [subWindowMinutes, setSubWindowMinutes] = useState(0);
  const [subWindowMode, setSubWindowMode] = useState("any_max");
  const [hasAppliedInvestigationPreset, setHasAppliedInvestigationPreset] = useState(false);
  const [silenceVersion, setSilenceVersion] = useState(0);
  const [silenceScopeFilter, setSilenceScopeFilter] = useState<"all" | "trace" | "event_type">("all");
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

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void queryClient.invalidateQueries({ queryKey: ["alertEvents"] });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [queryClient]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    void migrateLocalStorageRulesToServer().then(() => {
      void queryClient.invalidateQueries({ queryKey: ["alertRules"] });
    });
  }, [mounted, queryClient]);

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
    const prefillTid =
      eventTypeFromUrl === "policy_hit"
        ? "sec_enforce_hit"
        : eventTypeFromUrl === "resource"
          ? "resource_sensitive_path"
          : "cmd_permission_denied_burst";
    setSelectedTemplateId(prefillTid);
    setFrequencyMode("windowed");
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
    const def = TEMPLATES[0]!;
    setSelectedTemplateId(def.id);
    setFrequencyMode("windowed");
    setName(templateTitle(t, def.id));
    setAlertCode(def.code);
    setSeverity(def.severity);
    setAggregateKey(def.aggregateKey);
    setConditionSummary(def.conditionSummary);
    setSourceTable(def.sourceTable);
    setConditionField(def.conditionField);
    setMatchType(def.matchType);
    setCountThreshold(def.countThreshold);
    setMetricKey(def.metricKey);
    setOperator(def.operator);
    setThreshold(def.threshold);
    setWindowMinutes(def.windowMinutes);
    setWebhookType("generic");
    setWebhookUrl("");
    setEnabled(true);
    setSubWindowMinutes(0);
    setSubWindowMode("any_max");
    setModalOpen(true);
  }, [t]);

  const applyTemplate = useCallback(
    (tpl: TemplateDef) => {
      setEditingId(null);
      setSelectedTemplateId(tpl.id);
      setFrequencyMode("windowed");
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
      setSubWindowMinutes(0);
      setSubWindowMode("any_max");
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
    setSelectedTemplateId(findTemplateIdForRule(rule));
    setFrequencyMode(
      rule.frequencyMode === "immediate" || rule.frequencyMode === "windowed" ? rule.frequencyMode : "windowed",
    );
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
    setSubWindowMinutes(rule.subWindowMinutes ?? 0);
    setSubWindowMode(rule.subWindowMode?.trim() ? rule.subWindowMode : "any_max");
    setModalOpen(true);
  }, []);

  const saveRule = useCallback(() => {
    const n = name.trim();
    if (!n) {
      Message.warning(t("validateName"));
      return;
    }
    void (async () => {
      const now = Date.now();
      const fallbackAdvanced = inferAdvancedCondition(eventTypeFromUrl, metricKey);
      const resolvedSourceTable = sourceTable.trim() || fallbackAdvanced.sourceTable || undefined;
      const resolvedConditionField = conditionField.trim() || fallbackAdvanced.conditionField || undefined;
      const resolvedMatchType = matchType || fallbackAdvanced.matchType;
      const resolvedCountThreshold = Math.max(1, Math.floor(Number(countThreshold)) || fallbackAdvanced.countThreshold || 1);
      const tpl = TEMPLATES.find((x) => x.id === selectedTemplateId);
      const useCustom = !tpl || selectedTemplateId === CUSTOM_TEMPLATE_ID;
      const winUser = Math.max(1, Math.floor(Number(windowMinutes)) || 1);
      const thrUser = Number(threshold);
      const finalWindow = frequencyMode === "immediate" ? 1 : winUser;
      const finalThreshold = frequencyMode === "immediate" ? 1 : thrUser;
      const swRaw = frequencyMode === "immediate" ? 0 : Math.max(0, Math.floor(Number(subWindowMinutes)) || 0);
      const subOk = frequencyMode === "windowed" && swRaw > 0 && swRaw < finalWindow;
      const idNew = editingId ?? newRuleId();
      const created = editingId ? rules.find((r) => r.id === editingId)?.createdAt ?? now : now;
      const next: AlertRule = useCustom
        ? {
            id: idNew,
            name: n,
            templateId: undefined,
            frequencyMode,
            ruleLanguage: locale,
            subWindowMinutes: swRaw,
            subWindowMode: subOk ? (subWindowMode || "any_max").trim() : "any_max",
            alertCode: alertCode.trim() || undefined,
            severity,
            aggregateKey: aggregateKey.trim() || undefined,
            conditionSummary: conditionSummary.trim() || undefined,
            sourceTable: resolvedSourceTable,
            conditionField: resolvedConditionField,
            matchType: resolvedMatchType,
            countThreshold: frequencyMode === "immediate" ? 1 : resolvedCountThreshold,
            metricKey,
            operator,
            threshold: finalThreshold,
            windowMinutes: finalWindow,
            delivery,
            webhookType,
            webhookUrl: webhookUrl.trim(),
            enabled,
            createdAt: created,
            updatedAt: now,
          }
        : {
            id: idNew,
            name: n,
            templateId: tpl.id,
            frequencyMode,
            ruleLanguage: locale,
            subWindowMinutes: swRaw,
            subWindowMode: subOk ? (subWindowMode || "any_max").trim() : "any_max",
            alertCode: tpl.code,
            severity: tpl.severity,
            aggregateKey: tpl.aggregateKey,
            conditionSummary: tpl.conditionSummary,
            sourceTable: tpl.sourceTable,
            conditionField: tpl.conditionField,
            matchType: tpl.matchType,
            countThreshold:
              frequencyMode === "immediate"
                ? 1
                : Math.max(1, Math.floor(Number(countThreshold)) || tpl.countThreshold),
            metricKey: tpl.metricKey,
            operator: tpl.operator,
            threshold: finalThreshold,
            windowMinutes: finalWindow,
            delivery,
            webhookType,
            webhookUrl: webhookUrl.trim(),
            enabled,
            createdAt: created,
            updatedAt: now,
          };
      try {
        await saveAlertRuleApi(next, editingId);
        await queryClient.invalidateQueries({ queryKey: ["alertRules"] });
        setModalOpen(false);
        Message.success(t("saveOk"));
      } catch (e) {
        Message.error(String(e));
      }
    })();
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
    queryClient,
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
    selectedTemplateId,
    frequencyMode,
    locale,
    subWindowMinutes,
    subWindowMode,
  ]);

  const confirmDelete = useCallback(async (rule: AlertRule) => {
    try {
      await deleteAlertRuleApi(rule.id);
      await queryClient.invalidateQueries({ queryKey: ["alertRules"] });
      Message.success(t("deleteOk"));
    } catch (e) {
      Message.error(String(e));
    }
  }, [queryClient, t]);

  const toggleEnabled = useCallback(
    (ruleId: string, nextEnabled: boolean) => {
      if (!ruleId) {
        return;
      }
      const list = queryClient.getQueryData<AlertRule[]>(["alertRules"]) ?? [];
      const ruleBefore = list.find((r) => r.id === ruleId);
      if (!ruleBefore) {
        return;
      }
      const now = Date.now();
      queryClient.setQueryData<AlertRule[]>(["alertRules"], (old) => {
        if (!old) {
          return old;
        }
        return old.map((r) => (r.id === ruleId ? { ...r, enabled: nextEnabled, updatedAt: now } : r));
      });
      void (async () => {
        try {
          const latest = (queryClient.getQueryData<AlertRule[]>(["alertRules"]) ?? []).find((r) => r.id === ruleId);
          if (!latest) {
            return;
          }
          await saveAlertRuleApi({ ...latest, enabled: nextEnabled, updatedAt: now }, ruleId);
          await queryClient.invalidateQueries({ queryKey: ["alertRules"] });
          Message.success(nextEnabled ? t("toggleEnabledOn") : t("toggleEnabledOff"));
        } catch (e) {
          queryClient.setQueryData<AlertRule[]>(["alertRules"], (old) => {
            if (!old) {
              return old;
            }
            return old.map((r) => (r.id === ruleId ? { ...ruleBefore } : r));
          });
          Message.error(String(e));
        }
      })();
    },
    [queryClient, t],
  );

  const testNotify = useCallback(
    (rule: AlertRule) => {
      void (async () => {
        try {
          await postAlertRuleTest(rule.id);
          await queryClient.invalidateQueries({ queryKey: ["alertEvents"] });
          Message.info(t("testNotifyQueued"));
        } catch (e) {
          Message.error(String(e));
        }
      })();
    },
    [queryClient, t],
  );

  const clearSilenceById = useCallback(
    (id: string) => {
      removeAuditSilenceRule(id);
      setSilenceVersion((v) => v + 1);
      Message.success(t("silenceCleared"));
    },
    [t],
  );
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
    [t],
  );
  const filteredRules = useMemo(() => {
    const kw = ruleNameKeyword.trim().toLowerCase();
    return [...rules]
      .filter((r) => {
        if (!kw) {
          return true;
        }
        return r.name.toLowerCase().includes(kw);
      })
      .sort((a, b) => {
        const byCreated = b.createdAt - a.createdAt;
        if (byCreated !== 0) {
          return byCreated;
        }
        return b.id.localeCompare(a.id);
      });
  }, [ruleNameKeyword, rules]);

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
      <main className="ca-page relative z-[1] space-y-5 pb-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Typography.Title heading={3} className="ca-page-title !m-0 text-2xl font-semibold tracking-tight">
              {t("title")}
            </Typography.Title>
            {rulesQuery.isError ? (
              <Typography.Paragraph className="!mb-0 !mt-1 text-sm text-red-600 dark:text-red-400">
                {t("loadRulesError")}
              </Typography.Paragraph>
            ) : null}
          </div>
          <Button
            type="primary"
            size="default"
            className="h-9 shrink-0 rounded-lg px-4 shadow-sm"
            onClick={openCreate}
          >
            <IconPlus className="mr-1 inline" />
            {t("newRule")}
          </Button>
        </header>

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

        <section aria-label={t("activeRules")} className="space-y-3">
          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm dark:bg-card/60 sm:p-8">
            {rulesQuery.isLoading && rules.length === 0 ? (
              <div className="flex justify-center py-16">
                <Spin />
              </div>
            ) : (
              <div className="space-y-8">
                {rules.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">{t("rulesFilterLabel")}</span>
                      <Input
                        className="w-full max-w-sm rounded-lg"
                        size="small"
                        value={ruleNameKeyword}
                        onChange={setRuleNameKeyword}
                        placeholder={t("ruleNameSearchPlaceholder")}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredRules.map((rule, index) => {
                        const updatedAt = rule.updatedAt
                          ? new Date(rule.updatedAt).toLocaleString("zh-CN", {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "";

                        return (
                          <Card
                            key={rule.id ? `rule-${rule.id}` : `rule-idx-${index}`}
                            bordered={false}
                            className="group relative rounded-xl border border-border/60 bg-background/80 dark:bg-background/40 transition-shadow hover:shadow-md"
                            bodyStyle={{ padding: "18px" }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <Typography.Text bold className="block text-base text-foreground">
                                  {rule.name}
                                </Typography.Text>
                                <p className="mt-2 text-sm leading-snug text-muted-foreground">
                                  {formatRuleSummary(rule, t)}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {rule.delivery === "webhook"
                                    ? `${t("deliveryWebhookShort")}: ${rule.webhookType}`
                                    : t("deliveryWebhookShort")}
                                </p>
                              </div>
                              <Switch
                                checked={Boolean(rule.enabled)}
                                size="small"
                                onChange={(v) => toggleEnabled(rule.id, v)}
                              />
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">
                                {t("updatedAt")}: {updatedAt}
                              </p>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="primary"
                                  size="small"
                                  className="opacity-0 transition-opacity group-hover:opacity-100"
                                  onClick={() => testNotify(rule)}
                                >
                                  {t("testNotify")}
                                </Button>
                                <Dropdown
                                  trigger="click"
                                  position="bottom"
                                  droplist={
                                    <div>
                                      <Button
                                        type="text"
                                        size="small"
                                        icon={<IconEdit />}
                                        onClick={() => openEdit(rule)}
                                      >
                                        {t("editRule")}
                                      </Button>
                                      <Popconfirm
                                        title={t("deleteConfirmTitle")}
                                        content={t("deleteConfirmBody", { name: rule.name })}
                                        onOk={() => confirmDelete(rule)}
                                        okText={t("confirmDelete")}
                                        cancelText={t("cancel")}
                                        okButtonProps={{ status: "danger" }}
                                      >
                                        <Button
                                          type="text"
                                          size="small"
                                          icon={<IconDelete />}
                                          status="danger"
                                        >
                                          {t("deleteRule")}
                                        </Button>
                                      </Popconfirm>
                                    </div>
                                  }
                                >
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<IconMore />}
                                    className="opacity-0 transition-opacity group-hover:opacity-100"
                                  />
                                </Dropdown>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-2xl">
                      📋
                    </div>
                    <Typography.Title heading={6} className="!m-0 text-foreground">
                      {t("noRulesTitle")}
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !mt-2 text-sm text-muted-foreground">
                      {t("noRulesHint")}
                    </Typography.Paragraph>
                  </div>
                )}

                <div className={cn(rules.length > 0 && "border-t border-border/80 pt-8")}>
                  {rules.length > 0 ? (
                    <Typography.Text className="mb-4 block text-sm font-medium text-foreground">
                      {t("templatesSectionTitle")}
                    </Typography.Text>
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {TEMPLATES.map((tpl) => (
                      <Card
                        key={tpl.id}
                        bordered={false}
                        className="min-w-0 rounded-xl border border-border/60 bg-background/50 transition-colors hover:border-primary/25 dark:bg-background/30"
                        bodyStyle={{ padding: "20px" }}
                      >
                        <div className="flex gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl">
                            {templateEmoji(tpl.id)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <Typography.Text bold className="!block text-sm leading-snug text-foreground">
                              {templateTitle(t, tpl.id)}
                            </Typography.Text>
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                              {templateDesc(t, tpl.id)}
                            </p>
                          </div>
                        </div>
                        <Button type="primary" className="mt-4 w-full rounded-lg" onClick={() => applyTemplate(tpl)}>
                          {t("templateAdd")}
                        </Button>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section aria-label={t("alertHistory")} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Typography.Title heading={6} className="!m-0 text-base font-semibold text-foreground">
              {t("alertHistory")}
            </Typography.Title>
            <div className="flex flex-wrap items-center gap-2">
              <Typography.Text type="secondary" className="text-xs">
                {t("historyLastUpdated", {
                  time:
                    historyQuery.dataUpdatedAt > 0
                      ? new Date(historyQuery.dataUpdatedAt).toLocaleString()
                      : t("historyNeverFetched"),
                })}
              </Typography.Text>
              <Button
                type="outline"
                size="small"
                className="rounded-lg"
                icon={<IconRefresh className={cn(historyQuery.isFetching && "animate-spin")} />}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["alertEvents"] })}
              >
                {t("historyRefresh")}
              </Button>
            </div>
          </div>
          <Card
            bordered={false}
            className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm dark:bg-card/60"
            bodyStyle={{ padding: 0 }}
          >
            {historyWithNames.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">{t("noHistory")}</div>
            ) : (
              <Table
                size="small"
                rowKey="id"
                columns={historyColumns}
                data={historyWithNames}
                pagination={false}
                border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
                className="[&_.arco-table-th]:bg-[#f7f9fc] dark:[&_.arco-table-th]:bg-muted/50"
              />
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
              <div className="mb-1 text-xs text-muted-foreground">{t("formAlertItem")}</div>
              <Select
                value={selectedTemplateId}
                onChange={(v) => {
                  const id = v as string;
                  setSelectedTemplateId(id);
                  if (id === CUSTOM_TEMPLATE_ID) {
                    return;
                  }
                  const nt = TEMPLATES.find((x) => x.id === id);
                  if (!nt) {
                    return;
                  }
                  if (!editingId) {
                    setName(templateTitle(t, nt.id));
                  }
                  setAlertCode(nt.code);
                  setSeverity(nt.severity);
                  setAggregateKey(nt.aggregateKey);
                  setConditionSummary(nt.conditionSummary);
                  setSourceTable(nt.sourceTable);
                  setConditionField(nt.conditionField);
                  setMatchType(nt.matchType);
                  setCountThreshold(nt.countThreshold);
                  setMetricKey(nt.metricKey);
                  setOperator(nt.operator);
                  setThreshold(nt.threshold);
                  setWindowMinutes(nt.windowMinutes);
                }}
                className="w-full min-w-0"
                triggerProps={{ className: "w-full" }}
              >
                {TEMPLATE_GROUP_IDS.map((g) => (
                  <Select.OptGroup key={g.labelKey} label={t(g.labelKey)}>
                    {g.ids.map((id) => (
                      <Select.Option key={id} value={id}>
                        {templateTitle(t, id)}
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                ))}
                <Select.Option value={CUSTOM_TEMPLATE_ID}>{t("formAlertItemCustom")}</Select.Option>
              </Select>
            </div>
            {selectedTemplateId === CUSTOM_TEMPLATE_ID ? (
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
                  <Select value={operator} onChange={(v) => setOperator(v as AlertOperator)} style={{ width: 140 }}>
                    <Select.Option value="gt">{t("opGt")}</Select.Option>
                    <Select.Option value="lt">{t("opLt")}</Select.Option>
                    <Select.Option value="eq">{t("opEq")}</Select.Option>
                  </Select>
                  <InputNumber value={threshold} onChange={(v) => setThreshold(Number(v ?? 0))} min={0} style={{ width: 120 }} />
                </Space>
              </div>
            ) : null}
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("formFrequency")}</div>
              <Radio.Group
                value={frequencyMode}
                onChange={(v) => setFrequencyMode(v as AlertFrequencyMode)}
                className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
              >
                <Radio value="immediate">{t("formFrequencyImmediate")}</Radio>
                <Radio value="windowed">{t("formFrequencyWindowed")}</Radio>
              </Radio.Group>
              <Typography.Paragraph type="secondary" className="!mb-0 !mt-2 text-xs">
                {t("formFrequencyHelp")}
              </Typography.Paragraph>
            </div>
            {frequencyMode === "immediate" ? (
              <div className="rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {t("formImmediateNote")}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">{t("formWindow")}</div>
                  <Space>
                    <InputNumber
                      value={windowMinutes}
                      onChange={(v) => setWindowMinutes(Number(v ?? 1))}
                      min={1}
                      style={{ width: 120 }}
                    />
                    <span className="text-sm text-muted-foreground">{t("minutesLabel")}</span>
                  </Space>
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">
                    {selectedTemplateId === CUSTOM_TEMPLATE_ID
                      ? t("formThreshold")
                      : t("formEventThreshold")}
                  </div>
                  <InputNumber
                    value={threshold}
                    onChange={(v) => setThreshold(Number(v ?? 0))}
                    min={0}
                    style={{ width: 120 }}
                  />
                  {matchType === "count_gte" ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs text-muted-foreground">{t("formCountFieldThreshold")}</div>
                      <InputNumber
                        value={countThreshold}
                        onChange={(v) => setCountThreshold(Math.max(1, Number(v ?? 1)))}
                        min={1}
                        style={{ width: 120 }}
                      />
                    </div>
                  ) : null}
                  <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-2">
                    <div className="mb-1 text-xs font-medium text-foreground">{t("formSubWindow")}</div>
                    <Space wrap className="items-center">
                      <InputNumber
                        value={subWindowMinutes}
                        onChange={(v) => setSubWindowMinutes(Math.max(0, Number(v ?? 0)))}
                        min={0}
                        style={{ width: 120 }}
                      />
                      <span className="text-xs text-muted-foreground">{t("minutesLabel")}</span>
                      <Select value={subWindowMode} onChange={setSubWindowMode} style={{ width: 160 }} disabled={subWindowMinutes <= 0}>
                        <Select.Option value="any_max">{t("formSubWindowModeAnyMax")}</Select.Option>
                      </Select>
                    </Space>
                    <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-xs">
                      {t("formSubWindowHint")}
                    </Typography.Paragraph>
                  </div>
                </div>
              </div>
            )}
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
          </div>
        </Modal>

      </main>
    </AppPageShell>
  );
}
