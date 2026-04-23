"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Input,
  Pagination,
  Popover,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "@arco-design/web-react";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";
import { IconRefresh } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ReactEChart } from "@/shared/components/react-echart";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/shared/components/localized-link";
import { MessageHint } from "@/shared/components/message-hint";
import { SpanRecordInspectDrawer } from "@/features/audit/resource-access/components/span-record-inspect-drawer";
import { ListEmptyState } from "@/components/list-empty-state";
import { TraceRecordInspectDialog } from "@/features/observe/traces/components/trace-record-inspect-dialog";
import { AuditWorkbenchFilterBar } from "@/shared/components/audit-workbench-filter-bar";
import { AuditLinkActions } from "@/shared/components/audit-link-actions";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/shared/components/trace-copy-icon-button";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import {
  defaultObserveDateRange,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import { parseObserveDateRangeFromListUrl } from "@/lib/observe-list-deep-link";
import {
  OBSERVE_TABLE_FRAME_CLASSNAME,
  OBSERVE_TABLE_SCROLL_X,
} from "@/lib/observe-table-style";
import {
  resourceClassPieFromNamed,
  resourceDailyIoOption,
  resourceHBarOption,
  resourceRiskBarOption,
} from "@/lib/resource-audit-echarts-options";
import {
  loadResourceAuditEvents,
  loadResourceAuditStats,
  type ResourceAuditEventRow,
  type ResourceAuditSemanticClassParam,
} from "@/lib/resource-audit-records";
import { resolveTraceRowForInspect } from "@/lib/observe-inspect-url";
import { loadTraceRecords, traceRecordAgentName, traceRecordChannel, type TraceRecordRow } from "@/lib/trace-records";
import type { SpanRecordRow } from "@/lib/span-records";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";
import { toast } from "@/components/ui/feedback";
import { buildAuditLink } from "@/lib/audit-linkage";

const kpiShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-200 ease-out hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] dark:border-border dark:bg-card dark:shadow-sm dark:hover:shadow-md";

const kpiMetricCardClass =
  "border-[#DCE3F8] bg-gradient-to-br from-[#F7F9FF] via-[#F9FBFF] to-[#EEF3FF]";

function maskUri(uri: string): string {
  if (!uri) {
    return "—";
  }
  const MAX_LENGTH = 30;
  if (uri.length <= MAX_LENGTH) {
    return uri;
  }
  return `...${uri.slice(-MAX_LENGTH)}`;
}

/** `memory://search?q=…` 中 q 为 encodeURIComponent 结果；展示时解码为可读文本（筛选/复制仍用原始 URI）。 */
function formatMemorySearchUriForDisplay(uri: string): string {
  if (!uri) {
    return uri;
  }
  if (!uri.toLowerCase().startsWith("memory://search")) {
    return uri;
  }
  const qm = uri.indexOf("?");
  if (qm < 0) {
    return uri;
  }
  try {
    const sp = new URLSearchParams(uri.slice(qm + 1));
    const q = sp.get("q");
    if (q === null) {
      return uri;
    }
    return `memory://search?q=${q}`;
  } catch {
    return uri;
  }
}

function classLabel(
  t: ReturnType<typeof useTranslations<"ResourceAudit">>,
  c: string,
): string {
  switch (c) {
    case "file":
      return t("classFile");
    case "memory":
      return t("classMemory");
    case "tool_io":
      return t("classToolIo");
    case "other":
      return t("classOther");
    default:
      return c || "—";
  }
}

function flagLabel(
  t: ReturnType<typeof useTranslations<"ResourceAudit">>,
  f: string,
): string {
  switch (f) {
    case "sensitive_path":
      return t("flagSensitivePath");
    case "pii_hint":
      return t("flagPiiHint");
    case "large_read":
      return t("flagLargeRead");
    case "redundant_read":
      return t("flagRedundantRead");
    default:
      return f;
  }
}

function flagColor(f: string): string {
  if (f === "sensitive_path") {
    return "red";
  }
  if (f === "pii_hint") {
    return "orangered";
  }
  if (f === "large_read") {
    return "orange";
  }
  if (f === "redundant_read") {
    return "arcoblue";
  }
  return "gray";
}

