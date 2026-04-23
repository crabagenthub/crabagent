"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Message, Space, Spin, Table, Tag, Typography } from "@arco-design/web-react";
import type { TableColumnProps } from "@arco-design/web-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { LocalizedLink } from "@/shared/components/localized-link";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { defaultObserveDateRange, resolveObserveSinceUntil } from "@/lib/observe-date-range";
import { parseObserveDateRangeFromListUrl } from "@/lib/observe-list-deep-link";
import { loadResourceAuditEvents } from "@/lib/resource-audit-records";
import { loadSecurityAuditEvents } from "@/lib/security-audit-records";
import { loadShellExecList } from "@/lib/shell-exec-api";
import {
  appendAuditSilenceRule,
  matchAuditSilence,
  readActiveAuditSilences,
  removeAuditSilenceRule,
  type AuditSilenceRule,
  type AuditSilenceScope,
} from "@/lib/audit-silence-storage";
import { getAuditEventTypeColor } from "@/lib/audit-ui-semantics";
import { buildSearchParamsString } from "@/lib/url-search-params";
import {
  clearInvestigationVerdict,
  getInvestigationVerdict,
  saveInvestigationVerdict,
  type InvestigationVerdictRecord,
  type InvestigationVerdictValue,
} from "@/lib/investigation-verdict-storage";

type TimelineRow = {
  key: string;
  eventType: "command" | "resource" | "policy_hit";
  timeMs: number;
  traceId: string;
  spanId?: string;
  subject: string;
  evidence: string;
  actor: string;
  target: string;
  result: string;
  whyFlagged: string;
  sourcePage: "/command-analysis" | "/resource-audit" | "/data-security-audit";
  silencedBy?: AuditSilenceRule | null;
  verdict?: InvestigationVerdictRecord | null;
};

const EVENT_TYPE_FILTER_VALUES = new Set<TimelineRow["eventType"]>(["command", "resource", "policy_hit"]);
const SOURCE_PAGE_FILTER_VALUES = new Set<TimelineRow["sourcePage"]>([
  "/command-analysis",
  "/resource-audit",
  "/data-security-audit",
]);

function applyRangeToQuery(sp: URLSearchParams, range: ReturnType<typeof defaultObserveDateRange>): void {
  if (range.kind === "preset" && range.preset === "all") {
    sp.delete("since_ms");
    sp.delete("until_ms");
    sp.set("observe_window", "all");
    return;
  }
  const { sinceMs, untilMs } = resolveObserveSinceUntil(range);
  sp.delete("observe_window");
  if (sinceMs != null && sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(sinceMs)));
  } else {
    sp.delete("since_ms");
  }
  if (untilMs != null && untilMs > 0) {
    sp.set("until_ms", String(Math.floor(untilMs)));
  } else {
    sp.delete("until_ms");
  }
}

function recommendedRuleParams(eventType: TimelineRow["eventType"]): {
  metric: string;
  operator: string;
  threshold: number;
  windowMinutes: number;
} {
  if (eventType === "command") {
    return { metric: "error_rate_pct", operator: "gt", threshold: 5, windowMinutes: 5 };
  }
  if (eventType === "resource") {
    return { metric: "sensitive_data_hits", operator: "gt", threshold: 1, windowMinutes: 5 };
  }
  return { metric: "sensitive_data_hits", operator: "gt", threshold: 1, windowMinutes: 5 };
}

function sourcePageLabel(t: ReturnType<typeof useTranslations>, sourcePage: TimelineRow["sourcePage"]): string {
  if (sourcePage === "/command-analysis") {
    return t("sourcePageCommand");
  }
  if (sourcePage === "/resource-audit") {
    return t("sourcePageResource");
  }
  return t("sourcePageSecurity");
}

function commandWhyFlagged(row: Record<string, unknown>): string {
  const parsed = (row.parsed ?? {}) as Record<string, unknown>;
  if (parsed.success === false) {
    return "command_failed";
  }
  if (parsed.tokenRisk === true) {
    return "token_risk";
  }
  return "heuristic_risk";
}

function resourceWhyFlagged(flags: string[]): string {
  if (flags.length > 0) {
    return flags.slice(0, 3).join(", ");
  }
  return "normal_resource_access";
}

function policyWhyFlagged(intercepted: boolean | number): string {
  return Boolean(intercepted) ? "policy_intercepted" : "policy_observe_only";
}

function verdictColor(verdict: InvestigationVerdictValue): string {
  if (verdict === "confirmed_risk") {
    return "red";
  }
  if (verdict === "false_positive") {
    return "gray";
  }
  if (verdict === "resolved") {
    return "green";
  }
  return "arcoblue";
}

function verdictLabel(t: ReturnType<typeof useTranslations>, verdict: InvestigationVerdictValue): string {
  if (verdict === "confirmed_risk") {
    return t("verdictConfirmedRisk");
  }
  if (verdict === "false_positive") {
    return t("verdictFalsePositive");
  }
  if (verdict === "resolved") {
    return t("verdictResolved");
  }
  return t("verdictMonitoring");
}

