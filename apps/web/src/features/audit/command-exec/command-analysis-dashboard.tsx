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
  Typography,
} from "@arco-design/web-react";
import {
  IconApps,
  IconArrowFall,
  IconArrowRise,
  IconList,
  IconRefresh,
  IconShareExternal,
} from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TitleHintIcon } from "@/shared/components/message-hint";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/shared/components/localized-link";
import { TraceRecordInspectDialog } from "@/features/observe/traces/components/trace-record-inspect-dialog";
import { toast } from "@/components/ui/feedback";
import { TraceCopyIconButton } from "@/shared/components/trace-copy-icon-button";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { ReactEChart } from "@/shared/components/react-echart";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadObserveFacets } from "@/lib/observe-facets";
import {
  defaultCommandAnalysisDateRange,
  readCommandAnalysisDateRange,
  writeCommandAnalysisDateRange,
} from "@/lib/command-analysis-date-range";
import { resolveObserveSinceUntil, type ObserveDateRange } from "@/lib/observe-date-range";
import { OBSERVE_TABLE_FRAME_CLASSNAME, OBSERVE_TABLE_SCROLL_X } from "@/lib/observe-table-style";
import { resolveTraceRowForInspect } from "@/lib/observe-inspect-url";
import type { TraceRecordRow } from "@/lib/trace-records";
import { resourceRiskBarOption } from "@/lib/resource-audit-echarts-options";
import {
  loadShellExecList,
  loadShellExecSummary,
  type ShellExecListRow,
  type ShellExecSummary,
} from "@/lib/shell-exec-api";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";
import type { EChartsOption } from "echarts";

const kpiShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-200 ease-out hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] dark:border-border dark:bg-card dark:shadow-sm dark:hover:shadow-md";

const kpiMetricCardClass =
  "border-[#DCE3F8] bg-gradient-to-br from-[#F7F9FF] via-[#F9FBFF] to-[#EEF3FF]";

type CommandAnalysisViewKind = "metrics" | "details";

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

function shellKpiMomPercent(current: number, prev: number | undefined): number | null {
  if (prev === undefined) {
    return null;
  }
  if (prev > 0) {
    return ((current - prev) / prev) * 100;
  }
  if (current > 0) {
    return 100;
  }
  return null;
}

function CommandKpiCard({
  title,
  hint,
  value,
  onView,
  mom,
}: {
  title: string;
  hint?: string;
  value: ReactNode;
  onView: () => void;
  mom: number | null;
}) {
  const t = useTranslations("CommandAnalysis");
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
        <Typography.Text className="text-[11px] text-[#86909C] dark:text-muted-foreground">{t("kpiMom")}</Typography.Text>
        <KpiMomPill tone={momM.color} text={momM.text} />
      </div>
    </Card>
  );
}

function topRankColorClass(rank: number): string {
  if (rank <= 3) {
    return "text-[#F53F3F]";
  }
  return "text-[#FF7D00]";
}

function shellTrendOption(
  rows: {
    day: string;
    commands: number;
    failed: number;
    token_risk_count: number;
    diagnostic_count: number;
    network_system_count: number;
  }[],
  t: (k: string) => string,
): EChartsOption {
  const MUTED = "#64748b";
  return {
    grid: { left: 4, right: 12, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    legend: { top: 0, textStyle: { fontSize: 11, color: MUTED } },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((r) => r.day),
      axisLabel: { fontSize: 11, color: MUTED },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: MUTED },
      splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
    },
    series: [
      {
        name: t("chartTotalCmd"),
        type: "line",
        data: rows.map((r) => r.commands),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#6366f1" },
      },
      {
        name: t("chartFailedCount"),
        type: "line",
        data: rows.map((r) => r.failed),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#ef4444" },
      },
      {
        name: t("chartTokenRiskCount"),
        type: "line",
        data: rows.map((r) => r.token_risk_count),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#f59e0b" },
      },
      {
        name: t("chartDiagnosticsCount"),
        type: "line",
        data: rows.map((r) => r.diagnostic_count),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#22c55e" },
      },
      {
        name: t("chartNetSysCount"),
        type: "line",
        data: rows.map((r) => r.network_system_count),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#94a3b8" },
      },
    ],
  };
}