function resourceAuditEventToSpanRecord(row: ResourceAuditEventRow): SpanRecordRow {
  const endMs =
    row.duration_ms != null && Number.isFinite(row.duration_ms)
      ? Math.round(row.started_at_ms + row.duration_ms)
      : null;
  return {
    span_id: row.span_id,
    trace_id: row.trace_id,
    parent_span_id: null,
    name: row.span_name || "",
    span_type: row.span_type || "general",
    start_time_ms: row.started_at_ms,
    end_time_ms: endMs,
    duration_ms: row.duration_ms,
    model: null,
    provider: null,
    is_complete: true,
    input_preview: row.snippet,
    output_preview: null,
    thread_key: row.thread_key,
    workspace_name: row.workspace_name,
    project_name: row.project_name,
    agent_name: row.agent_name,
    channel_name: row.channel_name,
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    list_status: "success",
  };
}

function ColHintTitle({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  return (
    <Tooltip content={hint} position="top">
      <span className="cursor-help border-b border-dotted border-[#86909C] dark:border-muted-foreground">
        {label}
      </span>
    </Tooltip>
  );
}

function topRankColorClass(rank: number): string {
  if (rank <= 3) {
    return "text-[#F53F3F]";
  }
  return "text-[#FF7D00]";
}

export function ResourceAuditDashboard() {
  const t = useTranslations("ResourceAudit");
  const tNav = useTranslations("Nav");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const traceFromUrl = searchParams.get("trace_id")?.trim() ?? "";
  const channelFromUrl = searchParams.get("channel")?.trim() ?? "";
  const agentFromUrl = searchParams.get("agent")?.trim() ?? "";
  const sourceFromUrl = searchParams.get("source")?.trim().toLowerCase() ?? "";
  const dateRangeFromUrl = useMemo(
    () => parseObserveDateRangeFromListUrl(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [mounted, setMounted] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [semanticClass, setSemanticClass] = useState<ResourceAuditSemanticClassParam>("all");
  const [uriPrefix, setUriPrefix] = useState("");
  const [uriPrefixDraft, setUriPrefixDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [spanInspectRow, setSpanInspectRow] = useState<SpanRecordRow | null>(null);
  const [messageInspectTrace, setMessageInspectTrace] = useState<TraceRecordRow | null>(null);
  const [messageInspectInitialSpanId, setMessageInspectInitialSpanId] = useState<string | null>(null);
  const isRiskCenterRoute = pathname === "/risk-center";
  const pageTitle = isRiskCenterRoute ? tNav("riskCenter") : tNav("resourceAuditLegacy");
  const sourceLabel = useMemo(() => {
    switch (sourceFromUrl) {
      case "policy":
        return t("sourcePolicy");
      case "resource":
        return t("sourceResource");
      case "command":
        return t("sourceCommand");
      case "messages":
        return t("sourceMessages");
      case "steps":
        return t("sourceSteps");
      default:
        return "";
    }
  }, [sourceFromUrl, t]);

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
    const stored = readStoredObserveDateRange();
    if (stored) {
      setDateRange(stored);
    }
  }, []);

  useEffect(() => {
    if (dateRangeFromUrl) {
      setDateRange(dateRangeFromUrl);
    }
  }, [dateRangeFromUrl]);

  useEffect(() => {
    const stored = readStoredPageSize(50);
    setPageSize(stored);
  }, []);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      void queryClient.invalidateQueries({ queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditEvents] });
      void queryClient.invalidateQueries({ queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditStats] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange), [dateRange]);

  const listParams = useMemo(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: "desc" as const,
      search: search.trim() || undefined,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      semantic_class: semanticClass,
      uri_prefix: uriPrefix.trim() || undefined,
      trace_id: traceFromUrl || undefined,
    }),
    [page, pageSize, search, sinceMs, untilMs, semanticClass, uriPrefix, traceFromUrl],
  );

  const statsParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      semantic_class: semanticClass,
      uri_prefix: uriPrefix.trim() || undefined,
      trace_id: traceFromUrl || undefined,
    }),
    [search, sinceMs, untilMs, semanticClass, uriPrefix, traceFromUrl],
  );

  const enabled = mounted && baseUrl.trim().length > 0;

  const eventsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditEvents, baseUrl, apiKey, listParams],
    queryFn: () => loadResourceAuditEvents(baseUrl, apiKey, listParams),
    enabled,
    staleTime: 20_000,
  });

  const statsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditStats, baseUrl, apiKey, statsParams],
    queryFn: () => loadResourceAuditStats(baseUrl, apiKey, statsParams),
    enabled,
    staleTime: 20_000,
  });

  const traceMetaQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceList, baseUrl, apiKey, "resource-audit-trace-meta", sinceMs ?? 0, untilMs ?? 0, traceFromUrl],
    queryFn: () =>
      loadTraceRecords(baseUrl, apiKey, {
        limit: 5000,
        offset: 0,
        order: "desc",
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        search: traceFromUrl || undefined,
      }),
    enabled,
    staleTime: 20_000,
  });

  const applySearch = useCallback(() => {
    setSearch(searchDraft);
    setPage(1);
  }, [searchDraft]);

  const applyUriPrefix = useCallback(() => {
    setUriPrefix(uriPrefixDraft);
    setPage(1);
  }, [uriPrefixDraft]);

  const clearUriPrefix = useCallback(() => {
    setUriPrefixDraft("");
    setUriPrefix("");
    setPage(1);
  }, []);

  const setTraceFilterUrl = useCallback(
    (tid: string) => {
      const p = new URLSearchParams(searchParams.toString());
      const next = tid.trim();
      if (next) {
        p.set("trace_id", next);
      } else {
        p.delete("trace_id");
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      setPage(1);
    },
    [pathname, router, searchParams],
  );

  const spanDrawerRows = useMemo(
    () => (eventsQ.data?.items ?? []).map(resourceAuditEventToSpanRecord),
    [eventsQ.data?.items],
  );

  const openMessageInspectFromAuditRow = useCallback(
    async (row: ResourceAuditEventRow) => {
      const traceId = row.trace_id?.trim();
      const spanId = row.span_id?.trim();
      if (!traceId || !spanId) {
        return;
      }
      const resolved = await resolveTraceRowForInspect(baseUrl, apiKey, traceId);
      if (!resolved) {
        toast.error(t("openMessageInspectFailed"));
        return;
      }
      setMessageInspectInitialSpanId(spanId);
      setMessageInspectTrace(resolved);
    },
    [apiKey, baseUrl, t],
  );

  const traceMetaById = useMemo(() => {
    const m = new Map<string, { agent: string | null; channel: string | null }>();
    for (const row of traceMetaQ.data?.items ?? []) {
      m.set(row.trace_id, {
        agent: traceRecordAgentName(row),
        channel: traceRecordChannel(row),
      });
    }
    return m;
  }, [traceMetaQ.data?.items]);

  const columns: TableColumnProps<ResourceAuditEventRow>[] = useMemo(
    () => [
      {
        title: <ColHintTitle label={t("colTrace")} hint={t("colTraceHint")} />,
        dataIndex: "span_id",
        key: "span_id",
        fixed: "left",
        width: 120,
        render: (_: unknown, row: ResourceAuditEventRow) => (
          <Button
            type="text"
            size="mini"
            className="!h-auto justify-start !px-0 !py-0 text-xs text-primary"
            onClick={() => {
              void openMessageInspectFromAuditRow(row);
            }}
          >
            {formatShortId(row.span_id)}
          </Button>
        ),
      },
      {
        title: <ColHintTitle label={t("colUri")} hint={t("colUriHint")} />,
        dataIndex: "resource_uri",
        key: "resource_uri",
        width: 280,
        render: (uri: string) => {
          const displayUri = formatMemorySearchUriForDisplay(uri);
          return (
          <div className="flex items-center gap-1">
            <Popover content={<div className="max-w-md break-all text-xs">{displayUri || "—"}</div>}>
              <span className="text-xs">{maskUri(displayUri)}</span>
            </Popover>
            {uri && (
              <TraceCopyIconButton
                text={uri}
                ariaLabel={t("copy")}
                tooltipLabel={t("copy")}
                successLabel={t("copySuccessToast")}
                stopPropagation={true}
              />
            )}
          </div>
          );
        },
      },
      {
        title: <ColHintTitle label={t("colClass")} hint={t("colClassHint")} />,
        dataIndex: "semantic_class",
        width: 120,
        render: (c: string) => <span className="text-xs">{classLabel(t, c)}</span>,
      },
      {
        title: <ColHintTitle label={t("colTime")} hint={t("colTimeHint")} />,
        dataIndex: "started_at_ms",
        width: 160,
        render: (ms: number) => (
          <span className="whitespace-nowrap text-xs">
            {formatTraceDateTimeFromMs(ms)}
          </span>
        ),
      },
      {
        title: <ColHintTitle label={t("colDuration")} hint={t("colDurationHint")} />,
        dataIndex: "duration_ms",
        width: 96,
        render: (n: number | null) => (
          <span className="tabular-nums text-xs">{n != null ? `${Math.round(n)} ms` : "—"}</span>
        ),
      },
      {
        title: <ColHintTitle label={t("colExecType")} hint={t("colExecTypeHint")} />,
        dataIndex: "span_name",
        key: "span_name",
        width: 120,
        ellipsis: true,
        render: (name: string) => (
          <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
            {name || "—"}
          </Typography.Text>
        ),
      },
      {
        title: <ColHintTitle label={t("colAgent")} hint={t("colAgentHint")} />,
        dataIndex: "agent_name",
        width: 120,
        render: (name: string | null, row: ResourceAuditEventRow) => (
          <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
            {name?.trim() || traceMetaById.get(row.trace_id)?.agent?.trim() || "—"}
          </Typography.Text>
        ),
      },
      {
        title: <ColHintTitle label={t("colChannel")} hint={t("colChannelHint")} />,
        dataIndex: "channel_name",
        width: 120,
        render: (name: string | null, row: ResourceAuditEventRow) => (
          <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
            {name?.trim() || traceMetaById.get(row.trace_id)?.channel?.trim() || "—"}
          </Typography.Text>
        ),
      },
      {
        title: <ColHintTitle label={t("colChars")} hint={t("colCharsHint")} />,
        dataIndex: "chars",
        width: 100,
        render: (n: number | null) => (
          <span className="tabular-nums text-xs">{n != null ? n.toLocaleString() : "—"}</span>
        ),
      },
      {
        title: <ColHintTitle label={t("colLinkage")} hint={t("colLinkageHint")} />,
        width: 168,
        render: (_: unknown, row: ResourceAuditEventRow) => (
          <Space direction="vertical" size={4}>
            <Button
              type="text"
              size="mini"
              className="!h-auto justify-start !px-0 !py-0 text-xs text-primary"
              onClick={() => setTraceFilterUrl(row.trace_id)}
            >
              {t("filterSameTrace")}
            </Button>
            <AuditLinkActions
              vertical
              actions={[
                {
                  label: t("openSecurityAudit"),
                  href: buildAuditLink("/data-security-audit", {
                    source: "resource",
                    trace_id: row.trace_id,
                    span_id: row.span_id,
                    since_ms: sinceMs,
                    until_ms: untilMs,
                    channel: channelFromUrl || undefined,
                    agent: agentFromUrl || undefined,
                  }),
                },
              ]}
            />
          </Space>
        ),
      },
      {
        title: <ColHintTitle label={t("colFlags")} hint={t("colFlagsHint")} />,
        dataIndex: "risk_flags",
        width: 200,
        render: (flags: string[]) => (
          <Space size={4} wrap>
            {(flags ?? []).map((f) => (
              <Tag key={f} size="small" color={flagColor(f)}>
                {flagLabel(t, f)}
              </Tag>
            ))}
          </Space>
        ),
      },
    ],
    [t, setTraceFilterUrl, traceMetaById, openMessageInspectFromAuditRow, sinceMs, untilMs, channelFromUrl, agentFromUrl],
  );

  const dailyRows = useMemo(() => {
    const io = statsQ.data?.daily_io;
    if (!io?.length || !io.some((d) => d.day)) {
      return null;
    }
    return io.map((d) => ({
      day: d.day.length >= 10 ? d.day.slice(5) : d.day,
      n: d.event_count,
      avg: d.avg_duration_ms != null ? Math.round(d.avg_duration_ms) : 0,
    }));
  }, [statsQ.data?.daily_io]);

  const dailyOpt = useMemo(
    () => (dailyRows ? resourceDailyIoOption(dailyRows, t("seriesEvents"), t("seriesAvgMs")) : null),
    [dailyRows, t],
  );

  const classPieOpt = useMemo(() => {
    const dist = statsQ.data?.class_distribution ?? [];
    if (!dist.length) {
      return null;
    }
    return resourceClassPieFromNamed(
      dist.map((c) => ({ name: classLabel(t, c.semantic_class), value: c.count })),
    );
  }, [statsQ.data?.class_distribution, t]);

  const riskBarOpt = useMemo(() => {
    const s = statsQ.data?.summary;
    if (!s) {
      return null;
    }
    const rows = [
      { name: t("flagSensitivePath"), value: s.risk_sensitive_path },
      { name: t("flagPiiHint"), value: s.risk_pii_hint },
      { name: t("flagLargeRead"), value: s.risk_large_read },
      { name: t("flagRedundantRead"), value: s.risk_redundant_read },
    ];
    if (!rows.some((r) => r.value > 0)) {
      return null;
    }
    return resourceRiskBarOption(rows, t("chartRiskHits"));
  }, [statsQ.data?.summary, t]);

  const toolsBarOpt = useMemo(() => {
    const tools = statsQ.data?.top_tools ?? [];
    if (!tools.length) {
      return null;
    }
    return resourceHBarOption(
      tools.map((x) => ({ label: x.span_name, value: x.count })),
      t("chartTopTools"),
      "#7c3aed",
    );
  }, [statsQ.data?.top_tools, t]);

  const topDurationEventRows = useMemo(() => {
    const rows = (eventsQ.data?.items ?? [])
      .filter((r) => r.duration_ms != null && Number.isFinite(r.duration_ms))
      .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms))
      .slice(0, 10);
    return rows;
  }, [eventsQ.data?.items]);

  if (!mounted) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1] flex justify-center py-16">
          <Spin />
        </main>
      </AppPageShell>
    );
  }

  if (!baseUrl.trim()) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1]">
          <Typography.Title heading={4} className="ca-page-title !m-0">
            {t("title")}
          </Typography.Title>
          <Typography.Text type="secondary" className="mt-2 block">
            {t("needCollector")}
          </Typography.Text>
        </main>
      </AppPageShell>
    );
  }

  const dailyChart =
    dailyRows && dailyOpt ? (
      <div className="h-[220px] w-full min-w-0">
        <ReactEChart option={dailyOpt} />
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        {t("emptyWidget")}
      </Typography.Text>
    );

  const summary = statsQ.data?.summary;
  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {pageTitle}
            </Typography.Title>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isRiskCenterRoute ? (
                <LocalizedLink
                  href="/resource-audit"
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {tNav("resourceAuditLegacy")}
                </LocalizedLink>
              ) : (
                <LocalizedLink
                  href="/risk-center"
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {tNav("riskCenter")}
                </LocalizedLink>
              )}
              {sourceLabel ? (
                <Tag color="arcoblue" size="small">
                  {t("filterChipSource", { source: sourceLabel })}
                </Tag>
              ) : null}
            </div>
          </div>
          <Space wrap>
            <Button
              type="default"
              size="small"
              icon={<IconRefresh className={cn(eventsQ.isFetching && "animate-spin")} />}
              disabled={eventsQ.isFetching}
              onClick={() => {
                void eventsQ.refetch();
                void statsQ.refetch();
              }}
            >
              {t("refresh")}
            </Button>
          </Space>
        </header>
        <AuditWorkbenchFilterBar withChannelAgent={false} />

        <div className="space-y-3">
          <section aria-label={t("sectionKpi")} className="space-y-3">
          <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
            {t("sectionKpi")}
          </Typography.Title>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card bordered={false} className={cn(kpiShellClass, kpiMetricCardClass)} bodyStyle={{ padding: "16px" }}>
              <Typography.Text className="text-[13px] font-medium text-[#86909C] dark:text-muted-foreground">
                {t("kpiTotalEvents")}
              </Typography.Text>
              <div className="mt-2 text-[22px] font-semibold tabular-nums text-[#1D2129] dark:text-foreground">
                {summary ? summary.total_events.toLocaleString() : "—"}
              </div>
            </Card>
            <Card bordered={false} className={cn(kpiShellClass, kpiMetricCardClass)} bodyStyle={{ padding: "16px" }}>
              <Tooltip content={t("kpiDistinctTracesHint")}>
                <Typography.Text className="block cursor-help text-[13px] font-medium text-[#86909C] underline decoration-dotted dark:text-muted-foreground">
                  {t("kpiDistinctTraces")}
                </Typography.Text>
              </Tooltip>
              <div className="mt-2 text-[22px] font-semibold tabular-nums text-[#1D2129] dark:text-foreground">
                {summary ? summary.distinct_traces.toLocaleString() : "—"}
              </div>
            </Card>
            <Card bordered={false} className={cn(kpiShellClass, kpiMetricCardClass)} bodyStyle={{ padding: "16px" }}>
              <Tooltip content={t("kpiRiskAnyHint")}>
                <Typography.Text className="block cursor-help text-[13px] font-medium text-[#86909C] underline decoration-dotted dark:text-muted-foreground">
                  {t("kpiRiskAny")}
                </Typography.Text>
              </Tooltip>
              <div className="mt-2 text-[22px] font-semibold tabular-nums text-[#1D2129] dark:text-foreground">
                {summary ? summary.risk_any.toLocaleString() : "—"}
              </div>
              {summary && summary.total_events > 0 ? (
                <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                  {t("kpiRiskShare", {
                    pct: String(Math.round((summary.risk_any / summary.total_events) * 1000) / 10),
                  })}
                </div>
              ) : null}
            </Card>
          </div>
        </section>

          <section aria-label={t("sectionDashboard")} className="space-y-3">
            <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
              {t("sectionDashboard")}
            </Typography.Title>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t("topResources")} bordered className="shadow-sm rounded-lg" headerStyle={{ borderBottom: 'none' }}>
                {(statsQ.data?.top_resources ?? []).length === 0 ? (
                  <ListEmptyState title={t("emptyWidget")} className="min-h-[200px]" />
                ) : (
                  <ul className="space-y-1.5">
                    {statsQ.data!.top_resources.map((r, idx) => (
                      <li key={r.uri} className="last:border-0">
                        <div className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded px-1 py-1 text-left">
                          <span
                            className={cn(
                              "inline-flex w-6 shrink-0 items-center justify-center text-base font-semibold leading-none",
                              topRankColorClass(idx + 1),
                            )}
                          >
                            {idx + 1}
                          </span>
                          <Popover
                            content={
                              <div className="max-w-md break-all text-xs">
                                {formatMemorySearchUriForDisplay(r.uri) || "—"}
                              </div>
                            }
                          >
                            <Typography.Text ellipsis className="min-w-0 text-xs text-[#1D2129] dark:text-foreground">
                              {maskUri(formatMemorySearchUriForDisplay(r.uri))}
                            </Typography.Text>
                          </Popover>
                          <span className="shrink-0 text-right text-sm tabular-nums text-[#86909C]">
                            {Math.round(r.count).toLocaleString()}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={t("topResourceDuration")} bordered className="shadow-sm rounded-lg" headerStyle={{ borderBottom: 'none' }}>
                {topDurationEventRows.length === 0 ? (
                  <ListEmptyState title={t("emptyWidget")} className="min-h-[200px]" />
                ) : (
                  <ul className="space-y-1.5">
                    {topDurationEventRows.map((r, idx) => (
                      <li key={`${r.span_id}-${idx}`} className="last:border-0">
                        <button
                          type="button"
                          className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-muted/40"
                          onClick={() => setSpanInspectRow(resourceAuditEventToSpanRecord(r))}
                        >
                          <span
                            className={cn(
                              "inline-flex w-6 shrink-0 items-center justify-center text-base font-semibold leading-none",
                              topRankColorClass(idx + 1),
                            )}
                          >
                            {idx + 1}
                          </span>
                          <Popover
                            content={
                              <div className="max-w-md break-all text-xs">
                                {formatMemorySearchUriForDisplay(r.resource_uri) || "—"}
                              </div>
                            }
                          >
                            <Typography.Text ellipsis className="min-w-0 text-xs text-[#1D2129] dark:text-foreground">
                              {maskUri(formatMemorySearchUriForDisplay(r.resource_uri))}
                            </Typography.Text>
                          </Popover>
                          <span className="shrink-0 text-right text-sm tabular-nums text-[#86909C]">
                            {`${Math.round(Number(r.duration_ms ?? 0))} ms`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={t("classDist")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }} headerStyle={{ borderBottom: 'none' }}>
                {classPieOpt ? (
                  <div className="h-[260px] w-full min-w-0">
                    <ReactEChart option={classPieOpt} />
                  </div>
                ) : (statsQ.data?.class_distribution?.length ? (
                  <Space direction="vertical" size={8} className="w-full py-4">
                    {(statsQ.data?.class_distribution ?? []).map((c) => (
                      <div key={c.semantic_class} className="flex items-center justify-between text-sm">
                        <span>{classLabel(t, c.semantic_class)}</span>
                        <Tag>{c.count}</Tag>
                      </div>
                    ))}
                  </Space>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("emptyWidget")}
                  </div>
                ))}
              </Card>
              <Card title={t("dailyTrend")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }} headerStyle={{ borderBottom: 'none' }}>
                {statsQ.isFetching && !statsQ.data ? (
                  <Spin className="py-8" />
                ) : dailyChart}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t("chartRiskHits")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }} headerStyle={{ borderBottom: 'none' }}>
                {riskBarOpt ? (
                  <div className="h-[200px] w-full min-w-0">
                    <ReactEChart option={riskBarOpt} />
                  </div>
                ) : (
                  <Typography.Text type="secondary" className="text-sm">
                    {t("emptyRiskChart")}
                  </Typography.Text>
                )}
              </Card>

              <Card title={t("chartTopTools")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }} headerStyle={{ borderBottom: 'none' }}>
                {toolsBarOpt ? (
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={toolsBarOpt} />
                  </div>
                ) : (
                  <Typography.Text type="secondary" className="text-sm">
                    {t("emptyWidget")}
                  </Typography.Text>
                )}
              </Card>
            </div>
          </section>

        <section aria-label={t("sectionTable")} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
            <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
              {t("sectionTable")}
            </Typography.Title>
            <Space wrap className="items-center">
              <Input.Search
                size="small"
                placeholder={t("searchPlaceholder")}
                style={{ width: 260 }}
                value={searchDraft}
                onChange={setSearchDraft}
                onSearch={applySearch}
              />
              <Space size={8}>
                <Input.Search
                  size="small"
                  placeholder={t("uriPrefixPlaceholder")}
                  style={{ width: 220 }}
                  value={uriPrefixDraft}
                  onChange={setUriPrefixDraft}
                  onSearch={applyUriPrefix}
                />
                {uriPrefix ? (
                  <Button type="outline" size="small" onClick={clearUriPrefix}>
                    {t("clearUriPrefix")}
                  </Button>
                ) : null}
              </Space>
              <Select
                size="small"
                style={{ width: 160 }}
                value={semanticClass}
                onChange={(v) => {
                  setSemanticClass((v as ResourceAuditSemanticClassParam) ?? "all");
                  setPage(1);
                }}
              >
                <Select.Option value="all">{t("classAll")}</Select.Option>
                <Select.Option value="file">{t("classFile")}</Select.Option>
                <Select.Option value="memory">{t("classMemory")}</Select.Option>
                <Select.Option value="tool_io">{t("classToolIo")}</Select.Option>
              </Select>
            </Space>
          </div>

          {traceFromUrl ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Tag color="arcoblue" size="small">
                {t("activeTraceFilter", { id: formatShortId(traceFromUrl) })}
              </Tag>
              <LocalizedLink
                href={`/traces?trace=${encodeURIComponent(traceFromUrl)}`}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("openTraceListForFilter")}
              </LocalizedLink>
              <Button type="outline" size="mini" onClick={() => setTraceFilterUrl("")}>
                {t("clearTraceFilter")}
              </Button>
            </div>
          ) : null}

          {eventsQ.isError ? (
            <MessageHint text={String(eventsQ.error)} clampClass="line-clamp-6" className="text-destructive" />
          ) : null}

          {eventsQ.isFetching && !eventsQ.data ? (
            <div className="flex justify-center py-12">
              <Spin tip={t("loading")} />
            </div>
          ) : (
            <>
              {(eventsQ.data?.items.length ?? 0) === 0 ? (
                <ListEmptyState title={t("emptyStateTitle")} className="min-h-[300px]" />
              ) : (
                <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
                  <ScrollableTableFrame
                    variant="neutral"
                    contentKey={`${eventsQ.data?.items.length ?? 0}`}
                    scrollClassName="overflow-x-visible touch-pan-x overscroll-x-contain"
                  >
                    <div className="min-w-0 w-full">
                      <Table
                        tableLayoutFixed
                        size="small"
                        border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
                        columns={columns}
                        data={eventsQ.data?.items ?? []}
                        rowKey="span_id"
                        pagination={false}
                        scroll={OBSERVE_TABLE_SCROLL_X}
                        hover={true}
                      />
                    </div>
                  </ScrollableTableFrame>
                </div>
              )}
              {(eventsQ.data?.items?.length ?? 0) > 0 ? (
                <div className="flex flex-col items-center gap-2 pt-4 sm:flex-row sm:justify-between">
                <Typography.Text type="secondary" className="text-xs">
                  {t("showingOfTotal", {
                    from: String(eventsQ.data?.items.length ? (page - 1) * pageSize + 1 : 0),
                    to: String(eventsQ.data?.items.length ? (page - 1) * pageSize + eventsQ.data!.items.length : 0),
                    total: String(eventsQ.data?.total ?? 0),
                  })}
                </Typography.Text>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {t("paginationTotalPages", {
                      count: String(Math.max(1, Math.ceil((eventsQ.data?.total ?? 0) / pageSize) || 1)),
                    })}
                  </span>
                  <Pagination
                    className="resource-audit-audit-log-pagination"
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={eventsQ.data?.total ?? 0}
                    onChange={(nextPage, nextPageSize) => {
                      if (nextPageSize && nextPageSize !== pageSize) {
                        setPageSize(nextPageSize);
                        writeStoredPageSize(nextPageSize);
                      }
                      setPage(nextPage);
                    }}
                    showTotal
                    bufferSize={1}
                    sizeCanChange
                    sizeOptions={[...PAGE_SIZE_OPTIONS]}
                    showJumper
                    disabled={eventsQ.isFetching}
                  />
                </div>
              </div>
              ) : null}
            </>
          )}
        </section>
        </div>
      </main>

      <SpanRecordInspectDrawer
        open={spanInspectRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setSpanInspectRow(null);
          }
        }}
        row={spanInspectRow}
        rows={spanDrawerRows}
        onNavigate={setSpanInspectRow}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />

      <TraceRecordInspectDialog
        open={messageInspectTrace != null}
        onOpenChange={(next) => {
          if (!next) {
            setMessageInspectTrace(null);
            setMessageInspectInitialSpanId(null);
          }
        }}
        row={messageInspectTrace}
        initialSpanId={messageInspectInitialSpanId}
        rows={messageInspectTrace ? [messageInspectTrace] : []}
        onNavigate={(r) => {
          setMessageInspectTrace(r);
          setMessageInspectInitialSpanId(null);
        }}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />
    </AppPageShell>
  );
}