export function InvestigationCenterDashboard() {
  const tNav = useTranslations("Nav");
  const tCmd = useTranslations("CommandAnalysis");
  const t = useTranslations("InvestigationCenter");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const traceId = searchParams.get("trace_id")?.trim() ?? "";
  const selectedKeyFromUrl = searchParams.get("event_key")?.trim() ?? "";
  const eventTypeFromUrl = searchParams.get("event_type")?.trim() ?? "";
  const sourcePageFromUrl = searchParams.get("source_page")?.trim() ?? "";
  const keywordFromUrl = searchParams.get("keyword")?.trim() ?? "";
  const advancedFromUrl = searchParams.get("advanced")?.trim() ?? "";
  const fromRiskCenter = searchParams.get("from") === "risk";
  const eventTypeFilterFromQuery = useMemo<"all" | TimelineRow["eventType"]>(
    () =>
      eventTypeFromUrl && EVENT_TYPE_FILTER_VALUES.has(eventTypeFromUrl as TimelineRow["eventType"])
        ? (eventTypeFromUrl as TimelineRow["eventType"])
        : "all",
    [eventTypeFromUrl],
  );
  const sourceFilterFromQuery = useMemo<"all" | TimelineRow["sourcePage"]>(
    () =>
      sourcePageFromUrl && SOURCE_PAGE_FILTER_VALUES.has(sourcePageFromUrl as TimelineRow["sourcePage"])
        ? (sourcePageFromUrl as TimelineRow["sourcePage"])
        : "all",
    [sourcePageFromUrl],
  );
  const advancedOpenFromQuery = advancedFromUrl === "1";
  const [mounted, setMounted] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(advancedOpenFromQuery);
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | TimelineRow["eventType"]>(eventTypeFilterFromQuery);
  const [sourceFilter, setSourceFilter] = useState<"all" | TimelineRow["sourcePage"]>(sourceFilterFromQuery);
  const [keyword, setKeyword] = useState(keywordFromUrl);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [silenceScope, setSilenceScope] = useState<AuditSilenceScope>("trace");
  const [silenceMinutes, setSilenceMinutes] = useState(60);
  const [activeSilence, setActiveSilence] = useState<AuditSilenceRule | null>(null);
  const [silenceVersion, setSilenceVersion] = useState(0);
  const [verdictVersion, setVerdictVersion] = useState(0);
  const [verdictValue, setVerdictValue] = useState<InvestigationVerdictValue>("monitoring");
  const [verdictNote, setVerdictNote] = useState("");
  const dateRange = useMemo(
    () => parseObserveDateRangeFromListUrl(new URLSearchParams(searchParams.toString())) ?? defaultObserveDateRange(),
    [searchParams],
  );
  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange), [dateRange]);

  useEffect(() => {
    setMounted(true);
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
  }, []);
  useEffect(() => {
    setEventTypeFilter(eventTypeFilterFromQuery);
  }, [eventTypeFilterFromQuery]);
  useEffect(() => {
    setSourceFilter(sourceFilterFromQuery);
  }, [sourceFilterFromQuery]);
  useEffect(() => {
    setKeyword(keywordFromUrl);
  }, [keywordFromUrl]);
  useEffect(() => {
    setAdvancedOpen(advancedOpenFromQuery);
  }, [advancedOpenFromQuery]);

  const setEventTypeFilterInUrl = useCallback(
    (nextType: "all" | TimelineRow["eventType"]) => {
      setEventTypeFilter(nextType);
      const qs = buildSearchParamsString(searchParams, {
        event_type: nextType === "all" ? null : nextType,
      });
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );
  const setSourceFilterInUrl = useCallback(
    (nextSource: "all" | TimelineRow["sourcePage"]) => {
      setSourceFilter(nextSource);
      const qs = buildSearchParamsString(searchParams, {
        source_page: nextSource === "all" ? null : nextSource,
      });
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );
  const setKeywordInUrl = useCallback(
    (nextKeyword: string) => {
      setKeyword(nextKeyword);
      const qs = buildSearchParamsString(searchParams, {
        keyword: nextKeyword,
      });
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );
  const setAdvancedOpenInUrl = useCallback(
    (nextOpen: boolean) => {
      setAdvancedOpen(nextOpen);
      const qs = buildSearchParamsString(searchParams, {
        advanced: nextOpen ? "1" : null,
      });
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );
  const setDateRangeInUrl = useCallback(
    (nextRange: ReturnType<typeof defaultObserveDateRange>) => {
      const sp = new URLSearchParams(searchParams.toString());
      applyRangeToQuery(sp, nextRange);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const enabled = mounted && Boolean(baseUrl.trim());
  const commandQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.shellExecList, "investigation-center", baseUrl, apiKey, traceId, sinceMs, untilMs],
    queryFn: () =>
      loadShellExecList(baseUrl, apiKey, {
        traceId: traceId || undefined,
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: 60,
        offset: 0,
        order: "desc",
      }),
    enabled,
  });
  const resourceQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditEvents, "investigation-center", baseUrl, apiKey, traceId, sinceMs, untilMs],
    queryFn: () =>
      loadResourceAuditEvents(baseUrl, apiKey, {
        trace_id: traceId || undefined,
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: 60,
        offset: 0,
        order: "desc",
      }),
    enabled,
  });
  const securityQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents, "investigation-center", baseUrl, apiKey, traceId, sinceMs, untilMs],
    queryFn: () =>
      loadSecurityAuditEvents(baseUrl, apiKey, {
        traceId: traceId || undefined,
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: 60,
        offset: 0,
        order: "desc",
      }),
    enabled,
  });

  const rows = useMemo<TimelineRow[]>(() => {
    const commandRows: TimelineRow[] = (commandQ.data?.items ?? []).map((r) => ({
      key: `cmd:${String(r.span_id ?? "")}`,
      eventType: "command",
      timeMs: Number(r.start_time_ms ?? 0),
      traceId: String(r.trace_id ?? ""),
      spanId: String(r.span_id ?? ""),
      subject: String(r.parsed?.command ?? "command"),
      evidence: `exit=${String(r.parsed?.exitCode ?? "-")} / risk=${String(Boolean(r.parsed?.tokenRisk))}`,
      actor: String(r.agent_name ?? "unknown"),
      target: String(r.parsed?.command ?? r.name ?? "command"),
      result: r.parsed?.success === false ? "failed" : "success",
      whyFlagged: commandWhyFlagged(r as Record<string, unknown>),
      sourcePage: "/command-analysis",
    }));
    const resourceRows: TimelineRow[] = (resourceQ.data?.items ?? []).map((r) => ({
      key: `res:${r.span_id}`,
      eventType: "resource",
      timeMs: r.started_at_ms,
      traceId: r.trace_id,
      spanId: r.span_id,
      subject: r.resource_uri || r.span_name || "resource event",
      evidence: `flags=${(r.risk_flags ?? []).join(",") || "-"}`,
      actor: r.agent_name || "unknown",
      target: r.resource_uri || r.span_name || "resource",
      result: (r.risk_flags?.length ?? 0) > 0 ? "risk_hit" : "normal",
      whyFlagged: resourceWhyFlagged(r.risk_flags ?? []),
      sourcePage: "/resource-audit",
    }));
    const policyRows: TimelineRow[] = (securityQ.data?.items ?? []).map((r) => ({
      key: `pol:${r.id}`,
      eventType: "policy_hit",
      timeMs: r.created_at_ms,
      traceId: r.trace_id,
      spanId: r.span_id ?? undefined,
      subject: `policy hits: ${r.total_findings}`,
      evidence: `intercepted=${r.intercepted}`,
      actor: r.project_name || "unknown",
      target: `findings=${r.total_findings}`,
      result: r.intercepted ? "intercepted" : "observe_only",
      whyFlagged: policyWhyFlagged(r.intercepted),
      sourcePage: "/data-security-audit",
    }));
    return [...commandRows, ...resourceRows, ...policyRows]
      .map((row) => ({
        ...row,
        silencedBy: matchAuditSilence({
          traceId: row.traceId,
          eventType: row.eventType,
        }),
        verdict: getInvestigationVerdict(row.key),
      }))
      .sort((a, b) => b.timeMs - a.timeMs)
      .slice(0, 120);
  }, [commandQ.data?.items, resourceQ.data?.items, securityQ.data?.items, verdictVersion]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const setSelectedKeyInUrl = useCallback(
    (nextKey: string) => {
      const qs = buildSearchParamsString(searchParams, {
        event_key: nextKey,
      });
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );
  useEffect(() => {
    if (rows.length === 0) {
      setSelectedKey("");
      return;
    }
    const keyFromUrlValid = selectedKeyFromUrl && rows.some((r) => r.key === selectedKeyFromUrl);
    if (keyFromUrlValid) {
      if (selectedKey !== selectedKeyFromUrl) {
        setSelectedKey(selectedKeyFromUrl);
      }
      return;
    }
    if (!rows.some((r) => r.key === selectedKey)) {
      const fallback = rows[0]!.key;
      setSelectedKey(fallback);
      setSelectedKeyInUrl(fallback);
    }
  }, [rows, selectedKey, selectedKeyFromUrl, setSelectedKeyInUrl]);
  const filteredRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (eventTypeFilter !== "all" && r.eventType !== eventTypeFilter) {
        return false;
      }
      if (sourceFilter !== "all" && r.sourcePage !== sourceFilter) {
        return false;
      }
      if (kw) {
        const target = `${r.subject} ${r.evidence} ${r.traceId}`.toLowerCase();
        if (!target.includes(kw)) {
          return false;
        }
      }
      return true;
    });
  }, [eventTypeFilter, keyword, rows, sourceFilter]);
  useEffect(() => {
    if (filteredRows.length === 0) {
      return;
    }
    if (!filteredRows.some((r) => r.key === selectedKey)) {
      const next = filteredRows[0]!.key;
      setSelectedKey(next);
      setSelectedKeyInUrl(next);
    }
  }, [filteredRows, selectedKey, setSelectedKeyInUrl]);
  const selectedRow = useMemo(
    () => filteredRows.find((r) => r.key === selectedKey) ?? null,
    [filteredRows, selectedKey],
  );
  const selectedRuleHint = useMemo(
    () => (selectedRow ? recommendedRuleParams(selectedRow.eventType) : null),
    [selectedRow],
  );
  const activeSilenceList = useMemo(
    () => {
      void silenceVersion;
      return readActiveAuditSilences();
    },
    [silenceVersion],
  );
  const expiringSoonCount = useMemo(() => {
    const soonCutoff = Date.now() + 30 * 60_000;
    return activeSilenceList.filter((rule) => rule.expireAt <= soonCutoff).length;
  }, [activeSilenceList]);
  useEffect(() => {
    if (!selectedRow) {
      setActiveSilence(null);
      return;
    }
    const matched = matchAuditSilence({
      traceId: selectedRow.traceId,
      eventType: selectedRow.eventType,
    });
    setActiveSilence(matched);
  }, [selectedRow]);
  useEffect(() => {
    if (!selectedRow?.verdict) {
      setVerdictValue("monitoring");
      setVerdictNote("");
      return;
    }
    setVerdictValue(selectedRow.verdict.verdict);
    setVerdictNote(selectedRow.verdict.note);
  }, [selectedRow]);
  const applySilence = useCallback(() => {
    if (!selectedRow) {
      return;
    }
    const minutes = Math.max(5, Math.floor(silenceMinutes) || 60);
    const expireAt = Date.now() + minutes * 60_000;
    const rule = appendAuditSilenceRule({
      scope: silenceScope,
      traceId: silenceScope === "trace" ? selectedRow.traceId : undefined,
      eventType: silenceScope === "event_type" ? selectedRow.eventType : undefined,
      reason: `from investigation ${selectedRow.key}`,
      expireAt,
    });
    setActiveSilence(rule);
    setSilenceVersion((v) => v + 1);
    Message.success(t("silenceApplied"));
  }, [selectedRow, silenceMinutes, silenceScope, t]);
  const clearSilence = useCallback(() => {
    if (!activeSilence) {
      return;
    }
    removeAuditSilenceRule(activeSilence.id);
    setActiveSilence(null);
    setSilenceVersion((v) => v + 1);
    Message.success(t("silenceCleared"));
  }, [activeSilence, t]);
  const clearSilenceById = useCallback(
    (id: string) => {
      removeAuditSilenceRule(id);
      if (activeSilence?.id === id) {
        setActiveSilence(null);
      }
      setSilenceVersion((v) => v + 1);
      Message.success(t("silenceCleared"));
    },
    [activeSilence?.id, t],
  );
  const applyVerdict = useCallback(() => {
    if (!selectedRow) {
      return;
    }
    saveInvestigationVerdict({
      eventKey: selectedRow.key,
      verdict: verdictValue,
      note: verdictNote,
    });
    setVerdictVersion((v) => v + 1);
    Message.success(t("verdictSaved"));
  }, [selectedRow, t, verdictNote, verdictValue]);
  const removeVerdict = useCallback(() => {
    if (!selectedRow) {
      return;
    }
    clearInvestigationVerdict(selectedRow.key);
    setVerdictValue("monitoring");
    setVerdictNote("");
    setVerdictVersion((v) => v + 1);
    Message.success(t("verdictCleared"));
  }, [selectedRow, t]);
  const copySelectedPermalink = useCallback(async () => {
    if (!selectedRow) {
      return;
    }
    try {
      const p = new URLSearchParams(searchParams.toString());
      p.set("event_key", selectedRow.key);
      const qs = p.toString();
      const path = qs ? `${pathname}?${qs}` : pathname;
      const href = `${window.location.origin}${path}`;
      await navigator.clipboard.writeText(href);
      setLinkCopied(true);
      Message.success(tCmd("investigationLinkCopied"));
      window.setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      Message.error(tCmd("investigationLinkCopyFailed"));
    }
  }, [pathname, searchParams, selectedRow, tCmd]);

  const columns: TableColumnProps<TimelineRow>[] = [
    {
      title: t("timelineColType"),
      dataIndex: "eventType",
      width: 120,
      render: (v: TimelineRow["eventType"]) => (
        <Tag color={getAuditEventTypeColor(v)}>{t(`eventType_${v}`)}</Tag>
      ),
    },
    {
      title: t("timelineColTime"),
      dataIndex: "timeMs",
      width: 180,
      render: (v: number) => <span className="text-xs">{v > 0 ? new Date(v).toLocaleString() : "—"}</span>,
    },
    {
      title: t("timelineColSummary"),
      dataIndex: "subject",
      render: (v: string, row: TimelineRow) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Typography.Text ellipsis>{v}</Typography.Text>
            {row.silencedBy ? <Tag color="green">{t("silencedTag")}</Tag> : null}
            {row.verdict ? <Tag color={verdictColor(row.verdict.verdict)}>{verdictLabel(t, row.verdict.verdict)}</Tag> : null}
          </div>
          <div className="text-xs text-muted-foreground">{row.evidence}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            <Tag size="small">{t("tagActor")}: {row.actor || "unknown"}</Tag>
            <Tag size="small">{t("tagTarget")}: {row.target || "-"}</Tag>
            <Tag size="small" color={row.result === "failed" || row.result === "intercepted" || row.result === "risk_hit" ? "orangered" : "gray"}>
              {t("tagResult")}: {row.result}
            </Tag>
            <Tag size="small">{t("fieldWhyFlagged")}: {row.whyFlagged}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: t("timelineColLinkage"),
      width: 200,
      render: (_: unknown, row: TimelineRow) => (
        <Space size={8}>
          <LocalizedLink className="text-xs text-primary underline-offset-2 hover:underline" href={`/risk-center?trace_id=${encodeURIComponent(row.traceId)}`}>
            {tNav("riskCenter")}
          </LocalizedLink>
          <LocalizedLink className="text-xs text-primary underline-offset-2 hover:underline" href={`/data-security-audit?trace_id=${encodeURIComponent(row.traceId)}`}>
            {t("openSecurityAudit")}
          </LocalizedLink>
        </Space>
      ),
    },
  ];

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-5 pb-10">
        <header className="space-y-4">
          {fromRiskCenter ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-blue-600 dark:text-blue-400">{t("fromRiskCenterLabel")}</span>
                  <LocalizedLink href="/risk-center" className="font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                    {t("backToRiskCenter")} →
                  </LocalizedLink>
                </div>
                <Button type="text" size="mini" className="text-blue-600 dark:text-blue-400" onClick={() => router.push("/risk-center")}>
                  ✕
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <div>
              <Typography.Title heading={3} className="ca-page-title !m-0 text-2xl font-semibold">
                {tNav("investigationCenter")}
              </Typography.Title>
              <Typography.Text type="secondary" className="text-sm mt-1 block text-gray-500">
                {t("subtitle")}
              </Typography.Text>
            </div>
            <Space size={12}>
              <LocalizedLink href="/command-analysis" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                {t("openLegacyCommandAnalysis")}
              </LocalizedLink>
              <LocalizedLink href="/resource-audit" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                {t("openLegacyResourceAudit")}
              </LocalizedLink>
            </Space>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">🧭</span>
              {t("investigationGuideTitle")}
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600 dark:bg-blue-900/30">1</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{t("investigationGuideStep1")}</span>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-600 dark:bg-amber-900/30">2</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{t("investigationGuideStep2")}</span>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-600 dark:bg-green-900/30">3</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{t("investigationGuideStep3")}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{t("mappingTitle")}</span>
              <span className="ml-2">{t("mappingBody")}</span>
            </div>
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/30 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{t("silenceOverviewTitle")}</span>
              <span className="ml-2">
                {t("silenceOverviewBody", {
                  activeCount: String(activeSilenceList.length),
                  expiringSoonCount: String(expiringSoonCount),
                })}
              </span>
            </div>
          </div>
        </header>

        {!enabled || commandQ.isLoading || resourceQ.isLoading || securityQ.isLoading ? (
          <div className="flex justify-center py-16">
            <Spin />
          </div>
        ) : commandQ.isError || resourceQ.isError || securityQ.isError ? (
          <Card>
            <div className="space-y-2 py-2 text-sm">
              <Typography.Text>{t("loadErrorTitle")}</Typography.Text>
              <Typography.Text type="secondary">{t("loadErrorBody")}</Typography.Text>
              <div>
                <Button
                  size="small"
                  onClick={() => {
                    void commandQ.refetch();
                    void resourceQ.refetch();
                    void securityQ.refetch();
                  }}
                >
                  {t("retry")}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <section className="grid gap-5 lg:grid-cols-3">
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-2xl dark:bg-blue-900/20">⌨️</div>
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("kpiCommandEvents")}</div>
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{commandQ.data?.items.length ?? 0}</div>
                  </div>
                </div>
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-2xl dark:bg-green-900/20">📁</div>
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("kpiResourceEvents")}</div>
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{resourceQ.data?.items.length ?? 0}</div>
                  </div>
                </div>
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-2xl dark:bg-red-900/20">🛡️</div>
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("kpiPolicyHitEvents")}</div>
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{securityQ.data?.items.length ?? 0}</div>
                  </div>
                </div>
              </Card>
            </section>

            <section>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">📋</span>{t("timelineTitle")}</div>}>
                <div className="mb-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                    <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("dateRangeLabel")}:</span>
                    <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangeInUrl} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                    <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("eventTypeFilterLabel")}</span>
                    <Button
                      type={eventTypeFilter === "all" ? "primary" : "outline"}
                      size="small"
                      className="rounded-full"
                      onClick={() => setEventTypeFilterInUrl("all")}
                    >
                      {t("filterAll")}
                    </Button>
                    <Button
                      type={eventTypeFilter === "command" ? "primary" : "outline"}
                      size="small"
                      className="rounded-full"
                      onClick={() => setEventTypeFilterInUrl("command")}
                    >
                      {t("eventType_command")}
                    </Button>
                    <Button
                      type={eventTypeFilter === "resource" ? "primary" : "outline"}
                      size="small"
                      className="rounded-full"
                      onClick={() => setEventTypeFilterInUrl("resource")}
                    >
                      {t("eventType_resource")}
                    </Button>
                    <Button
                      type={eventTypeFilter === "policy_hit" ? "primary" : "outline"}
                      size="small"
                      className="rounded-full"
                      onClick={() => setEventTypeFilterInUrl("policy_hit")}
                    >
                      {t("eventType_policy_hit")}
                    </Button>
                    <div className="ml-auto">
                      <Button type="text" size="small" onClick={() => setAdvancedOpenInUrl(!advancedOpen)}>
                        {advancedOpen ? t("advancedHide") : t("advancedShow")}
                      </Button>
                    </div>
                  </div>
                  {advancedOpen ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                      <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("advancedFiltersLabel")}</span>
                      <Button
                        type={sourceFilter === "all" ? "primary" : "outline"}
                        size="small"
                        className="rounded-full"
                        onClick={() => setSourceFilterInUrl("all")}
                      >
                        {t("filterAll")}
                      </Button>
                      <Button
                        type={sourceFilter === "/command-analysis" ? "primary" : "outline"}
                        size="small"
                        className="rounded-full"
                        onClick={() => setSourceFilterInUrl("/command-analysis")}
                      >
                        {t("sourcePageCommand")}
                      </Button>
                      <Button
                        type={sourceFilter === "/resource-audit" ? "primary" : "outline"}
                        size="small"
                        className="rounded-full"
                        onClick={() => setSourceFilterInUrl("/resource-audit")}
                      >
                        {t("sourcePageResource")}
                      </Button>
                      <Button
                        type={sourceFilter === "/data-security-audit" ? "primary" : "outline"}
                        size="small"
                        className="rounded-full"
                        onClick={() => setSourceFilterInUrl("/data-security-audit")}
                      >
                        {t("sourcePageSecurity")}
                      </Button>
                      <input
                        className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800"
                        placeholder={t("keywordPlaceholder")}
                        value={keyword}
                        onChange={(e) => setKeywordInUrl(e.target.value)}
                      />
                    </div>
                  ) : null}
                </div>
                {filteredRows.length > 0 ? (
                  <Table
                    rowKey="key"
                    size="small"
                    columns={columns}
                    data={filteredRows}
                    pagination={{ pageSize: 20 }}
                    rowClassName={(record) =>
                      (record as TimelineRow).key === selectedKey
                        ? "!bg-blue-50 dark:!bg-blue-900/20"
                        : (record as TimelineRow).silencedBy
                          ? "opacity-65"
                          : ""
                    }
                    onRow={(record) => ({
                      onClick: () => {
                        const next = (record as TimelineRow).key;
                        setSelectedKey(next);
                        setSelectedKeyInUrl(next);
                      },
                    })}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800/30">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl dark:bg-gray-800">📋</div>
                    <p className="text-base font-medium text-gray-800 dark:text-gray-200 mb-2">
                      {traceId ? t("emptyTimelineForTrace") : t("emptyTimeline")}
                    </p>
                    <p className="text-sm text-gray-500 mb-4">
                      {t("emptyTimelineHint")}
                    </p>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/30">
                  <Typography.Text type="secondary" className="text-sm">
                    {t("timelineShowingOfTotal", {
                      shown: String(filteredRows.length),
                      total: String(rows.length),
                    })}
                  </Typography.Text>
                </div>
              </Card>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <Card className="lg:sticky lg:top-4 lg:self-start rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">🔍</span>{t("evidenceTitle")}</div>}>
                {selectedRow ? (
                  <div className="space-y-4 text-sm">
                    <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 p-4 dark:from-blue-900/20 dark:to-indigo-900/20">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t("fieldEventType")}</p>
                          <Tag color={getAuditEventTypeColor(selectedRow.eventType)} className="rounded-full">{t(`eventType_${selectedRow.eventType}`)}</Tag>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t("fieldEventTime")}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{selectedRow.timeMs > 0 ? new Date(selectedRow.timeMs).toLocaleString() : "—"}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t("fieldSourcePage")}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{sourcePageLabel(t, selectedRow.sourcePage)}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t("fieldWhyFlagged")}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{selectedRow.whyFlagged}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t("fieldTraceId")}</p>
                          <p className="rounded-lg bg-white/50 p-2 text-xs font-mono text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">{selectedRow.traceId || "—"}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{t("fieldSpanId")}</p>
                          <p className="rounded-lg bg-white/50 p-2 text-xs font-mono text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">{selectedRow.spanId || "—"}</p>
                        </div>
                      </div>
                    </div>
                    <details className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/30" open>
                      <summary className="cursor-pointer p-3 text-sm font-medium text-gray-700 hover:text-primary dark:text-gray-300">
                        <span className="flex items-center gap-2">📋 {t("summaryTitle")}</span>
                      </summary>
                      <div className="grid gap-3 border-t border-gray-100 p-3 sm:grid-cols-2 dark:border-gray-700">
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500">{t("fieldInputSummary")}</p>
                          <p className="break-all text-sm text-gray-700 dark:text-gray-300">{selectedRow.subject}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-gray-500">{t("fieldOutputSummary")}</p>
                          <p className="break-all text-sm text-gray-700 dark:text-gray-300">{selectedRow.evidence}</p>
                        </div>
                        <div className="sm:col-span-2">
                          <p className="mb-1 text-xs font-medium text-gray-500">{t("fieldWhyFlagged")}</p>
                          <p className="break-all text-sm text-gray-700 dark:text-gray-300">{selectedRow.whyFlagged}</p>
                        </div>
                      </div>
                    </details>
                    <details className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/30">
                      <summary className="cursor-pointer p-3 text-sm font-medium text-gray-700 hover:text-primary dark:text-gray-300">
                        <span className="flex items-center gap-2">🔗 {t("fieldLinkedContext")}</span>
                      </summary>
                      <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3 dark:border-gray-700">
                        <LocalizedLink href={`/risk-center?trace_id=${encodeURIComponent(selectedRow.traceId)}`} className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400">
                          {t("openRiskContext")}
                        </LocalizedLink>
                        <LocalizedLink href={`${selectedRow.sourcePage}?trace_id=${encodeURIComponent(selectedRow.traceId)}`} className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300">
                          {t("openSourceEvidence", { source: sourcePageLabel(t, selectedRow.sourcePage) })}
                        </LocalizedLink>
                      </div>
                    </details>
                    {selectedRow.silencedBy ? (
                      <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">🔇 {t("silenceActiveHintTitle")}</p>
                            <p className="mt-1 text-xs text-green-600 dark:text-green-500">
                              {t("silenceActiveHintBody", {
                                scope: selectedRow.silencedBy.scope,
                                time: new Date(selectedRow.silencedBy.expireAt).toLocaleString(),
                              })}
                            </p>
                          </div>
                          <Button type="primary" size="small" className="rounded-full" onClick={clearSilence}>
                            {t("silenceCancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">🔇 {t("silenceTitle")}</p>
                          <Button type="primary" size="small" className="rounded-full" onClick={applySilence}>
                            {t("silenceQuickApply")}
                          </Button>
                        </div>
                        <details className="group">
                          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
                            {t("silenceAdvancedOptions")}
                          </summary>
                          <div className="mt-3 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-gray-600 dark:text-gray-400">{t("silenceScopeLabel")}:</span>
                              <Button
                                type={silenceScope === "trace" ? "primary" : "outline"}
                                size="small"
                                className="rounded-full"
                                onClick={() => setSilenceScope("trace")}
                              >
                                {t("silenceScopeTrace")}
                              </Button>
                              <Button
                                type={silenceScope === "event_type" ? "primary" : "outline"}
                                size="small"
                                className="rounded-full"
                                onClick={() => setSilenceScope("event_type")}
                              >
                                {t("silenceScopeEventType")}
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600 dark:text-gray-400">{t("silenceDurationLabel")}:</span>
                              <input
                                className="h-8 w-20 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800"
                                type="number"
                                min="5"
                                value={String(silenceMinutes)}
                                onChange={(e) => setSilenceMinutes(Number(e.target.value || 60))}
                              />
                              <span className="text-sm text-gray-500">{t("silenceMinutes")}</span>
                            </div>
                          </div>
                        </details>
                      </div>
                    )}
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">💡 {t("actionReasonTitle")}</p>
                      <p className="text-sm text-amber-600 dark:text-amber-500">
                        {selectedRow.eventType === "command"
                          ? t("actionReasonCommand")
                          : selectedRow.eventType === "resource"
                            ? t("actionReasonResource")
                            : t("actionReasonPolicyHit")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl dark:bg-gray-800">👆</div>
                    <Typography.Text type="secondary" className="text-base">{t("emptySelectEventForEvidence")}</Typography.Text>
                  </div>
                )}
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">⚡</span>{t("actionTitle")}</div>}>
                {selectedRow ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-800/30">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{t("verdictTitle")}</p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("verdictHint")}</p>
                        </div>
                        {selectedRow.verdict ? (
                          <Tag color={verdictColor(selectedRow.verdict.verdict)}>
                            {verdictLabel(t, selectedRow.verdict.verdict)}
                          </Tag>
                        ) : (
                          <Tag>{t("verdictNotSet")}</Tag>
                        )}
                      </div>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <Button
                          type={verdictValue === "confirmed_risk" ? "primary" : "outline"}
                          size="small"
                          className="rounded-full"
                          onClick={() => setVerdictValue("confirmed_risk")}
                        >
                          {t("verdictConfirmedRisk")}
                        </Button>
                        <Button
                          type={verdictValue === "false_positive" ? "primary" : "outline"}
                          size="small"
                          className="rounded-full"
                          onClick={() => setVerdictValue("false_positive")}
                        >
                          {t("verdictFalsePositive")}
                        </Button>
                        <Button
                          type={verdictValue === "monitoring" ? "primary" : "outline"}
                          size="small"
                          className="rounded-full"
                          onClick={() => setVerdictValue("monitoring")}
                        >
                          {t("verdictMonitoring")}
                        </Button>
                        <Button
                          type={verdictValue === "resolved" ? "primary" : "outline"}
                          size="small"
                          className="rounded-full"
                          onClick={() => setVerdictValue("resolved")}
                        >
                          {t("verdictResolved")}
                        </Button>
                      </div>
                      <textarea
                        className="min-h-[88px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                        placeholder={t("verdictNotePlaceholder")}
                        value={verdictNote}
                        onChange={(e) => setVerdictNote(e.target.value)}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="primary" size="small" className="rounded-full" onClick={applyVerdict}>
                          {t("verdictSave")}
                        </Button>
                        <Button type="outline" size="small" className="rounded-full" onClick={removeVerdict}>
                          {t("verdictClear")}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                      <p className="text-sm text-blue-700 dark:text-blue-400">{t("actionItem1")}</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                      <p className="text-sm text-amber-700 dark:text-amber-400">{t("actionItem2")}</p>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
                      <p className="text-sm text-green-700 dark:text-green-400">{t("actionItem3")}</p>
                    </div>
                    {selectedRuleHint ? (
                      <div className="rounded border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">{t("ruleHintTitle")}</div>
                        <div className="mt-1">
                          {t("ruleHintBody", {
                            metric: selectedRuleHint.metric,
                            operator: selectedRuleHint.operator,
                            threshold: String(selectedRuleHint.threshold),
                            windowMinutes: String(selectedRuleHint.windowMinutes),
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded border border-border bg-muted/20 p-2">
                      <div className="mb-2 text-xs font-medium">{t("silenceTitle")}</div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Button
                          type={silenceScope === "trace" ? "primary" : "outline"}
                          size="mini"
                          onClick={() => setSilenceScope("trace")}
                        >
                          {t("silenceScopeTrace")}
                        </Button>
                        <Button
                          type={silenceScope === "event_type" ? "primary" : "outline"}
                          size="mini"
                          onClick={() => setSilenceScope("event_type")}
                        >
                          {t("silenceScopeEventType")}
                        </Button>
                        <input
                          className="h-7 w-20 rounded border border-border bg-background px-2 text-xs"
                          value={String(silenceMinutes)}
                          onChange={(e) => setSilenceMinutes(Number(e.target.value || 0))}
                        />
                        <span className="text-xs text-muted-foreground">{t("silenceMinutes")}</span>
                      </div>
                      {activeSilence ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag color="green">
                            {t("silenceActiveUntil", { time: new Date(activeSilence.expireAt).toLocaleString() })}
                          </Tag>
                          <Button type="outline" size="mini" onClick={clearSilence}>
                            {t("silenceCancel")}
                          </Button>
                        </div>
                      ) : (
                        <Button type="outline" size="mini" onClick={applySilence}>
                          {t("silenceApply")}
                        </Button>
                      )}
                    </div>
                    <div className="rounded border border-border bg-muted/20 p-2">
                      <div className="mb-2 text-xs font-medium">{t("silenceListTitle")}</div>
                      {activeSilenceList.length === 0 ? (
                        <Typography.Text type="secondary" className="text-xs">
                          {t("silenceListEmpty")}
                        </Typography.Text>
                      ) : (
                        <div className="space-y-1.5">
                          {activeSilenceList.slice(0, 8).map((rule) => (
                            <div
                              key={rule.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-background px-2 py-1.5"
                            >
                              <div className="min-w-0 text-xs">
                                <div className="font-medium">
                                  {rule.scope === "trace"
                                    ? t("silenceScopeTrace")
                                    : t("silenceScopeEventType")}
                                </div>
                                <div className="text-muted-foreground">
                                  {rule.scope === "trace"
                                    ? `trace=${rule.traceId ?? "-"}`
                                    : `event=${rule.eventType ?? "-"}`}
                                  {" · "}
                                  {t("silenceActiveUntil", {
                                    time: new Date(rule.expireAt).toLocaleString(),
                                  })}
                                </div>
                              </div>
                              <Button
                                type="outline"
                                size="mini"
                                onClick={() => clearSilenceById(rule.id)}
                              >
                                {t("silenceCancel")}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Space size={10} wrap>
                      <LocalizedLink
                        href={`/alerts?from=investigation&trace_id=${encodeURIComponent(selectedRow.traceId)}${selectedRow.spanId ? `&span_id=${encodeURIComponent(selectedRow.spanId)}` : ""}&event_type=${encodeURIComponent(selectedRow.eventType)}&recommended_metric=${encodeURIComponent(selectedRuleHint?.metric ?? "sensitive_data_hits")}&recommended_operator=${encodeURIComponent(selectedRuleHint?.operator ?? "gt")}&recommended_threshold=${selectedRuleHint?.threshold ?? 1}&recommended_window_minutes=${selectedRuleHint?.windowMinutes ?? 5}`}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {t("openAlertsPrefilled")}
                      </LocalizedLink>
                      <LocalizedLink
                        href={`/traces?kind=traces&trace=${encodeURIComponent(selectedRow.traceId)}${selectedRow.spanId ? `&span=${encodeURIComponent(selectedRow.spanId)}` : ""}`}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {t("openTraceDetails")}
                      </LocalizedLink>
                      <LocalizedLink
                        href={`/data-security-audit?trace_id=${encodeURIComponent(selectedRow.traceId)}${selectedRow.spanId ? `&span_id=${encodeURIComponent(selectedRow.spanId)}` : ""}`}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {t("openSecurityAudit")}
                      </LocalizedLink>
                      <Button type="outline" size="mini" onClick={() => void copySelectedPermalink()}>
                        {linkCopied ? tCmd("investigationLinkCopiedBtn") : tCmd("investigationCopyLinkBtn")}
                      </Button>
                    </Space>
                  </div>
                ) : (
                  <Typography.Text type="secondary">{t("emptySelectEventForAction")}</Typography.Text>
                )}
              </Card>
            </section>
          </>
        )}
      </main>
    </AppPageShell>
  );
}