function metricBucketsBarOption(rows: { label: string; value: number }[], subtitle: string): EChartsOption {
  const MUTED = "#64748b";
  return {
    title: { text: subtitle, left: 0, top: 0, textStyle: { fontSize: 12, color: MUTED, fontWeight: 500 } },
    grid: { left: 4, right: 8, top: 32, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    xAxis: { type: "category", data: rows.map((r) => r.label), axisLabel: { fontSize: 10, color: MUTED } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 10, color: MUTED } },
    series: [{ type: "bar", data: rows.map((r) => r.value), itemStyle: { color: "#6366f1", borderRadius: [4, 4, 0, 0] } }],
  };
}

function tokenRiskHBarOption(items: { command: string; stdout_chars: number }[], subtitle: string): EChartsOption {
  const MUTED = "#64748b";
  const top = items.slice(0, 12);
  return {
    title: { text: subtitle, left: 0, top: 0, textStyle: { fontSize: 12, color: MUTED, fontWeight: 500 } },
    grid: { left: 4, right: 12, top: 32, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    xAxis: { type: "value", axisLabel: { fontSize: 10, color: MUTED } },
    yAxis: {
      type: "category",
      data: top.map((_, i) => `#${i + 1}`),
      inverse: true,
      axisLabel: { fontSize: 10, color: MUTED },
    },
    series: [
      {
        type: "bar",
        data: top.map((x) => x.stdout_chars),
        itemStyle: { color: "#f59e0b", borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
}

function redundantReadHBarOption(
  items: { trace_id: string; command: string; repeats: number }[],
  subtitle: string,
): EChartsOption {
  const MUTED = "#64748b";
  const top = items.slice(0, 12);
  return {
    title: { text: subtitle, left: 0, top: 0, textStyle: { fontSize: 12, color: MUTED, fontWeight: 500 } },
    grid: { left: 4, right: 12, top: 32, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      textStyle: { fontSize: 12 },
      formatter: (p: unknown) => {
        const arr = p as { data?: number; name?: string }[];
        const a = arr[0];
        if (!a?.name) {
          return "";
        }
        const idx = Math.max(0, Number.parseInt(a.name.replace("#", ""), 10) - 1);
        const row = top[idx];
        if (!row) {
          return "";
        }
        return `${row.command.slice(0, 120)}<br/>×${a.data ?? ""}`;
      },
    },
    xAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 10, color: MUTED } },
    yAxis: {
      type: "category",
      data: top.map((_, i) => `#${i + 1}`),
      inverse: true,
      axisLabel: { fontSize: 10, color: MUTED },
    },
    series: [
      {
        type: "bar",
        data: top.map((x) => x.repeats),
        itemStyle: { color: "#22c55e", borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
}

/** 步骤 ID：短 ID + 复制；点击短 ID 在当前页打开消息详情并定位到该 span，不整页跳转。 */
function ShellExecSpanIdCell({
  spanId,
  traceId,
  onOpenMessageInspect,
  canOpen,
}: {
  spanId: string;
  traceId: string;
  onOpenMessageInspect: (traceId: string, spanId: string) => void;
  canOpen: boolean;
}) {
  const t = useTranslations("CommandAnalysis");
  const tTr = useTranslations("Traces");
  const sid = spanId.trim();
  const tid = traceId.trim();
  if (!sid) {
    return <span className="text-neutral-400">—</span>;
  }
  const clickable = canOpen && Boolean(tid);
  const idEl = clickable ? (
    <button
      type="button"
      onClick={() => onOpenMessageInspect(tid, sid)}
      className="block min-w-0 truncate whitespace-nowrap text-left text-xs text-primary underline-offset-2 hover:underline"
      title={sid}
      aria-label={t("spanStepOpenMessageInspectAria")}
    >
      {formatShortId(sid)}
    </button>
  ) : (
    <span className="block min-w-0 truncate whitespace-nowrap text-xs text-neutral-700 dark:text-neutral-200" title={sid}>
      {formatShortId(sid)}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {idEl}
      <TraceCopyIconButton
        text={sid}
        ariaLabel={tTr("traceInspectCopySpanId")}
        tooltipLabel={tTr("copy")}
        successLabel={tTr("copySuccessToast")}
        className="p-1 hover:bg-neutral-100"
        stopPropagation
      />
    </div>
  );
}

export function CommandAnalysisDashboard() {
  const t = useTranslations("CommandAnalysis");
  const tTr = useTranslations("Traces");
  const searchParams = useSearchParams();
  const urlTraceId = searchParams.get("trace_id")?.trim() ?? "";

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [dateRange, setDateRange] = useState<ObserveDateRange>(defaultCommandAnalysisDateRange());
  const [channel, setChannel] = useState<string | undefined>();
  const [agent, setAgent] = useState<string | undefined>();
  const [commandContains, setCommandContains] = useState("");
  const [minDur, setMinDur] = useState("");
  const [maxDur, setMaxDur] = useState("");
  const [traceFilter, setTraceFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewKind, setViewKind] = useState<CommandAnalysisViewKind>("metrics");
  const [messageInspectTrace, setMessageInspectTrace] = useState<TraceRecordRow | null>(null);
  const [messageInspectInitialSpanId, setMessageInspectInitialSpanId] = useState<string | null>(null);

  const openMessageInspectFromShellRow = useCallback(
    async (traceId: string, spanId: string) => {
      const tid = traceId.trim();
      const sid = spanId.trim();
      if (!tid || !sid || !baseUrl.trim()) {
        return;
      }
      const resolved = await resolveTraceRowForInspect(baseUrl, apiKey, tid);
      if (!resolved) {
        toast.error(t("openMessageInspectFailed"));
        return;
      }
      setMessageInspectInitialSpanId(sid);
      setMessageInspectTrace(resolved);
    },
    [apiKey, baseUrl, t],
  );

  useEffect(() => {
    setMounted(true);
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setDateRange(readCommandAnalysisDateRange());
    setPageSize(readStoredPageSize(50));
  }, []);

  useEffect(() => {
    setTraceFilter(urlTraceId);
  }, [urlTraceId]);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, []);

  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange, Date.now()), [dateRange]);

  const shellQuery = useMemo(
    () => ({
      sinceMs,
      untilMs,
      traceId: traceFilter.trim() || undefined,
      channel,
      agent,
      commandContains: commandContains.trim() || undefined,
      minDurationMs: minDur.trim() ? Number(minDur) : undefined,
      maxDurationMs: maxDur.trim() ? Number(maxDur) : undefined,
    }),
    [sinceMs, untilMs, traceFilter, channel, agent, commandContains, minDur, maxDur],
  );

  const facetsQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceList, baseUrl, apiKey, "facets"],
    enabled: mounted && Boolean(baseUrl.trim()),
    queryFn: () => loadObserveFacets(baseUrl, apiKey),
  });

  const summaryQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.shellExecSummary, baseUrl, apiKey, shellQuery],
    enabled: mounted && Boolean(baseUrl.trim()),
    queryFn: () => loadShellExecSummary(baseUrl, apiKey, shellQuery),
  });

  const prevWindow = useMemo(() => {
    if (sinceMs == null || untilMs == null || untilMs <= sinceMs) {
      return null;
    }
    const width = untilMs - sinceMs;
    return { sinceMs: Math.max(0, sinceMs - width), untilMs: sinceMs };
  }, [sinceMs, untilMs]);

  const prevShellQuery = useMemo(() => {
    if (!prevWindow) {
      return null;
    }
    return {
      ...shellQuery,
      sinceMs: prevWindow.sinceMs,
      untilMs: prevWindow.untilMs,
    };
  }, [prevWindow, shellQuery]);

  const prevSummaryQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.shellExecSummary, baseUrl, apiKey, "prev", prevShellQuery],
    enabled: mounted && Boolean(baseUrl.trim()) && prevShellQuery != null,
    queryFn: () => loadShellExecSummary(baseUrl, apiKey, prevShellQuery!),
  });

  const listQuery = useQuery({
    queryKey: [
      COLLECTOR_QUERY_SCOPE.shellExecList,
      baseUrl,
      apiKey,
      shellQuery,
      page,
      pageSize,
    ],
    enabled: mounted && Boolean(baseUrl.trim()),
    queryFn: () =>
      loadShellExecList(baseUrl, apiKey, {
        ...shellQuery,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order: "desc",
      }),
  });

  const summary = summaryQuery.data;
  const durationBar = useMemo(() => {
    if (!summary) {
      return null;
    }
    return resourceRiskBarOption(
      [
        { name: t("durLt100"), value: summary.duration_buckets.lt100ms },
        { name: t("dur100to1s"), value: summary.duration_buckets.ms100to1s },
        { name: t("durGt1s"), value: summary.duration_buckets.gt1s },
      ],
      t("durSeries"),
    );
  }, [summary, t]);

  const trendOpt = useMemo(() => {
    if (!summary?.success_trend?.length) {
      return null;
    }
    const fallback = summary.success_trend.map((r) => ({
      day: r.day,
      commands: r.total,
      failed: r.failed,
      token_risk_count: 0,
      diagnostic_count: 0,
      network_system_count: 0,
    }));
    return shellTrendOption(summary.daily_risk_series?.length ? summary.daily_risk_series : fallback, t);
  }, [summary, t]);

  const loopBucketsOpt = useMemo(() => {
    const rows = summary?.loop_repeat_buckets;
    if (!rows?.length) {
      return null;
    }
    return metricBucketsBarOption(rows, t("chartLoopBuckets"));
  }, [summary?.loop_repeat_buckets, t]);

  const tokenRiskBucketsOpt = useMemo(() => {
    const rows = summary?.token_risk_stdout_buckets;
    if (!rows?.length) {
      return null;
    }
    return metricBucketsBarOption(rows, t("chartTokenRiskBuckets"));
  }, [summary?.token_risk_stdout_buckets, t]);

  const redundantTopOpt = useMemo(() => {
    const rows = summary?.redundant_read_top?.length ? summary.redundant_read_top : summary?.redundant_read_hints;
    if (!rows?.length) {
      return null;
    }
    return redundantReadHBarOption(rows, t("chartRedundantTop"));
  }, [summary?.redundant_read_hints, summary?.redundant_read_top, t]);

  const tokenRiskBarsOpt = useMemo(() => {
    const tr = summary?.token_risks;
    if (!tr?.length) {
      return null;
    }
    const sorted = [...tr].sort((a, b) => (b.stdout_chars ?? 0) - (a.stdout_chars ?? 0));
    return tokenRiskHBarOption(
      sorted.map((x) => ({ command: x.command, stdout_chars: x.stdout_chars })),
      t("chartTokenRiskBars"),
    );
  }, [summary?.token_risks, t]);

  const onDateChange = useCallback((next: ObserveDateRange) => {
    setDateRange(next);
    writeCommandAnalysisDateRange(next);
    setPage(1);
  }, []);

  const listColumns: TableColumnProps<ShellExecListRow>[] = useMemo(
    () => [
      {
        title: tTr("spansColSpanId"),
        width: 230,
        fixed: "left" as const,
        render: (_: unknown, row) => {
          const r = row as ShellExecListRow;
          return (
            <ShellExecSpanIdCell
              spanId={String(r.span_id ?? "")}
              traceId={String(r.trace_id ?? "")}
              onOpenMessageInspect={openMessageInspectFromShellRow}
              canOpen={mounted && Boolean(baseUrl.trim())}
            />
          );
        },
      },
      {
        title: t("colTime"),
        width: 168,
        render: (_: unknown, row) => {
          const ms = row.start_time_ms != null ? Number(row.start_time_ms) : null;
          return (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {ms != null && Number.isFinite(ms) ? formatTraceDateTimeFromMs(ms) : "—"}
            </span>
          );
        },
      },
      {
        title: t("colCommand"),
        render: (_: unknown, row) => {
          const cmd = row.parsed?.command ?? "";
          return (
            <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
              {cmd || "—"}
            </Typography.Text>
          );
        },
      },
      {
        title: t("colDur"),
        width: 88,
        render: (_: unknown, row) => {
          const d = row.duration_ms != null ? Number(row.duration_ms) : null;
          return (
            <span className="text-xs tabular-nums">
              {d != null && Number.isFinite(d) ? `${d} ms` : "—"}
            </span>
          );
        },
      },
      {
        title: t("colStatus"),
        width: 108,
        render: (_: unknown, row) => {
          const ok = row.parsed?.success;
          const ec = row.parsed?.exitCode;
          if (ok === true) {
            return <Tag color="green">{t("okYes")}</Tag>;
          }
          if (ok === false) {
            return (
              <span className="inline-flex flex-wrap items-center gap-1">
                <Tag color="red">{t("okNo")}</Tag>
                {ec != null ? <span className="font-mono text-[11px] text-muted-foreground">({ec})</span> : null}
              </span>
            );
          }
          if (ec != null) {
            return <span className="font-mono text-xs tabular-nums">{String(ec)}</span>;
          }
          return "—";
        },
      },
      {
        title: t("colCategory"),
        width: 100,
        render: (_: unknown, row) => {
          const raw = row.parsed?.category;
          const s = raw != null && String(raw).trim() !== "" ? String(raw) : "";
          return s ? <Tag size="small">{s}</Tag> : "—";
        },
      },
      {
        title: t("colRisk"),
        width: 88,
        render: (_: unknown, row) =>
          row.parsed?.tokenRisk ? <Tag color="orangered">{t("riskTag")}</Tag> : "—",
      },
    ],
    [t, tTr, openMessageInspectFromShellRow, mounted, baseUrl],
  );
  const s: ShellExecSummary | undefined = summaryQuery.data;
  const totalRows = listQuery.data?.total ?? 0;
  const snap = s?.db_snapshot;
  const narrowedTime =
    dateRange.kind === "custom" ||
    (dateRange.kind === "preset" && dateRange.preset !== "all");
  const hasListFacetFilter = Boolean(
    channel ||
      agent ||
      traceFilter.trim() ||
      commandContains.trim() ||
      minDur.trim() ||
      maxDur.trim(),
  );
  const showWidenHint =
    summaryQuery.isSuccess &&
    snap != null &&
    snap.shell_like_spans > 0 &&
    (s?.totals.commands ?? 0) === 0 &&
    (narrowedTime || hasListFacetFilter);
  const showRuleMismatchHint =
    summaryQuery.isSuccess && snap != null && snap.tool_spans > 0 && snap.shell_like_spans === 0;
  const showEmptyDbHint = summaryQuery.isSuccess && snap != null && snap.tool_spans === 0;
  const showExecBackfillHint =
    summaryQuery.isSuccess &&
    snap != null &&
    (snap.exec_command_rows ?? 0) === 0 &&
    snap.shell_like_spans > 0;

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
        <main className="ca-page relative z-[1] space-y-4 pb-10">
          <Typography.Title heading={4} className="ca-page-title !m-0">
            {t("title")}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{t("needCollector")}</Typography.Paragraph>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
          <div>
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {t("title")}
            </Typography.Title>
          </div>
          <Space>
            <ObserveDateRangeTrigger value={dateRange} onChange={onDateChange} />
            <Button
              type="outline"
              icon={<IconRefresh />}
              loading={summaryQuery.isFetching || listQuery.isFetching || prevSummaryQuery.isFetching}
              onClick={() => {
                void summaryQuery.refetch();
                void prevSummaryQuery.refetch();
                void listQuery.refetch();
                void facetsQuery.refetch();
              }}
            >
              {t("refresh")}
            </Button>
          </Space>
        </header>

        {summaryQuery.isError ? (
          <Typography.Text type="error">
            {t("loadError")}
            {summaryQuery.error instanceof Error && summaryQuery.error.message
              ? ` ${t("loadErrorDetail", { detail: summaryQuery.error.message })}`
              : null}
          </Typography.Text>
        ) : null}
        {showWidenHint ? (
          <Message
            type="warning"
            content={t("hintWidenRange", {
              shellTotal: snap!.shell_like_spans,
            })}
          />
        ) : null}
        {showRuleMismatchHint ? (
          <Message
            type="warning"
            content={t("hintRuleMismatch", {
              tools: snap!.tool_spans,
              names: snap!.top_tool_names.map((x) => `${x.name}×${x.count}`).join("，"),
            })}
          />
        ) : null}
        {showEmptyDbHint ? <Message type="info" content={t("hintEmptyDb")} /> : null}
        {showExecBackfillHint ? (
          <Message
            type="warning"
            content={t("hintExecBackfill", {
              shell: snap!.shell_like_spans,
              exec: snap!.exec_command_rows ?? 0,
            })}
          />
        ) : null}
        {summaryQuery.isSuccess &&
        (s?.totals.commands ?? 0) === 0 &&
        !showWidenHint &&
        !showRuleMismatchHint &&
        !showEmptyDbHint ? (
          <Message type="info" content={t("emptyHintNoData")} />
        ) : null}
        {s?.capped ? (
          <Message type="warning" content={t("summaryCapped", { n: s.scanned })} />
        ) : null}

        <section aria-label={t("viewSwitcherAria")} className="space-y-3">
          <div role="radiogroup" aria-label={t("viewSwitcherAria")} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {([
              { id: "metrics" as const, label: t("viewMetrics"), Icon: IconApps },
              { id: "details" as const, label: t("viewDetails"), Icon: IconList },
            ] satisfies Array<{ id: CommandAnalysisViewKind; label: string; Icon: typeof IconList }>).map((opt) => {
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
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CommandKpiCard
                title={t("kpiCommands")}
                hint={t("kpiCommandsHint")}
                value={
                  summaryQuery.isLoading && !s ? <Spin size={20} /> : (s?.totals.commands ?? 0).toLocaleString()
                }
                onView={() => setViewKind("details")}
                mom={
                  s && prevSummaryQuery.data
                    ? shellKpiMomPercent(s.totals.commands, prevSummaryQuery.data.totals.commands)
                    : null
                }
              />
              <CommandKpiCard
                title={t("kpiTraces")}
                hint={t("kpiTracesHint")}
                value={
                  summaryQuery.isLoading && !s ? (
                    <Spin size={20} />
                  ) : (
                    (s?.totals.distinct_traces ?? 0).toLocaleString()
                  )
                }
                onView={() => setViewKind("details")}
                mom={
                  s && prevSummaryQuery.data
                    ? shellKpiMomPercent(s.totals.distinct_traces, prevSummaryQuery.data.totals.distinct_traces)
                    : null
                }
              />
              <CommandKpiCard
                title={t("kpiExecFailed")}
                hint={t("kpiExecFailedHint")}
                value={
                  summaryQuery.isLoading && !s ? <Spin size={20} /> : (s?.totals.failed ?? 0).toLocaleString()
                }
                onView={() => setViewKind("details")}
                mom={
                  s && prevSummaryQuery.data
                    ? shellKpiMomPercent(s.totals.failed, prevSummaryQuery.data.totals.failed)
                    : null
                }
              />
              <CommandKpiCard
                title={t("kpiTokenRiskTotal")}
                hint={t("kpiTokenRiskTotalHint")}
                value={
                  summaryQuery.isLoading && !s ? (
                    <Spin size={20} />
                  ) : (
                    Number(s?.totals.token_risk_total ?? 0).toLocaleString()
                  )
                }
                onView={() => setViewKind("details")}
                mom={
                  s && prevSummaryQuery.data
                    ? shellKpiMomPercent(
                        Number(s?.totals.token_risk_total ?? 0),
                        Number(prevSummaryQuery.data.totals.token_risk_total ?? 0),
                      )
                    : null
                }
              />
            </section>

            <Card bordered={false} className={kpiShellClass} title={t("sectionTrend")}>
              <div className="h-[260px] w-full min-w-0">
                {trendOpt && summaryQuery.isSuccess ? (
                  <ReactEChart option={trendOpt} style={{ height: 240 }} />
                ) : (
                  <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                    {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                  </div>
                )}
              </div>
            </Card>

            <Card bordered={false} className={kpiShellClass} title={t("sectionDuration")}>
              <div className="h-[220px] w-full max-w-xl min-w-0">
                {durationBar && summaryQuery.isSuccess ? (
                  <ReactEChart option={durationBar} style={{ height: 200 }} />
                ) : (
                  <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                    {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                  </div>
                )}
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t("sectionTopCmd")} bordered className="shadow-sm rounded-lg">
                <ul className="space-y-1.5">
                  {s?.top_commands?.length ? (
                    s.top_commands.map((x, idx) => (
                      <li key={x.command} className="last:border-0">
                        <div className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded px-1 py-1 text-left">
                          <span className={cn("inline-flex w-6 shrink-0 items-center justify-center text-base font-semibold leading-none", topRankColorClass(idx + 1))}>
                            {idx + 1}
                          </span>
                          <Popover content={<div className="max-w-md break-all text-xs">{x.command || "—"}</div>}>
                            <Typography.Text ellipsis className="min-w-0 text-xs text-[#1D2129] dark:text-foreground">
                              {x.command}
                            </Typography.Text>
                          </Popover>
                          <span className="shrink-0 text-right text-sm tabular-nums text-[#86909C]">{Math.round(x.count).toLocaleString()}</span>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">{t("emptyTopCmd")}</li>
                  )}
                </ul>
              </Card>
              <Card title={t("sectionSlowest")} bordered className="shadow-sm rounded-lg">
                <ul className="space-y-1.5">
                  {s?.slowest?.length ? (
                    s.slowest.map((x, idx) => (
                      <li key={x.span_id} className="last:border-0">
                        <div className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 rounded px-1 py-1 text-left">
                          <span className={cn("inline-flex w-6 shrink-0 items-center justify-center text-base font-semibold leading-none", topRankColorClass(idx + 1))}>
                            {idx + 1}
                          </span>
                          <Popover content={<div className="max-w-md break-all text-xs">{x.command || "—"}</div>}>
                            <Typography.Text ellipsis className="min-w-0 text-xs text-[#1D2129] dark:text-foreground">
                              {x.command}
                            </Typography.Text>
                          </Popover>
                          <span className="shrink-0 text-right text-sm tabular-nums text-[#86909C]">{x.duration_ms} ms</span>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">{t("emptySlowest")}</li>
                  )}
                </ul>
              </Card>
            </div>

            <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
              {t("sectionBehavior")}
            </Typography.Title>
            <div className="grid gap-4 lg:grid-cols-1">
              <Card bordered={false} className={kpiShellClass} title={t("sectionLoops")}>
                {s?.loop_alerts?.length ? (
                  <ul className="space-y-2 text-sm">
                    {s.loop_alerts.slice(0, 8).map((lo) => (
                      <li key={`${lo.trace_id}-${lo.command}`} className="rounded-md bg-muted/40 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag color="red">{t("loopTag", { n: lo.repeat_count })}</Tag>
                          <LocalizedLink className="font-mono text-xs text-primary" href={`/command-analysis?trace_id=${encodeURIComponent(lo.trace_id)}`}>
                            {formatShortId(lo.trace_id)}
                          </LocalizedLink>
                          <Button
                            type="outline"
                            size="mini"
                            onClick={() => {
                              setTraceFilter(lo.trace_id);
                              setViewKind("details");
                              setPage(1);
                              void listQuery.refetch();
                            }}
                          >
                            {t("focusTraceDetails")}
                          </Button>
                        </div>
                        <Typography.Text className="mt-1 block text-xs" ellipsis={{ showTooltip: true }}>
                          {lo.command}
                        </Typography.Text>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noLoops")}</p>
                )}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-1">
              <Card bordered={false} className={kpiShellClass} title={t("sectionRedundant")}>
                {s?.redundant_read_hints?.length ? (
                  <ul className="space-y-2 text-sm">
                    {s.redundant_read_hints.map((r) => (
                      <li key={`${r.trace_id}-${r.command}`} className="flex flex-wrap items-center gap-2">
                        <LocalizedLink className="font-mono text-xs text-primary" href={`/command-analysis?trace_id=${encodeURIComponent(r.trace_id)}`}>
                          {formatShortId(r.trace_id)}
                        </LocalizedLink>
                        <span className="text-xs text-muted-foreground">×{r.repeats} {r.command.slice(0, 80)}</span>
                        <Button
                          type="outline"
                          size="mini"
                          onClick={() => {
                            setTraceFilter(r.trace_id);
                            setViewKind("details");
                            setPage(1);
                            void listQuery.refetch();
                          }}
                        >
                          {t("focusTraceDetails")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noRedundant")}</p>
                )}
              </Card>
            </div>

            <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
              {t("sectionEfficiency")}
            </Typography.Title>
            <Card bordered={false} className={kpiShellClass} title={t("sectionTokenRisk")}>
              {s?.token_risks?.length ? (
                <Table
                  size="small"
                  pagination={false}
                  rowKey="span_id"
                  columns={[
                    { title: t("colTrace"), render: (_, r) => formatShortId(r.trace_id) },
                    { title: t("colCommand"), render: (_, r) => <Typography.Text className="text-xs" ellipsis>{r.command}</Typography.Text> },
                    { title: t("colStdout"), dataIndex: "stdout_chars" },
                    { title: t("colEstTokens"), dataIndex: "est_tokens" },
                    { title: t("colEstUsd"), dataIndex: "est_usd" },
                  ]}
                  data={s.token_risks}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("noTokenRisk")}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{t("tokenNote")}</p>
            </Card>

            <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
              {t("sectionDiagnostics")}
            </Typography.Title>
            <div className="flex flex-wrap gap-2">
              <Tag color="red">{t("diagNotFound")}: {s?.diagnostics.command_not_found ?? 0}</Tag>
              <Tag color="orangered">{t("diagPerm")}: {s?.diagnostics.permission_denied ?? 0}</Tag>
              <Tag color="gold">{t("diagArg")}: {s?.diagnostics.illegal_arg_hint ?? 0}</Tag>
            </div>

            <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
              {t("sectionRiskCharts")}
            </Typography.Title>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card bordered={false} className={kpiShellClass} bodyStyle={{ padding: "12px" }}>
                <div className="h-[220px] w-full min-w-0">
                  {loopBucketsOpt && summaryQuery.isSuccess ? (
                    <ReactEChart option={loopBucketsOpt} style={{ height: 200 }} />
                  ) : (
                    <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
                      {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                    </div>
                  )}
                </div>
              </Card>
              <Card bordered={false} className={kpiShellClass} bodyStyle={{ padding: "12px" }}>
                <div className="h-[220px] w-full min-w-0">
                  {tokenRiskBucketsOpt && summaryQuery.isSuccess ? (
                    <ReactEChart option={tokenRiskBucketsOpt} style={{ height: 200 }} />
                  ) : (
                    <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
                      {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                    </div>
                  )}
                </div>
              </Card>
              <Card bordered={false} className={cn(kpiShellClass, "lg:col-span-2")} bodyStyle={{ padding: "12px" }}>
                <div className="h-[260px] w-full min-w-0">
                  {redundantTopOpt && summaryQuery.isSuccess ? (
                    <ReactEChart option={redundantTopOpt} style={{ height: 240 }} />
                  ) : (
                    <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">
                      {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                    </div>
                  )}
                </div>
              </Card>
              <Card bordered={false} className={cn(kpiShellClass, "lg:col-span-2")} bodyStyle={{ padding: "12px" }}>
                <div className="h-[260px] w-full min-w-0">
                  {tokenRiskBarsOpt && summaryQuery.isSuccess ? (
                    <ReactEChart option={tokenRiskBarsOpt} style={{ height: 240 }} />
                  ) : (
                    <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">
                      {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </>
        ) : null}

        {viewKind === "details" ? (
          <>
            <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
              {t("sectionList")}
            </Typography.Title>
            <Card bordered={false} className={kpiShellClass} bodyStyle={{ padding: "12px 16px" }}>
          <Space wrap className="w-full">
            <Select
              placeholder={t("filterChannel")}
              allowClear
              style={{ minWidth: 140 }}
              value={channel}
              onChange={(v) => {
                setChannel(v || undefined);
                setPage(1);
              }}
              options={(facetsQuery.data?.channels ?? []).map((c) => ({ label: c, value: c }))}
            />
            <Select
              placeholder={t("filterAgent")}
              allowClear
              style={{ minWidth: 140 }}
              value={agent}
              onChange={(v) => {
                setAgent(v || undefined);
                setPage(1);
              }}
              options={(facetsQuery.data?.agents ?? []).map((c) => ({ label: c, value: c }))}
            />
            <Input
              placeholder={t("phTraceId")}
              style={{ width: 220 }}
              value={traceFilter}
              onChange={(v) => setTraceFilter(v)}
              onPressEnter={() => {
                setPage(1);
                void listQuery.refetch();
              }}
            />
            <Input
              placeholder={t("phCommand")}
              style={{ width: 200 }}
              value={commandContains}
              onChange={setCommandContains}
              onPressEnter={() => {
                setPage(1);
                void listQuery.refetch();
              }}
            />
            <Input
              placeholder={t("phMinDur")}
              style={{ width: 100 }}
              value={minDur}
              onChange={setMinDur}
            />
            <Input
              placeholder={t("phMaxDur")}
              style={{ width: 100 }}
              value={maxDur}
              onChange={setMaxDur}
            />
            <Button
              type="primary"
              onClick={() => {
                setPage(1);
                void summaryQuery.refetch();
                void listQuery.refetch();
              }}
            >
              {t("applyFilter")}
            </Button>
          </Space>
            </Card>

            <Card bordered={false} className={kpiShellClass} bodyStyle={{ padding: 0 }}>
              <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
                <ScrollableTableFrame
                  variant="neutral"
                  contentKey={`${page}-${listQuery.data?.items.length ?? 0}`}
                  scrollClassName="overflow-x-visible touch-pan-x overscroll-x-contain"
                >
                  <div className="min-w-0 w-full">
                    <Table
                      tableLayoutFixed
                      size="small"
                      rowKey="span_id"
                      loading={listQuery.isLoading}
                      columns={listColumns}
                      data={listQuery.data?.items ?? []}
                      pagination={false}
                      border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
                      scroll={OBSERVE_TABLE_SCROLL_X}
                      hover={true}
                      className="[&_.arco-table-th]:bg-[#f7f9fc] dark:[&_.arco-table-th]:bg-muted/50"
                    />
                  </div>
                </ScrollableTableFrame>
              </div>
              <div className="flex flex-col items-center gap-2 px-3 pb-3 pt-4 sm:flex-row sm:justify-between">
                <Typography.Text type="secondary" className="text-xs">
                  {t("showingOfTotal", {
                    from: String(listQuery.data?.items.length ? (page - 1) * pageSize + 1 : 0),
                    to: String(
                      listQuery.data?.items.length
                        ? (page - 1) * pageSize + listQuery.data!.items.length
                        : 0,
                    ),
                    total: String(listQuery.data?.total ?? 0),
                  })}
                </Typography.Text>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {t("paginationTotalPages", {
                      count: String(Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / pageSize) || 1)),
                    })}
                  </span>
                  <Pagination
                    className="resource-audit-audit-log-pagination"
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={totalRows}
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
                    disabled={listQuery.isFetching}
                  />
                </div>
              </div>
            </Card>
          </>
        ) : null}
      </main>

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
