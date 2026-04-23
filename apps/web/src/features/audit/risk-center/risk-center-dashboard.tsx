"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Popover, Space, Spin, Table, Tag, Typography } from "@arco-design/web-react";
import type { TableColumnProps } from "@arco-design/web-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { LocalizedLink } from "@/shared/components/localized-link";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { matchAuditSilence, readAuditSilenceOverview } from "@/lib/audit-silence-storage";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import {
  defaultObserveDateRange,
  resolveObserveSinceUntil,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import { parseObserveDateRangeFromListUrl } from "@/lib/observe-list-deep-link";
import { getAuditEventTypeColor, getAuditSeverityColor } from "@/lib/audit-ui-semantics";
import { loadResourceAuditEvents, loadResourceAuditStats, type ResourceAuditEventRow } from "@/lib/resource-audit-records";
import { loadSecurityAuditEvents } from "@/lib/security-audit-records";
import { loadShellExecList } from "@/lib/shell-exec-api";
import { buildSearchParamsString } from "@/lib/url-search-params";

type RiskQueueRow = {
  key: string;
  severity: "P0" | "P1" | "P2" | "P3";
  summary: string;
  traceId: string;
  eventType: "command" | "resource" | "policy_hit";
  flags: string[];
  whyFlagged: string;
  silenced: boolean;
  recentFrequency: number;
  impactedWorkspaceCount: number;
};

const SEVERITY_ORDER: Record<RiskQueueRow["severity"], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const SOURCE_TYPE_FILTER_VALUES = new Set<RiskQueueRow["eventType"]>(["command", "resource", "policy_hit"]);
const SEVERITY_FILTER_VALUES = new Set<RiskQueueRow["severity"]>(["P0", "P1", "P2", "P3"]);
const SILENCED_FILTER_VALUES = new Set<"silenced" | "unsilenced">(["silenced", "unsilenced"]);

