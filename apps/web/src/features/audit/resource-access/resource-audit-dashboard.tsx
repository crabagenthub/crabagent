"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Input,
  Message,
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
import { IconApps, IconList, IconCopy, IconRefresh, IconArrowFall, IconArrowRise, IconShareExternal } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ReactEChart } from "@/shared/components/react-echart";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint, TitleHintIcon } from "@/shared/components/message-hint";
import { SpanRecordInspectDrawer } from "@/features/audit/resource-access/components/span-record-inspect-drawer";
import { TraceRecordInspectDialog } from "@/features/observe/traces/components/trace-record-inspect-dialog";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/shared/components/trace-copy-icon-button";
import { LocalizedLink } from "@/shared/components/localized-link";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import {
  defaultObserveDateRange,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  writeStoredObserveDateRange,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
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
import {
  loadTraceRecords,
  traceRecordAgentName,
  traceRecordChannel,
  type TraceRecordRow,
} from "@/lib/trace-records";
import type { SpanRecordRow } from "@/lib/span-records";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";
import { buildAuditLink } from "@/lib/audit-linkage";

type ResourceAuditViewKind = "metrics" | "details";

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
    case "secret_hint":
      return t("flagSecretHint");
    case "credential_hint":
      return t("flagCredentialHint");
    case "config_hint":
      return t("flagConfigHint");
    case "database_hint":
      return t("flagDatabaseHint");
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
  if (f === "secret_hint" || f === "credential_hint") {
    return "red";
  }
  if (f === "config_hint" || f === "database_hint") {
    return "purple";
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

type MomTagTone = "green" | "red" | "gray";

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function momTagMeta(n: number | null): { text: string; color: MomTagTone } {
  if (n == null || !Number.isFinite(n)) {
    return { text: "—", color: "gray" };
  }
  if (Math.abs(n) < 0.005) {
    return { text: "0.00%", color: "gray" };
  }
  if (n > 0) {
    return { text: fmtPct(n), color: "green" };
  }
  return { text: fmtPct(n), color: "red" };
}

function KpiMomPill({ tone, text }: { tone: MomTagTone; text: string }) {
  const palette =
    tone === "green"
      ? "bg-[#E8FFEA] text-[#00B42A]"
      : tone === "red"
        ? "bg-[#FFECE8] text-[#F53F3F]"
        : "bg-[#F2F3F5] text-[#86909C]";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium tabular-nums", palette)}>
      {tone === "green" ? <IconArrowRise className="size-3 shrink-0" aria-hidden /> : null}
      {tone === "red" ? <IconArrowFall className="size-3 shrink-0" aria-hidden /> : null}
      {text}
    </span>
  );
}

function ResourceKpiCard({
  title,
  hint,
  value,
  onView,
  momLabel,
  mom,
}: {
  title: string;
  hint?: string;
  value: string;
  onView: () => void;
  momLabel: string;
  mom: number | null;
}) {
  const t = useTranslations("ResourceAudit");
  const momM = momTagMeta(mom);
  return (
    <Card bordered={false} className={cn(kpiShellClass, kpiMetricCardClass, "group")} bodyStyle={{ padding: "16px" }}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Typography.Text className="text-[13px] font-medium text-[#86909C] dark:text-muted-foreground">{title}</Typography.Text>
          {hint ? (
            <TitleHintIcon
              tooltipText={hint}
              iconClassName="h-3.5 w-3.5 text-[#86909C] dark:text-muted-foreground"
              className="shrink-0"
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          aria-label={t("kpiViewDetailsAria")}
        >
          <IconShareExternal className="size-3.5 shrink-0" aria-hidden />
          {t("kpiViewDetails")}
        </button>
      </div>
      <div className="text-[22px] font-semibold tabular-nums text-[#1D2129] dark:text-foreground">{value}</div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Typography.Text className="text-[11px] text-[#86909C] dark:text-muted-foreground">{momLabel}</Typography.Text>
        <KpiMomPill tone={momM.color} text={momM.text} />
      </div>
    </Card>
  );
}

export function ResourceAuditDashboard() {
  const t = useTranslations("ResourceAudit");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const traceFromUrl = searchParams.get("trace_id")?.trim() ?? "";
  const spanFromUrl = searchParams.get("span_id")?.trim() ?? "";
  const uriPrefixFromUrl = searchParams.get("uri_prefix")?.trim() ?? "";
  const hintTypeFromUrl = searchParams.get("hint_type")?.trim() ?? "";
  const policyIdFromUrl = searchParams.get("policy_id")?.trim() ?? "";
  const riskOnlyFromUrl = searchParams.get("risk_only") === "1";
  const riskFlagFromUrl = searchParams.get("risk_flag")?.trim() ?? "";
  const p95SlowFromUrl = searchParams.get("p95_slow") === "1";
  const sortModeFromUrl = searchParams.get("sort_mode")?.trim() ?? "";
  const spanNameFromUrl = searchParams.get("span_name")?.trim() ?? "";
  const [mounted, setMounted] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [semanticClass, setSemanticClass] = useState<ResourceAuditSemanticClassParam>("all");
  const [uriPrefix, setUriPrefix] = useState("");
  const [uriPrefixDraft, setUriPrefixDraft] = useState("");
  const [sortMode, setSortMode] = useState<"time_desc" | "risk_first" | "chars_desc">(
    sortModeFromUrl === "risk_first" || sortModeFromUrl === "chars_desc" ? (sortModeFromUrl as "risk_first" | "chars_desc") : "time_desc",
  );
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [reviewedSpanIds, setReviewedSpanIds] = useState<Set<string>>(new Set());
  const [riskOnly, setRiskOnly] = useState(riskOnlyFromUrl);
  const [riskFlagFilter, setRiskFlagFilter] = useState<string>(riskFlagFromUrl);
  const [p95SlowOnly, setP95SlowOnly] = useState(p95SlowFromUrl);
  const [spanNameFilter, setSpanNameFilter] = useState(spanNameFromUrl);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [spanInspectRow, setSpanInspectRow] = useState<SpanRecordRow | null>(null);
  const [inspectTraceRow, setInspectTraceRow] = useState<TraceRecordRow | null>(null);
  const [inspectTraceInitialSpanId, setInspectTraceInitialSpanId] = useState<string | null>(null);
  const [viewKind, setViewKind] = useState<ResourceAuditViewKind>("metrics");

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
    const stored = readStoredPageSize(50);
    setPageSize(stored);
  }, []);

  useEffect(() => {
    if (!uriPrefixFromUrl) {
      return;
    }
    setUriPrefix(uriPrefixFromUrl);
    setUriPrefixDraft(uriPrefixFromUrl);
  }, [uriPrefixFromUrl]);

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

  const setDateRangePersist = useCallback((next: ObserveDateRange) => {
    setDateRange(next);
    writeStoredObserveDateRange(next);
  }, []);

  const listParams = useMemo(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: "desc" as const,
      sort_mode: sortMode,
      search: search.trim() || undefined,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      semantic_class: semanticClass,
      uri_prefix: uriPrefix.trim() || undefined,
      trace_id: traceFromUrl || undefined,
      span_id: spanFromUrl || undefined,
      hint_type: hintTypeFromUrl || undefined,
      policy_id: policyIdFromUrl || undefined,
      span_name: spanNameFilter.trim() || undefined,
    }),
    [page, pageSize, sortMode, search, sinceMs, untilMs, semanticClass, uriPrefix, traceFromUrl, spanFromUrl, hintTypeFromUrl, policyIdFromUrl, spanNameFilter],
  );

  const statsParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      semantic_class: semanticClass,
      uri_prefix: uriPrefix.trim() || undefined,
      trace_id: traceFromUrl || undefined,
      span_id: spanFromUrl || undefined,
      hint_type: hintTypeFromUrl || undefined,
      policy_id: policyIdFromUrl || undefined,
    }),
    [search, sinceMs, untilMs, semanticClass, uriPrefix, traceFromUrl, spanFromUrl, hintTypeFromUrl, policyIdFromUrl],
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

  const prevWindow = useMemo(() => {
    if (sinceMs == null || untilMs == null || untilMs <= sinceMs) {
      return null;
    }
    const width = untilMs - sinceMs;
    return { sinceMs: Math.max(0, sinceMs - width), untilMs: sinceMs };
  }, [sinceMs, untilMs]);

  const prevStatsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.resourceAuditStats, baseUrl, apiKey, "prev", prevWindow, statsParams.search, statsParams.semantic_class, statsParams.uri_prefix, statsParams.trace_id],
    queryFn: () =>
      loadResourceAuditStats(baseUrl, apiKey, {
        ...statsParams,
        sinceMs: prevWindow?.sinceMs,
        untilMs: prevWindow?.untilMs,
      }),
    enabled: enabled && prevWindow != null,
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

  const filterByResourceUri = useCallback((prefix: string) => {
    setUriPrefixDraft(prefix);
    setUriPrefix(prefix);
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

  const setHintTypeFilterUrl = useCallback(
    (hintType: string) => {
      const p = new URLSearchParams(searchParams.toString());
      const next = hintType.trim();
      if (next) {
        p.set("hint_type", next);
      } else {
        p.delete("hint_type");
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      setPage(1);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString());
    const hasAnyScopedFilter =
      riskOnly || Boolean(riskFlagFilter.trim()) || p95SlowOnly || sortMode !== "time_desc" || Boolean(spanNameFilter.trim());
    if (riskOnly) p.set("risk_only", "1");
    else p.delete("risk_only");
    if (riskFlagFilter.trim()) p.set("risk_flag", riskFlagFilter.trim());
    else p.delete("risk_flag");
    if (p95SlowOnly) p.set("p95_slow", "1");
    else p.delete("p95_slow");
    if (sortMode && sortMode !== "time_desc") p.set("sort_mode", sortMode);
    else p.delete("sort_mode");
    if (spanNameFilter.trim()) p.set("span_name", spanNameFilter.trim());
    else p.delete("span_name");
    if (hasAnyScopedFilter) p.set("source", "resource");
    else if (p.get("source") === "resource") p.delete("source");
    const qs = p.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    const current = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
    if (target !== current) {
      router.replace(target);
    }
  }, [riskOnly, riskFlagFilter, p95SlowOnly, sortMode, spanNameFilter, pathname, router, searchParams]);

  const openTraceInspectAtSpan = useCallback(
    async (row: ResourceAuditEventRow) => {
      const traceId = row.trace_id?.trim();
      const spanId = row.span_id?.trim();
      if (!traceId) {
        return;
      }
      const hit = (traceMetaQ.data?.items ?? []).find((x) => x.trace_id === traceId) ?? null;
      const resolved = hit ?? (await resolveTraceRowForInspect(baseUrl, apiKey, traceId));
      if (!resolved) {
        return;
      }
      setInspectTraceInitialSpanId(spanId || null);
      setInspectTraceRow(resolved);
    },
    [apiKey, baseUrl, traceMetaQ.data?.items],
  );

  const spanDrawerRows = useMemo(
    () => (eventsQ.data?.items ?? []).map(resourceAuditEventToSpanRecord),
    [eventsQ.data?.items],
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
        dataIndex: "trace_id",
        fixed: "left",
        width: 120,
        render: (_: unknown, row: ResourceAuditEventRow) => (
          <Button
            type="text"
            size="mini"
            className="!h-auto justify-start !px-0 !py-0 text-xs text-primary"
            onClick={() => {
              void openTraceInspectAtSpan(row);
            }}
          >
            {formatShortId(row.span_id)}
          </Button>
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
            <Button
              type="text"
              size="mini"
              className="!h-auto justify-start !px-0 !py-0 text-xs text-primary"
              onClick={() =>
                router.push(
                  buildAuditLink("/data-security", {
                    source: "resource",
                    trace_id: row.trace_id,
                    span_id: row.span_id,
                    uri_prefix: row.resource_uri || undefined,
                  }),
                )
              }
            >
              {t("openSecurityAudit")}
            </Button>
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
    [t, openTraceInspectAtSpan, setTraceFilterUrl, traceMetaById, router],
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
      { name: t("flagSecretHint"), value: s.risk_secret_hint },
      { name: t("flagCredentialHint"), value: s.risk_credential_hint },
      { name: t("flagConfigHint"), value: s.risk_config_hint },
      { name: t("flagDatabaseHint"), value: s.risk_database_hint },
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

  const classChartEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const name = String((params as { name?: unknown })?.name ?? "");
        const match = (statsQ.data?.class_distribution ?? []).find((c) => classLabel(t, c.semantic_class) === name);
        if (match) {
          setSemanticClass((match.semantic_class as ResourceAuditSemanticClassParam) ?? "all");
          setViewKind("details");
        }
      },
    }),
    [statsQ.data?.class_distribution, t],
  );

  const riskChartEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const name = String((params as { name?: unknown })?.name ?? "");
        const entries: Array<{ label: string; flag: string }> = [
          { label: t("flagSensitivePath"), flag: "sensitive_path" },
          { label: t("flagPiiHint"), flag: "pii_hint" },
          { label: t("flagSecretHint"), flag: "secret_hint" },
          { label: t("flagCredentialHint"), flag: "credential_hint" },
          { label: t("flagConfigHint"), flag: "config_hint" },
          { label: t("flagDatabaseHint"), flag: "database_hint" },
          { label: t("flagLargeRead"), flag: "large_read" },
          { label: t("flagRedundantRead"), flag: "redundant_read" },
        ];
        const found = entries.find((x) => x.label === name);
        if (found) {
          setRiskOnly(true);
          setRiskFlagFilter(found.flag);
          if (found.flag.endsWith("_hint")) {
            setHintTypeFilterUrl(found.flag);
          } else {
            setHintTypeFilterUrl("");
          }
          setViewKind("details");
        }
      },
    }),
    [t, setHintTypeFilterUrl],
  );

  const toolsChartEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const name = String((params as { name?: unknown })?.name ?? "");
        if (name) {
          setSpanNameFilter(name);
          setViewKind("details");
        }
      },
    }),
    [],
  );

  const p95DurationMs = useMemo(() => {
    const rows = eventsQ.data?.items ?? [];
    const dur = rows
      .map((r) => r.duration_ms)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .sort((a, b) => a - b);
    if (dur.length === 0) return null;
    const idx = Math.max(0, Math.min(dur.length - 1, Math.floor(0.95 * (dur.length - 1))));
    return dur[idx] ?? null;
  }, [eventsQ.data?.items]);

  const filteredDetailItems = useMemo(() => {
    const rows = eventsQ.data?.items ?? [];
    return rows.filter((row) => {
      const flags = row.risk_flags ?? [];
      if (riskOnly && flags.length === 0) return false;
      if (riskFlagFilter && !flags.includes(riskFlagFilter)) return false;
      if (p95SlowOnly && p95DurationMs != null) {
        const d = row.duration_ms ?? 0;
        if (d < p95DurationMs) return false;
      }
      return true;
    });
  }, [eventsQ.data?.items, riskOnly, riskFlagFilter, p95SlowOnly, p95DurationMs]);

  const topDurationEventRows = useMemo(() => {
    const rows = (eventsQ.data?.items ?? [])
      .filter((r) => r.duration_ms != null && Number.isFinite(r.duration_ms))
      .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms))
      .slice(0, 10);
    return rows;
  }, [eventsQ.data?.items]);

  const summary = statsQ.data?.summary;
  const isEmptyRange = Boolean(statsQ.isSuccess && summary && summary.total_events === 0);

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
        —
      </Typography.Text>
    );

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {t("title")}
            </Typography.Title>
          </div>
          <Space wrap>
            <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangePersist} />
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

        <section aria-label={t("viewSwitcherAria")} className="space-y-3">
          <div role="radiogroup" aria-label={t("viewSwitcherAria")} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {([
              { id: "metrics" as const, label: t("viewMetrics"), Icon: IconApps },
              { id: "details" as const, label: t("viewDetails"), Icon: IconList },
            ] satisfies Array<{ id: ResourceAuditViewKind; label: string; Icon: typeof IconList }>).map((opt) => {
              const selected = viewKind === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setViewKind(opt.id)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
                    selected
                      ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                      : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100",
                  )}
                >
                  <opt.Icon
                    className={cn(
                      "size-4 shrink-0",
                      selected ? "text-neutral-800 dark:text-zinc-100" : "text-neutral-600 dark:text-zinc-400",
                    )}
                    strokeWidth={selected ? 3 : 2}
                    aria-hidden
                  />
                  <span className="whitespace-nowrap">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {viewKind === "metrics" ? (
          <>
            <section aria-label={t("sectionKpi")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionKpi")}
              </Typography.Title>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ResourceKpiCard
                  title={t("kpiTotalEventsMerged")}
                  hint={t("kpiTotalEventsMergedHint")}
                  value={
                    summary
                      ? `${summary.total_events.toLocaleString()} / ${summary.distinct_traces.toLocaleString()}`
                      : "—"
                  }
                  onView={() => {
                    setSortMode("time_desc");
                    setViewKind("details");
                  }}
                  momLabel={t("kpiMom")}
                  mom={
                    summary && prevStatsQ.data
                      ? prevStatsQ.data.summary.total_events > 0
                        ? ((summary.total_events - prevStatsQ.data.summary.total_events) / prevStatsQ.data.summary.total_events) * 100
                        : summary.total_events > 0
                          ? 100
                          : null
                      : null
                  }
                />
                <ResourceKpiCard
                  title={t("kpiSensitivePath")}
                  hint={t("kpiSensitivePathHint")}
                  value={
                    summary
                      ? `${summary.risk_sensitive_path.toLocaleString()} / ${summary.risk_any.toLocaleString()}`
                      : "—"
                  }
                  onView={() => {
                    setRiskOnly(true);
                    setRiskFlagFilter("sensitive_path");
                    setHintTypeFilterUrl("");
                    setSortMode("risk_first");
                    setViewKind("details");
                  }}
                  momLabel={t("kpiMom")}
                  mom={
                    summary && prevStatsQ.data
                      ? prevStatsQ.data.summary.risk_any > 0
                        ? ((summary.risk_any - prevStatsQ.data.summary.risk_any) /
                            prevStatsQ.data.summary.risk_any) *
                          100
                        : summary.risk_any > 0
                          ? 100
                          : null
                      : null
                  }
                />
                <ResourceKpiCard
                  title={t("kpiSensitiveInfo")}
                  hint={t("kpiSensitiveInfoHint")}
                  value={
                    summary
                      ? `${(
                          summary.risk_secret_hint +
                          summary.risk_pii_hint +
                          summary.risk_credential_hint
                        ).toLocaleString()} / ${summary.risk_any.toLocaleString()}`
                      : "—"
                  }
                  onView={() => {
                    setRiskOnly(true);
                    setRiskFlagFilter("");
                    setHintTypeFilterUrl("");
                    setSortMode("risk_first");
                    setViewKind("details");
                  }}
                  momLabel={t("kpiMom")}
                  mom={
                    summary && prevStatsQ.data
                      ? prevStatsQ.data.summary.risk_any > 0
                        ? ((summary.risk_any - prevStatsQ.data.summary.risk_any) /
                            prevStatsQ.data.summary.risk_any) *
                          100
                        : summary.risk_any > 0
                          ? 100
                          : null
                      : null
                  }
                />
                <ResourceKpiCard
                  title={t("kpiLargeRead")}
                  hint={t("kpiLargeReadHint")}
                  value={
                    summary
                      ? `${summary.risk_large_read.toLocaleString()} / ${summary.risk_any.toLocaleString()}`
                      : "—"
                  }
                  onView={() => {
                    setRiskOnly(true);
                    setRiskFlagFilter("large_read");
                    setHintTypeFilterUrl("");
                    setSortMode("risk_first");
                    setViewKind("details");
                  }}
                  momLabel={t("kpiMom")}
                  mom={
                    summary && prevStatsQ.data
                      ? prevStatsQ.data.summary.risk_any > 0
                        ? ((summary.risk_any - prevStatsQ.data.summary.risk_any) /
                            prevStatsQ.data.summary.risk_any) *
                          100
                        : summary.risk_any > 0
                          ? 100
                          : null
                      : null
                  }
                />
              </div>
            </section>

            {isEmptyRange ? (
              <Card className="border-dashed shadow-none" title={t("emptyStateTitle")}>
                <Typography.Paragraph type="secondary" className="!mb-3 text-sm">
                  {traceFromUrl ? t("emptyStateTraceBody") : t("emptyStateBody")}
                </Typography.Paragraph>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>{t("emptyChecklistPlugin")}</li>
                  <li>{t("emptyChecklistRange")}</li>
                  <li>{t("emptyChecklistFilters")}</li>
                  <li>{t("emptyChecklistDb")}</li>
                </ul>
              </Card>
            ) : null}

            {!isEmptyRange ? (
              <section aria-label={t("sectionDashboard")} className="space-y-3">
                <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                  {t("sectionDashboard")}
                </Typography.Title>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title={t("topResources")} bordered className="shadow-sm rounded-lg">
                    <ul className="space-y-1.5">
                      {(statsQ.data?.top_resources ?? []).length === 0 ? (
                        <li className="text-sm text-muted-foreground">—</li>
                      ) : (
                        statsQ.data!.top_resources.map((r, idx) => (
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
                        ))
                      )}
                    </ul>
                  </Card>
                  <Card title={t("topResourceDuration")} bordered className="shadow-sm rounded-lg">
                    <ul className="space-y-1.5">
                      {topDurationEventRows.length === 0 ? (
                        <li className="text-sm text-muted-foreground">—</li>
                      ) : (
                        topDurationEventRows.map((r, idx) => (
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
                        ))
                      )}
                    </ul>
                  </Card>
                  <Card title={t("classDist")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }}>
                    {classPieOpt ? (
                      <div className="h-[260px] w-full min-w-0">
                        <ReactEChart option={classPieOpt} onEvents={classChartEvents} />
                      </div>
                    ) : (
                      <Space direction="vertical" size={8} className="w-full py-4">
                        {(statsQ.data?.class_distribution ?? []).map((c) => (
                          <div key={c.semantic_class} className="flex items-center justify-between text-sm">
                            <span>{classLabel(t, c.semantic_class)}</span>
                            <Tag>{c.count}</Tag>
                          </div>
                        ))}
                      </Space>
                    )}
                  </Card>
                  <Card title={t("dailyTrend")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }}>
                    {statsQ.isFetching && !statsQ.data ? <Spin className="py-8" /> : dailyChart}
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title={t("chartRiskHits")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }}>
                    {riskBarOpt ? (
                      <div className="h-[200px] w-full min-w-0">
                        <ReactEChart option={riskBarOpt} onEvents={riskChartEvents} />
                      </div>
                    ) : (
                      <Typography.Text type="secondary" className="text-sm">
                        {t("emptyRiskChart")}
                      </Typography.Text>
                    )}
                  </Card>

                  <Card title={t("chartTopTools")} bordered className="shadow-sm rounded-lg" bodyStyle={{ paddingBottom: 8 }}>
                    {toolsBarOpt ? (
                      <div className="h-[240px] w-full min-w-0">
                        <ReactEChart option={toolsBarOpt} onEvents={toolsChartEvents} />
                      </div>
                    ) : (
                      <Typography.Text type="secondary" className="text-sm">
                        —
                      </Typography.Text>
                    )}
                  </Card>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {viewKind === "details" ? (
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
              <Select
                size="small"
                style={{ width: 170 }}
                value={sortMode}
                onChange={(v) => {
                  setSortMode((v as "time_desc" | "risk_first" | "chars_desc") ?? "time_desc");
                  setPage(1);
                }}
              >
                <Select.Option value="time_desc">{t("sortTimeDesc")}</Select.Option>
                <Select.Option value="risk_first">{t("sortRiskFirst")}</Select.Option>
                <Select.Option value="chars_desc">{t("sortCharsDesc")}</Select.Option>
              </Select>
              {spanNameFilter ? (
                <Button size="small" type="outline" onClick={() => setSpanNameFilter("")}>
                  {`Tool: ${spanNameFilter}`}
                </Button>
              ) : null}
            </Space>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="mini"
              type={riskOnly ? "primary" : "outline"}
              onClick={() => setRiskOnly((v) => !v)}
            >
              {t("chipRiskOnly")}
            </Button>
            {[
              "sensitive_path",
              "pii_hint",
              "secret_hint",
              "credential_hint",
              "config_hint",
              "database_hint",
              "large_read",
              "redundant_read",
            ].map((flag) => (
              <Button
                key={flag}
                size="mini"
                type={riskFlagFilter === flag ? "primary" : "outline"}
                onClick={() => setRiskFlagFilter((v) => (v === flag ? "" : flag))}
              >
                {flagLabel(t, flag)}
              </Button>
            ))}
            <Button
              size="mini"
              type={p95SlowOnly ? "primary" : "outline"}
              onClick={() => setP95SlowOnly((v) => !v)}
            >
              {t("chipP95Slow")}
            </Button>
          </div>

          {traceFromUrl || spanFromUrl || hintTypeFromUrl || policyIdFromUrl || uriPrefixFromUrl ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              {traceFromUrl ? (
                <Tag color="arcoblue" size="small">
                  {t("activeTraceFilter", { id: formatShortId(traceFromUrl) })}
                </Tag>
              ) : null}
              {spanFromUrl ? <Tag color="purple" size="small">{`span:${formatShortId(spanFromUrl)}`}</Tag> : null}
              {hintTypeFromUrl ? <Tag color="orangered" size="small">{`hint:${hintTypeFromUrl}`}</Tag> : null}
              {policyIdFromUrl ? <Tag color="magenta" size="small">{`policy:${formatShortId(policyIdFromUrl)}`}</Tag> : null}
              {uriPrefixFromUrl ? <Tag color="gold" size="small">{`uri:${maskUri(uriPrefixFromUrl)}`}</Tag> : null}
              {traceFromUrl ? (
                <LocalizedLink
                  href={`/traces?trace=${encodeURIComponent(traceFromUrl)}`}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("openTraceListForFilter")}
                </LocalizedLink>
              ) : null}
              <Button
                type="outline"
                size="mini"
                onClick={() => {
                  const p = new URLSearchParams(searchParams.toString());
                  p.delete("trace_id");
                  p.delete("span_id");
                  p.delete("hint_type");
                  p.delete("policy_id");
                  p.delete("uri_prefix");
                  const qs = p.toString();
                  router.replace(qs ? `${pathname}?${qs}` : pathname);
                }}
              >
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="mini"
                  type="outline"
                  disabled={selectedRowKeys.length === 0}
                  onClick={() => {
                    setReviewedSpanIds((prev) => {
                      const next = new Set(prev);
                      for (const id of selectedRowKeys) next.add(id);
                      return next;
                    });
                  }}
                >
                  {t("bulkMarkReviewed")}
                </Button>
                <Button
                  size="mini"
                  type="outline"
                  disabled={reviewedSpanIds.size === 0}
                  onClick={() => setReviewedSpanIds(new Set())}
                >
                  {t("bulkClearReviewed")}
                </Button>
                <Button
                  size="mini"
                  type="outline"
                  disabled={selectedRowKeys.length === 0}
                  onClick={() => {
                    const rows = (filteredDetailItems ?? []).filter((r) => selectedRowKeys.includes(r.span_id));
                    const csv = [
                      "trace_id,span_id,resource_uri,flags",
                      ...rows.map((r) =>
                        [r.trace_id, r.span_id, JSON.stringify(r.resource_uri), JSON.stringify((r.risk_flags ?? []).join("|"))].join(","),
                      ),
                    ].join("\n");
                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `resource-audit-selected-${Date.now()}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    Message.success(t("bulkExportSelected"));
                  }}
                >
                  {t("bulkExportSelected")}
                </Button>
                <Button
                  size="mini"
                  type="outline"
                  disabled={selectedRowKeys.length === 0}
                  onClick={() => {
                    const links = (filteredDetailItems ?? [])
                      .filter((r) => selectedRowKeys.includes(r.span_id))
                      .map((r) => `${window.location.origin}/zh-CN/traces?trace=${encodeURIComponent(r.trace_id)}`);
                    void navigator.clipboard.writeText(links.join("\n"));
                    Message.success(t("bulkCopyTraceLinks"));
                  }}
                >
                  {t("bulkCopyTraceLinks")}
                </Button>
                {selectedRowKeys.length > 0 ? (
                  <Typography.Text type="secondary" className="text-xs">
                    {`selected ${selectedRowKeys.length}`}
                  </Typography.Text>
                ) : null}
              </div>
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
                      data={filteredDetailItems ?? []}
                      rowKey="span_id"
                      rowSelection={{
                        type: "checkbox",
                        selectedRowKeys,
                        onChange: (keys) => setSelectedRowKeys(keys.map((k) => String(k))),
                      }}
                      rowClassName={(record) =>
                        reviewedSpanIds.has(String((record as ResourceAuditEventRow).span_id))
                          ? "bg-emerald-50/40 dark:bg-emerald-900/10"
                          : ""
                      }
                      pagination={false}
                      scroll={OBSERVE_TABLE_SCROLL_X}
                      hover={true}
                    />
                  </div>
                </ScrollableTableFrame>
              </div>
              <div className="flex flex-col items-center gap-2 pt-4 sm:flex-row sm:justify-between">
                <Typography.Text type="secondary" className="text-xs">
                  {t("showingOfTotal", {
                    from: String(filteredDetailItems.length ? (page - 1) * pageSize + 1 : 0),
                    to: String(filteredDetailItems.length ? (page - 1) * pageSize + filteredDetailItems.length : 0),
                    total: String(riskOnly || riskFlagFilter || p95SlowOnly ? filteredDetailItems.length : (eventsQ.data?.total ?? 0)),
                  })}
                </Typography.Text>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {t("paginationTotalPages", {
                      count: String(
                        Math.max(
                          1,
                          Math.ceil(
                            (riskOnly || riskFlagFilter || p95SlowOnly
                              ? filteredDetailItems.length
                              : (eventsQ.data?.total ?? 0)) / pageSize,
                          ) || 1,
                        ),
                      ),
                    })}
                  </span>
                  <Pagination
                    className="resource-audit-audit-log-pagination"
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={riskOnly || riskFlagFilter || p95SlowOnly ? filteredDetailItems.length : (eventsQ.data?.total ?? 0)}
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
            </>
          )}
          </section>
        ) : null}
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
        open={inspectTraceRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setInspectTraceRow(null);
            setInspectTraceInitialSpanId(null);
          }
        }}
        row={inspectTraceRow}
        initialSpanId={inspectTraceInitialSpanId}
        rows={inspectTraceRow ? [inspectTraceRow] : []}
        onNavigate={(nextRow) => setInspectTraceRow(nextRow)}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />
    </AppPageShell>
  );
}