function applyRangeToQuery(sp: URLSearchParams, range: ObserveDateRange): void {
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

function eventSeverity(row: ResourceAuditEventRow): "P0" | "P1" | "P2" | "P3" {
  const flags = row.risk_flags ?? [];
  if (flags.includes("sensitive_path")) {
    return "P0";
  }
  if (flags.includes("pii_hint") || flags.includes("credential_hint")) {
    return "P1";
  }
  if (flags.includes("large_read") || flags.includes("redundant_read")) {
    return "P2";
  }
  return "P3";
}

function commandSeverity(row: Record<string, unknown>): "P0" | "P1" | "P2" | "P3" {
  const parsed = (row.parsed ?? {}) as Record<string, unknown>;
  const success = parsed.success;
  const category = String(parsed.category ?? "");
  if (success === false && (category === "system" || category === "network")) {
    return "P0";
  }
  if (parsed.tokenRisk === true) {
    return "P1";
  }
  if (success === false) {
    return "P2";
  }
  return "P3";
}

function getSourceTypeLabel(
  t: ReturnType<typeof useTranslations>,
  eventType: RiskQueueRow["eventType"],
): string {
  return t(`sourceType_${eventType}`);
}

export function RiskCenterDashboard() {
  const tNav = useTranslations("Nav");
  const t = useTranslations("RiskCenter");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sourceTypeFromQuery = useMemo(() => {
    const raw = searchParams.get("source_type");
    return raw && SOURCE_TYPE_FILTER_VALUES.has(raw as RiskQueueRow["eventType"])
      ? (raw as RiskQueueRow["eventType"])
      : "all";
  }, [searchParams]);
  const severityFromQuery = useMemo(() => {
    const raw = searchParams.get("severity");
    return raw && SEVERITY_FILTER_VALUES.has(raw as RiskQueueRow["severity"])
      ? (raw as RiskQueueRow["severity"])
      : "all";
  }, [searchParams]);
  const silencedFromQuery = useMemo(() => {
    const raw = searchParams.get("silenced");
    return raw && SILENCED_FILTER_VALUES.has(raw as "silenced" | "unsilenced")
      ? (raw as "silenced" | "unsilenced")
      : "all";
  }, [searchParams]);
  const traceIdFilter = useMemo(() => searchParams.get("trace_id")?.trim() ?? "", [searchParams]);
  const [mounted, setMounted] = useState(false);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<"all" | RiskQueueRow["eventType"]>(sourceTypeFromQuery);
  const [severityFilter, setSeverityFilter] = useState<"all" | RiskQueueRow["severity"]>(severityFromQuery);
  const [silencedFilter, setSilencedFilter] = useState<"all" | "silenced" | "unsilenced">(silencedFromQuery);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [presetFilter, setPresetFilter] = useState<"all" | "urgent" | "today" | "unsilenced">("all");
  const dateRange = useMemo(
    () => parseObserveDateRangeFromListUrl(new URLSearchParams(searchParams.toString())) ?? defaultObserveDateRange(),
    [searchParams],
  );
  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange as ObserveDateRange), [dateRange]);

  useEffect(() => {
    setMounted(true);
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
  }, []);
  useEffect(() => {
    setSourceTypeFilter(sourceTypeFromQuery);
  }, [sourceTypeFromQuery]);
  useEffect(() => {
    setSeverityFilter(severityFromQuery);
  }, [severityFromQuery]);
  useEffect(() => {
    setSilencedFilter(silencedFromQuery);
  }, [silencedFromQuery]);

  const applySourceTypeFilter = (next: "all" | RiskQueueRow["eventType"]) => {
    setSourceTypeFilter(next);
    const nextQuery = buildSearchParamsString(searchParams, {
      source_type: next === "all" ? null : next,
    });
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };
  const applySeverityFilter = (next: "all" | RiskQueueRow["severity"]) => {
    setSeverityFilter(next);
    const nextQuery = buildSearchParamsString(searchParams, {
      severity: next === "all" ? null : next,
    });
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };
  const applySilencedFilter = (next: "all" | "silenced" | "unsilenced") => {
    setSilencedFilter(next);
    const nextQuery = buildSearchParamsString(searchParams, {
      silenced: next === "all" ? null : next,
    });
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };
  const clearTraceFilter = () => {
    const nextQuery = buildSearchParamsString(searchParams, {
      trace_id: null,
      span_id: null,
    });
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };
  const applyDateRange = (nextRange: ObserveDateRange) => {
    const sp = new URLSearchParams(searchParams.toString());
    applyRangeToQuery(sp, nextRange);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const applyPresetFilter = (preset: "all" | "urgent" | "today" | "unsilenced") => {
    setPresetFilter(preset);
    if (preset === "all") {
      setSeverityFilter("all");
      setSilencedFilter("all");
    } else if (preset === "urgent") {
      setSeverityFilter("all");
      setSilencedFilter("unsilenced");
    } else if (preset === "today") {
      setSilencedFilter("unsilenced");
      const todayRange: ObserveDateRange = { kind: "custom", startMs: Date.now() - 24 * 60 * 60 * 1000, endMs: Date.now() };
      applyDateRange(todayRange);
    } else if (preset === "unsilenced") {
      setSeverityFilter("all");
      setSilencedFilter("unsilenced");
    }
  };

  const enabled = mounted && Boolean(baseUrl.trim());
  const statsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditStats, "risk-center", baseUrl, apiKey, sinceMs, untilMs],
    queryFn: () =>
      loadResourceAuditStats(baseUrl, apiKey, { sinceMs: sinceMs ?? undefined, untilMs: untilMs ?? undefined }),
    enabled,
  });
  const eventsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditEvents, "risk-center", baseUrl, apiKey, sinceMs, untilMs],
    queryFn: () =>
      loadResourceAuditEvents(baseUrl, apiKey, {
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: 120,
        offset: 0,
        order: "desc",
      }),
    enabled,
  });
  const commandQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.shellExecList, "risk-center", baseUrl, apiKey, sinceMs, untilMs],
    queryFn: () =>
      loadShellExecList(baseUrl, apiKey, {
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: 120,
        offset: 0,
        order: "desc",
      }),
    enabled,
  });
  const securityQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents, "risk-center", baseUrl, apiKey, sinceMs, untilMs],
    queryFn: () =>
      loadSecurityAuditEvents(baseUrl, apiKey, {
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: 120,
        offset: 0,
        order: "desc",
      }),
    enabled,
  });

  const filteredQueueRows = useMemo<RiskQueueRow[]>(() => {
    type InternalRiskQueueRow = Omit<RiskQueueRow, "recentFrequency" | "impactedWorkspaceCount"> & {
      workspaceName: string;
    };
    const resourceRows: InternalRiskQueueRow[] = (eventsQ.data?.items ?? [])
      .filter((r) => (r.risk_flags?.length ?? 0) > 0)
      .map((r) => ({
        key: r.span_id,
        severity: eventSeverity(r),
        summary: r.resource_uri || r.span_name || "resource event",
        traceId: r.trace_id,
        eventType: "resource" as const,
        flags: r.risk_flags ?? [],
        whyFlagged: (r.risk_flags ?? []).slice(0, 3).join(", ") || "heuristic risk",
        workspaceName: (r.workspace_name || "unknown").trim(),
        silenced:
          matchAuditSilence({
            traceId: r.trace_id,
            eventType: "resource",
          }) != null,
      }));
    const commandRows: InternalRiskQueueRow[] = (commandQ.data?.items ?? [])
      .filter((row) => {
        const parsed = (row.parsed ?? {}) as Record<string, unknown>;
        return parsed.success === false || parsed.tokenRisk === true;
      })
      .map((row) => {
        const parsed = (row.parsed ?? {}) as Record<string, unknown>;
        const traceId = String(row.trace_id ?? "");
        const command = String(parsed.command ?? row.name ?? "command event");
        const why = parsed.success === false ? "command failed" : parsed.tokenRisk === true ? "token risk" : "heuristic risk";
        return {
          key: `cmd:${String(row.span_id ?? "")}`,
          severity: commandSeverity(row as Record<string, unknown>),
          summary: command,
          traceId,
          eventType: "command" as const,
          flags: [],
          whyFlagged: why,
          workspaceName: String(row.workspace_name ?? "unknown").trim(),
          silenced:
            matchAuditSilence({
              traceId,
              eventType: "command",
            }) != null,
        } satisfies InternalRiskQueueRow;
      });
    const securityRows: InternalRiskQueueRow[] = (securityQ.data?.items ?? []).map((row) => {
      const severity: RiskQueueRow["severity"] = row.intercepted ? "P0" : "P1";
      return {
        key: `sec:${row.id}`,
        severity,
        summary: `policy hits=${row.total_findings}`,
        traceId: row.trace_id,
        eventType: "policy_hit" as const,
        flags: [],
        whyFlagged: row.intercepted ? "intercepted policy hit" : "policy hit",
        workspaceName: (row.workspace_name || "unknown").trim(),
        silenced:
          matchAuditSilence({
            traceId: row.trace_id,
            eventType: "policy_hit",
          }) != null,
      } satisfies InternalRiskQueueRow;
    });
    const merged = [...resourceRows, ...commandRows, ...securityRows];
    const byTraceCount = new Map<string, number>();
    const byTraceWorkspace = new Map<string, Set<string>>();
    for (const row of merged) {
      byTraceCount.set(row.traceId, (byTraceCount.get(row.traceId) ?? 0) + 1);
      const workspaceSet = byTraceWorkspace.get(row.traceId) ?? new Set<string>();
      workspaceSet.add(row.workspaceName || "unknown");
      byTraceWorkspace.set(row.traceId, workspaceSet);
    }
    return merged
      .map((row) => ({
        key: row.key,
        severity: row.severity,
        summary: row.summary,
        traceId: row.traceId,
        eventType: row.eventType,
        flags: row.flags,
        whyFlagged: row.whyFlagged,
        silenced: row.silenced,
        recentFrequency: byTraceCount.get(row.traceId) ?? 1,
        impactedWorkspaceCount: byTraceWorkspace.get(row.traceId)?.size ?? 1,
      }))
      .filter((row) => (sourceTypeFilter === "all" ? true : row.eventType === sourceTypeFilter))
      .filter((row) => (severityFilter === "all" ? true : row.severity === severityFilter))
      .filter((row) => (!traceIdFilter ? true : row.traceId === traceIdFilter))
      .filter((row) => {
        if (silencedFilter === "all") {
          return true;
        }
        return silencedFilter === "silenced" ? row.silenced : !row.silenced;
      })
      .filter((row) => {
        if (presetFilter === "urgent") {
          return !row.silenced && (row.severity === "P0" || row.severity === "P1");
        }
        if (presetFilter === "unsilenced") {
          return !row.silenced;
        }
        return true;
      })
      .sort((a, b) => a.severity.localeCompare(b.severity));
  }, [commandQ.data?.items, eventsQ.data?.items, presetFilter, securityQ.data?.items, silencedFilter, sourceTypeFilter, severityFilter, traceIdFilter]);
  const queueRows = useMemo(() => filteredQueueRows.slice(0, 20), [filteredQueueRows]);
  const silenceOverview = readAuditSilenceOverview();
  const urgentP0P1Count = useMemo(() => filteredQueueRows.filter((r) => (r.severity === "P0" || r.severity === "P1") && !r.silenced).length, [filteredQueueRows]);
  const totalP0P1Count = useMemo(() => filteredQueueRows.filter((r) => r.severity === "P0" || r.severity === "P1").length, [filteredQueueRows]);
  const severityBreakdown = useMemo(
    () =>
      filteredQueueRows.reduce(
        (acc, row) => {
          acc[row.severity] += 1;
          return acc;
        },
        { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<RiskQueueRow["severity"], number>,
      ),
    [filteredQueueRows],
  );
  const sourceBreakdown = useMemo(
    () =>
      filteredQueueRows.reduce(
        (acc, row) => {
          acc[row.eventType] += 1;
          return acc;
        },
        { command: 0, resource: 0, policy_hit: 0 } as Record<RiskQueueRow["eventType"], number>,
      ),
    [filteredQueueRows],
  );
  const leadRisk = queueRows[0] ?? null;
  const hottestTrace = useMemo(() => {
    const byTrace = new Map<
      string,
      { count: number; highestSeverity: RiskQueueRow["severity"]; sample: RiskQueueRow | null }
    >();
    for (const row of filteredQueueRows) {
      const current = byTrace.get(row.traceId);
      if (!current) {
        byTrace.set(row.traceId, { count: 1, highestSeverity: row.severity, sample: row });
        continue;
      }
      current.count += 1;
      if (SEVERITY_ORDER[row.severity] < SEVERITY_ORDER[current.highestSeverity]) {
        current.highestSeverity = row.severity;
        current.sample = row;
      }
    }
    return [...byTrace.entries()]
      .map(([traceId, meta]) => ({ traceId, ...meta }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return SEVERITY_ORDER[a.highestSeverity] - SEVERITY_ORDER[b.highestSeverity];
      })[0] ?? null;
  }, [filteredQueueRows]);
  const dominantSource = useMemo(
    () =>
      (Object.entries(sourceBreakdown) as Array<[RiskQueueRow["eventType"], number]>)
        .sort((a, b) => b[1] - a[1])[0] ?? null,
    [sourceBreakdown],
  );
  const dominantSeverity = useMemo(
    () =>
      (Object.entries(severityBreakdown) as Array<[RiskQueueRow["severity"], number]>)
        .sort((a, b) => b[1] - a[1])[0] ?? null,
    [severityBreakdown],
  );
  const totalRiskItems = filteredQueueRows.length;
  const riskFocusCards = useMemo(() => {
    const cards = [];
    if (leadRisk) {
      cards.push({
        key: "lead-risk",
        icon: "🚨",
        title: t("focusLeadRiskTitle"),
        body: t("focusLeadRiskBody", {
          severity: leadRisk.severity,
          summary: leadRisk.summary,
        }),
        href: `/investigation-center?trace_id=${encodeURIComponent(leadRisk.traceId)}&event_type=${encodeURIComponent(leadRisk.eventType)}&from=risk`,
        cta: t("focusLeadRiskCta"),
      });
    }
    if (hottestTrace) {
      cards.push({
        key: "hot-trace",
        icon: "🧵",
        title: t("focusHotTraceTitle"),
        body: t("focusHotTraceBody", {
          traceId: hottestTrace.traceId,
          count: String(hottestTrace.count),
          severity: hottestTrace.highestSeverity,
        }),
        href: `/investigation-center?trace_id=${encodeURIComponent(hottestTrace.traceId)}&from=risk`,
        cta: t("focusHotTraceCta"),
      });
    }
    if (dominantSource) {
      cards.push({
        key: "dominant-source",
        icon: "🧭",
        title: t("focusDominantSourceTitle"),
        body: t("focusDominantSourceBody", {
          source: getSourceTypeLabel(t, dominantSource[0]),
          count: String(dominantSource[1]),
        }),
        href: `/risk-center?source_type=${encodeURIComponent(dominantSource[0])}`,
        cta: t("focusDominantSourceCta"),
      });
    }
    cards.push({
      key: "silence-health",
      icon: "🔕",
      title: t("focusSilenceHealthTitle"),
      body: t("focusSilenceHealthBody", {
        activeCount: String(silenceOverview.activeCount),
        expiringSoonCount: String(silenceOverview.expiringSoonCount),
      }),
      href: "/investigation-center",
      cta: t("focusSilenceHealthCta"),
    });
    return cards;
  }, [dominantSource, hottestTrace, leadRisk, silenceOverview.activeCount, silenceOverview.expiringSoonCount, t]);
  const triageSuggestions = useMemo(() => {
    const items = [];
    if (urgentP0P1Count > 0) {
      items.push({
        key: "urgent",
        tone: "red",
        title: t("suggestionUrgentTitle"),
        body: t("suggestionUrgentBody", { count: String(urgentP0P1Count) }),
        href: "/risk-center?silenced=unsilenced",
        cta: t("suggestionUrgentCta"),
      });
    }
    if ((sourceBreakdown.policy_hit ?? 0) > 0) {
      items.push({
        key: "policy",
        tone: "amber",
        title: t("suggestionPolicyTitle"),
        body: t("suggestionPolicyBody", { count: String(sourceBreakdown.policy_hit) }),
        href: "/data-security-audit",
        cta: t("suggestionPolicyCta"),
      });
    }
    if (silenceOverview.expiringSoonCount > 0) {
      items.push({
        key: "silence",
        tone: "blue",
        title: t("suggestionSilenceTitle"),
        body: t("suggestionSilenceBody", { count: String(silenceOverview.expiringSoonCount) }),
        href: "/investigation-center",
        cta: t("suggestionSilenceCta"),
      });
    }
    if (items.length === 0) {
      items.push({
        key: "steady",
        tone: "green",
        title: t("suggestionSteadyTitle"),
        body: t("suggestionSteadyBody"),
        href: "/risk-center",
        cta: t("suggestionSteadyCta"),
      });
    }
    return items;
  }, [silenceOverview.expiringSoonCount, sourceBreakdown.policy_hit, t, urgentP0P1Count]);

  const impact = useMemo(() => {
    const resourceItems = eventsQ.data?.items ?? [];
    const commandItems = commandQ.data?.items ?? [];
    const securityItems = securityQ.data?.items ?? [];
    const byAgent = new Map<string, number>();
    const byChannel = new Map<string, number>();
    const byWorkspace = new Map<string, number>();
    for (const row of resourceItems) {
      const a = (row.agent_name || "unknown").trim();
      const c = (row.channel_name || "unknown").trim();
      const w = (row.workspace_name || "unknown").trim();
      byAgent.set(a, (byAgent.get(a) ?? 0) + 1);
      byChannel.set(c, (byChannel.get(c) ?? 0) + 1);
      byWorkspace.set(w, (byWorkspace.get(w) ?? 0) + 1);
    }
    for (const row of commandItems) {
      const a = String(row.agent_name ?? "unknown").trim();
      const c = String(row.channel_name ?? "unknown").trim();
      const w = String(row.workspace_name ?? "unknown").trim();
      byAgent.set(a, (byAgent.get(a) ?? 0) + 1);
      byChannel.set(c, (byChannel.get(c) ?? 0) + 1);
      byWorkspace.set(w, (byWorkspace.get(w) ?? 0) + 1);
    }
    for (const row of securityItems) {
      const w = (row.workspace_name || "unknown").trim();
      byWorkspace.set(w, (byWorkspace.get(w) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) =>
      [...m.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5);
    return { agents: top(byAgent), channels: top(byChannel), workspaces: top(byWorkspace) };
  }, [commandQ.data?.items, eventsQ.data?.items, securityQ.data?.items]);

  const queueColumns: TableColumnProps<RiskQueueRow>[] = [
    {
      title: t("queueColSeverity"),
      dataIndex: "severity",
      width: 96,
      render: (v: RiskQueueRow["severity"]) => <Tag color={getAuditSeverityColor(v)}>{v}</Tag>,
    },
    {
      title: t("queueColSummary"),
      dataIndex: "summary",
      render: (v: string, row: RiskQueueRow) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Typography.Text ellipsis className="flex-1">{v}</Typography.Text>
            <Tag size="small" color={getAuditEventTypeColor(row.eventType)}>{t(`sourceType_${row.eventType}`)}</Tag>
            {row.silenced ? <Tag size="small" color="green">{t("silencedTag")}</Tag> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("whyFlaggedPrefix")}: {row.whyFlagged}
          </div>
        </div>
      ),
    },
    {
      title: t("queueColAction"),
      width: 100,
      render: (_: unknown, row: RiskQueueRow) => (
        <Space size={4}>
          <LocalizedLink
            className="text-primary hover:underline"
            href={`/investigation-center?trace_id=${encodeURIComponent(row.traceId)}&event_type=${encodeURIComponent(row.eventType)}&from=risk`}
            title={row.silenced ? t("openInvestigationManageSilence") : t("openInvestigation")}
          >
            🔍
          </LocalizedLink>
          <LocalizedLink
            className="text-primary hover:underline"
            href={`/alerts?from=risk&trace_id=${encodeURIComponent(row.traceId)}&event_type=${encodeURIComponent(row.eventType)}&recommended_metric=${encodeURIComponent(row.eventType === "command" ? "error_rate_pct" : "sensitive_data_hits")}&recommended_operator=${encodeURIComponent("gt")}&recommended_threshold=${row.eventType === "command" ? 5 : 1}&recommended_window_minutes=5`}
            title={t("openAlertsPrefilled")}
          >
            🔔
          </LocalizedLink>
          <LocalizedLink
            className="text-primary hover:underline"
            href={`/traces?kind=traces&trace=${encodeURIComponent(row.traceId)}`}
            title={t("openTraceDetails")}
          >
            📄
          </LocalizedLink>
        </Space>
      ),
    },
    {
      title: t("queueColImpactScope"),
      dataIndex: "impactedWorkspaceCount",
      width: 100,
      render: (v: number, row: RiskQueueRow) => (
        <div className="text-xs">
          <div className="font-medium">{v}</div>
          <div className="text-muted-foreground">ws</div>
        </div>
      ),
    },
  ];

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Typography.Title heading={3} className="ca-page-title !m-0 text-2xl font-semibold">
                {tNav("riskCenter")}
              </Typography.Title>
              <Popover
                trigger="click"
                position="bottom"
                content={
                  <div className="w-80 space-y-4 p-2">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        <span className="text-lg">📊</span>
                        {t("severityGuideTitle")}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2 dark:bg-red-900/20">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600 dark:bg-red-900/30">P0</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("severityGuideP0")}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-orange-50 p-2 dark:bg-orange-900/20">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600 dark:bg-orange-900/30">P1</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("severityGuideP1")}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600 dark:bg-blue-900/30">P2</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("severityGuideP2")}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/50">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-700">P3</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("severityGuideP3")}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                        <span className="text-lg">⚡</span>
                        {t("actionGuideTitle")}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 dark:bg-gray-800/50">
                          <span className="text-lg">🔍</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("actionGuideInvestigate")}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 dark:bg-gray-800/50">
                          <span className="text-lg">🔔</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("actionGuideAlert")}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 dark:bg-gray-800/50">
                          <span className="text-lg">📄</span>
                          <span className="text-xs text-gray-600 dark:text-gray-400">{t("actionGuideTrace")}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              >
                <Button
                  type="text"
                  size="small"
                  className="!h-7 !w-7 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800"
                  icon={<span className="text-base">ℹ️</span>}
                />
              </Popover>
            </div>
          </div>
        </header>

        {!enabled || statsQ.isLoading || eventsQ.isLoading || commandQ.isLoading || securityQ.isLoading ? (
          <div className="flex justify-center py-16">
            <Spin />
          </div>
        ) : statsQ.isError || eventsQ.isError || commandQ.isError || securityQ.isError ? (
          <Card>
            <div className="space-y-2 py-2 text-sm">
              <Typography.Text>{t("loadErrorTitle")}</Typography.Text>
              <Typography.Text type="secondary">{t("loadErrorBody")}</Typography.Text>
              <div>
                <Button
                  size="small"
                  onClick={() => {
                    void statsQ.refetch();
                    void eventsQ.refetch();
                    void commandQ.refetch();
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
            <section className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
              <Card className="overflow-hidden rounded-2xl border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-red-900 text-white shadow-xl shadow-slate-900/10">
                <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
                  <div className="space-y-5">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-red-200/80">
                        {t("heroEyebrow")}
                      </div>
                      <Typography.Title heading={2} className="!mb-0 !mt-2 !text-3xl !font-semibold !text-white">
                        {t("heroTitle")}
                      </Typography.Title>
                      <Typography.Paragraph className="!mb-0 !mt-3 !text-sm !leading-6 !text-slate-200">
                        {t("heroBody", {
                          urgentCount: String(urgentP0P1Count),
                          total: String(totalRiskItems),
                          source: dominantSource ? getSourceTypeLabel(t, dominantSource[0]) : t("filterAll"),
                        })}
                      </Typography.Paragraph>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-100">
                        {t("heroChipUrgent", { count: String(urgentP0P1Count) })}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-100">
                        {t("heroChipSilence", { count: String(silenceOverview.expiringSoonCount) })}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-100">
                        {t("heroChipFocus", {
                          source: dominantSource ? getSourceTypeLabel(t, dominantSource[0]) : t("filterAll"),
                        })}
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs text-slate-300">{t("heroMetricUrgent")}</div>
                        <div className="mt-2 text-3xl font-semibold">{urgentP0P1Count}</div>
                        <div className="mt-1 text-xs text-red-200">{t("heroMetricUrgentHint")}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs text-slate-300">{t("heroMetricDominantSeverity")}</div>
                        <div className="mt-2 text-3xl font-semibold">{dominantSeverity?.[0] ?? "—"}</div>
                        <div className="mt-1 text-xs text-slate-300">
                          {dominantSeverity ? t("heroMetricDominantSeverityHint", { count: String(dominantSeverity[1]) }) : t("heroMetricEmptyHint")}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs text-slate-300">{t("heroMetricHotTrace")}</div>
                        <div className="mt-2 text-lg font-semibold">
                          {hottestTrace ? hottestTrace.traceId.slice(0, 12) : "—"}
                        </div>
                        <div className="mt-1 text-xs text-slate-300">
                          {hottestTrace ? t("heroMetricHotTraceHint", { count: String(hottestTrace.count) }) : t("heroMetricEmptyHint")}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="text-sm font-semibold text-white">{t("heroChecklistTitle")}</div>
                    <div className="space-y-3">
                      <div className="rounded-xl bg-black/15 p-3">
                        <div className="text-xs font-medium text-red-100">{t("heroChecklistUrgentTitle")}</div>
                        <div className="mt-1 text-sm text-slate-200">
                          {urgentP0P1Count > 0 ? t("heroChecklistUrgentBody", { count: String(urgentP0P1Count) }) : t("heroChecklistUrgentBodyClear")}
                        </div>
                      </div>
                      <div className="rounded-xl bg-black/15 p-3">
                        <div className="text-xs font-medium text-red-100">{t("heroChecklistFocusTitle")}</div>
                        <div className="mt-1 text-sm text-slate-200">
                          {leadRisk ? t("heroChecklistFocusBody", { severity: leadRisk.severity, summary: leadRisk.summary }) : t("heroChecklistFocusBodyClear")}
                        </div>
                      </div>
                      <div className="rounded-xl bg-black/15 p-3">
                        <div className="text-xs font-medium text-red-100">{t("heroChecklistSilenceTitle")}</div>
                        <div className="mt-1 text-sm text-slate-200">
                          {t("heroChecklistSilenceBody", {
                            activeCount: String(silenceOverview.activeCount),
                            expiringSoonCount: String(silenceOverview.expiringSoonCount),
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
              <div className="grid gap-5">
                {riskFocusCards.map((card) => (
                  <Card key={card.key} className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100 text-2xl dark:bg-gray-800">
                        {card.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{card.title}</div>
                        <div className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{card.body}</div>
                        <LocalizedLink href={card.href} className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-2 hover:underline">
                          {card.cta}
                        </LocalizedLink>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-4">
              <Card className="rounded-xl border-0 bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-red-100">{t("kpiUrgentTitle")}</div>
                    <div className="mt-2 text-4xl font-bold">{urgentP0P1Count}</div>
                    <div className="mt-1 text-xs text-red-200">{t("kpiUrgentSubtitle")}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-red-200">{t("kpiTotalP0P1")}</div>
                    <div className="mt-1 text-xl font-semibold">{totalP0P1Count}</div>
                  </div>
                </div>
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-2xl dark:bg-blue-900/20">📊</div>
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("kpiTotalEvents")}</div>
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{statsQ.data?.summary.total_events ?? 0}</div>
                  </div>
                </div>
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-2xl dark:bg-amber-900/20">⚠️</div>
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("kpiRiskEvents")}</div>
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{statsQ.data?.summary.risk_any ?? 0}</div>
                  </div>
                </div>
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-2xl dark:bg-purple-900/20">📈</div>
                  <div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("kpiRiskRatio")}</div>
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{(statsQ.data?.summary.total_events ?? 0) > 0 ? `${Math.round(((statsQ.data?.summary.risk_any ?? 0) * 100) / (statsQ.data?.summary.total_events ?? 1))}%` : "0%"}</div>
                  </div>
                </div>
              </Card>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">🧱</span>{t("compositionSeverityTitle")}</div>}>
                <div className="space-y-4">
                  {(Object.entries(severityBreakdown) as Array<[RiskQueueRow["severity"], number]>).map(([severity, count]) => {
                    const pct = totalRiskItems > 0 ? Math.round((count / totalRiskItems) * 100) : 0;
                    return (
                      <div key={severity} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Tag color={getAuditSeverityColor(severity)}>{severity}</Tag>
                            <span className="text-gray-700 dark:text-gray-300">{t(`severityGuide${severity}`)}</span>
                          </div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">{count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-red-500 via-orange-500 to-amber-400"
                            style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{t("compositionShareLabel", { percent: String(pct) })}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">🛰️</span>{t("compositionSourceTitle")}</div>}>
                <div className="space-y-4">
                  {(Object.entries(sourceBreakdown) as Array<[RiskQueueRow["eventType"], number]>).map(([eventType, count]) => {
                    const pct = totalRiskItems > 0 ? Math.round((count / totalRiskItems) * 100) : 0;
                    return (
                      <div key={eventType} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Tag color={getAuditEventTypeColor(eventType)}>{getSourceTypeLabel(t, eventType)}</Tag>
                            <span className="text-gray-600 dark:text-gray-400">{t("compositionSourceHint", { count: String(count) })}</span>
                          </div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">{pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-sky-500 to-cyan-400"
                            style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-xl bg-gray-50/70 p-4 text-sm text-gray-600 dark:bg-gray-800/40 dark:text-gray-400">
                    <div className="font-medium text-gray-800 dark:text-gray-200">{t("compositionSummaryTitle")}</div>
                    <div className="mt-2">
                      {dominantSource
                        ? t("compositionSummaryBody", {
                            source: getSourceTypeLabel(t, dominantSource[0]),
                            count: String(dominantSource[1]),
                          })
                        : t("compositionSummaryEmpty")}
                    </div>
                  </div>
                </div>
              </Card>
            </section>

            <section className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-2 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">🎯</span>{t("priorityQueueTitle")}</div>}>
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                  <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("presetFilterLabel")}</span>
                  <Button
                    type={presetFilter === "all" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applyPresetFilter("all")}
                  >
                    {t("presetAll")}
                  </Button>
                  <Button
                    type={presetFilter === "urgent" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applyPresetFilter("urgent")}
                  >
                    {t("presetUrgent")}
                  </Button>
                  <Button
                    type={presetFilter === "today" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applyPresetFilter("today")}
                  >
                    {t("presetToday")}
                  </Button>
                  <Button
                    type={presetFilter === "unsilenced" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applyPresetFilter("unsilenced")}
                  >
                    {t("presetUnsilenced")}
                  </Button>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                  <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("dateRangeLabel")}</span>
                  <ObserveDateRangeTrigger value={dateRange} onChange={applyDateRange} />
                </div>
                {traceIdFilter ? (
                  <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-900/20">
                    <span className="font-medium text-blue-700 dark:text-blue-400">{t("activeTraceFilterLabel")}</span>
                    <span className="ml-2 text-blue-600 dark:text-blue-300">{t("activeTraceFilterBody", { traceId: traceIdFilter })}</span>
                    <Button type="text" size="mini" className="!ml-2 text-blue-600 hover:text-blue-800 dark:text-blue-400" onClick={clearTraceFilter}>
                      {t("clearTraceFilter")}
                    </Button>
                  </div>
                ) : null}
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                  <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("sourceTypeFilterLabel")}</span>
                  <Button
                    type={sourceTypeFilter === "all" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySourceTypeFilter("all")}
                  >
                    {t("filterAll")}
                  </Button>
                  <Button
                    type={sourceTypeFilter === "command" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySourceTypeFilter("command")}
                  >
                    {t("sourceType_command")}
                  </Button>
                  <Button
                    type={sourceTypeFilter === "resource" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySourceTypeFilter("resource")}
                  >
                    {t("sourceType_resource")}
                  </Button>
                  <Button
                    type={sourceTypeFilter === "policy_hit" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySourceTypeFilter("policy_hit")}
                  >
                    {t("sourceType_policy_hit")}
                  </Button>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                  <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("severityFilterLabel")}</span>
                  <Button
                    type={severityFilter === "all" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySeverityFilter("all")}
                  >
                    {t("filterAll")}
                  </Button>
                  <Button
                    type={severityFilter === "P0" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySeverityFilter("P0")}
                  >
                    P0
                  </Button>
                  <Button
                    type={severityFilter === "P1" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySeverityFilter("P1")}
                  >
                    P1
                  </Button>
                  <Button
                    type={severityFilter === "P2" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySeverityFilter("P2")}
                  >
                    P2
                  </Button>
                  <Button
                    type={severityFilter === "P3" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySeverityFilter("P3")}
                  >
                    P3
                  </Button>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                  <span className="mr-2 text-sm font-medium text-gray-600 dark:text-gray-400">{t("silenceFilterLabel")}</span>
                  <Button
                    type={silencedFilter === "all" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySilencedFilter("all")}
                  >
                    {t("filterAll")}
                  </Button>
                  <Button
                    type={silencedFilter === "silenced" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySilencedFilter("silenced")}
                  >
                    {t("filterOnlySilenced")}
                  </Button>
                  <Button
                    type={silencedFilter === "unsilenced" ? "primary" : "outline"}
                    size="small"
                    className="rounded-full"
                    onClick={() => applySilencedFilter("unsilenced")}
                  >
                    {t("filterOnlyUnsilenced")}
                  </Button>
                </div>
                <div className="mb-3 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/30">
                  <Typography.Text type="secondary" className="text-sm">
                    {t("queueShowingOfTotal", {
                      shown: String(queueRows.length),
                      total: String(filteredQueueRows.length),
                    })}
                  </Typography.Text>
                </div>
                {filteredQueueRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800/30">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl dark:bg-gray-800">✨</div>
                    <p className="text-base font-medium text-gray-800 dark:text-gray-200 mb-2">
                      {traceIdFilter ? t("emptyQueueForTrace") : t("emptyQueue")}
                    </p>
                    <p className="text-sm text-gray-500 mb-6">
                      {traceIdFilter ? t("emptyQueueForTraceHint") : t("emptyQueueHint")}
                    </p>
                    <div className="flex gap-3">
                      {traceIdFilter ? (
                        <Button type="primary" size="small" className="rounded-full" onClick={clearTraceFilter}>
                          {t("clearTraceFilter")}
                        </Button>
                      ) : (
                        <>
                          <Button type="outline" size="small" className="rounded-full" onClick={() => applyPresetFilter("all")}>
                            {t("resetFilters")}
                          </Button>
                          <Button type="primary" size="small" className="rounded-full" onClick={() => applyDateRange(defaultObserveDateRange())}>
                            {t("expandDateRange")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
                {filteredQueueRows.length > 0 ? (
                  <Table rowKey="key" size="small" pagination={false} columns={queueColumns} data={queueRows} />
                ) : null}
              </Card>
              <div className="space-y-5">
                <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">🌍</span>{t("impactPanelTitle")}</div>}>
                  <div className="space-y-4">
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"><span className="text-lg">🤖</span>{t("impactAgent")}</p>
                      <div className="space-y-1">{impact.agents.map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">{k}</span><span className="font-medium text-gray-800 dark:text-gray-200">{v}</span></div>)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"><span className="text-lg">📡</span>{t("impactChannel")}</p>
                      <div className="space-y-1">{impact.channels.map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">{k}</span><span className="font-medium text-gray-800 dark:text-gray-200">{v}</span></div>)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300"><span className="text-lg">🏢</span>{t("impactWorkspace")}</p>
                      <div className="space-y-1">{impact.workspaces.map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600 dark:text-gray-400">{k}</span><span className="font-medium text-gray-800 dark:text-gray-200">{v}</span></div>)}</div>
                    </div>
                  </div>
                </Card>
                <Card className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50" title={<div className="flex items-center gap-2 text-base font-semibold"><span className="text-xl">🪄</span>{t("suggestionTitle")}</div>}>
                  <div className="space-y-3">
                    {triageSuggestions.map((item) => (
                      <div
                        key={item.key}
                        className={[
                          "rounded-xl border p-4",
                          item.tone === "red"
                            ? "border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-900/10"
                            : item.tone === "amber"
                              ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-900/10"
                              : item.tone === "green"
                                ? "border-green-200 bg-green-50/70 dark:border-green-900/50 dark:bg-green-900/10"
                                : "border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-900/10",
                        ].join(" ")}
                      >
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title}</div>
                        <div className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{item.body}</div>
                        <LocalizedLink href={item.href} className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-2 hover:underline">
                          {item.cta}
                        </LocalizedLink>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </section>
          </>
        )}
      </main>
    </AppPageShell>
  );
}
