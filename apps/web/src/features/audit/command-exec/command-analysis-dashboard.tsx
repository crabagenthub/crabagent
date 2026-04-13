"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Drawer,
  Input,
  Message,
  Pagination,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import { IconRefresh } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/shared/components/localized-link";
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
import { resourceClassPieFromNamed, resourceRiskBarOption } from "@/lib/resource-audit-echarts-options";
import {
  loadShellExecDetail,
  loadShellExecList,
  loadShellExecSummary,
  type ShellCommandCategory,
  type ShellExecListRow,
  type ShellExecSummary,
} from "@/lib/shell-exec-api";
import { loadSemanticSpans, type SemanticSpanRow } from "@/lib/semantic-spans";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";
import type { EChartsOption } from "echarts";

const kpiShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border dark:bg-card dark:shadow-sm";

function shellTrendOption(
  rows: { day: string; total: number; failed: number }[],
  t: (k: string) => string,
): EChartsOption {
  const MUTED = "#64748b";
  return {
    grid: { left: 4, right: 48, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", textStyle: { fontSize: 12 } },
    legend: { top: 0, textStyle: { fontSize: 11, color: MUTED } },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: rows.map((r) => r.day),
      axisLabel: { fontSize: 11, color: MUTED },
    },
    yAxis: [
      {
        type: "value",
        axisLabel: { fontSize: 11, color: MUTED },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148, 163, 184, 0.35)" } },
      },
      {
        type: "value",
        position: "right",
        max: 100,
        axisLabel: { formatter: "{value}%", fontSize: 11, color: MUTED },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t("chartTotalCmd"),
        type: "line",
        yAxisIndex: 0,
        data: rows.map((r) => r.total),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#6366f1" },
      },
      {
        name: t("chartFailRate"),
        type: "line",
        yAxisIndex: 1,
        data: rows.map((r) => (r.total > 0 ? Math.round((100 * r.failed) / r.total) : 0)),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#ef4444" },
      },
    ],
  };
}

function categoryLabel(t: (k: string) => string, c: ShellCommandCategory): string {
  switch (c) {
    case "file":
      return t("catFile");
    case "network":
      return t("catNetwork");
    case "system":
      return t("catSystem");
    case "process":
      return t("catProcess");
    case "package":
      return t("catPackage");
    default:
      return t("catOther");
  }
}

export function CommandAnalysisDashboard() {
  const t = useTranslations("CommandAnalysis");
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
  const [drawerSpanId, setDrawerSpanId] = useState<string | null>(null);

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

  const detailQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.shellExecDetail, baseUrl, apiKey, drawerSpanId],
    enabled: mounted && Boolean(baseUrl.trim()) && Boolean(drawerSpanId),
    queryFn: () => loadShellExecDetail(baseUrl, apiKey, drawerSpanId!),
  });

  const contextTraceId =
    detailQuery.data && typeof detailQuery.data.trace_id === "string"
      ? detailQuery.data.trace_id.trim()
      : "";

  const spansContextQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, baseUrl, apiKey, contextTraceId, "ctx"],
    enabled: mounted && Boolean(baseUrl.trim()) && Boolean(contextTraceId) && Boolean(drawerSpanId),
    queryFn: () => loadSemanticSpans(baseUrl, apiKey, contextTraceId),
  });

  const summary = summaryQuery.data;
  const categoryPie = useMemo(() => {
    if (!summary) {
      return null;
    }
    const items = (Object.keys(summary.category_breakdown) as ShellCommandCategory[])
      .map((k) => ({
        name: categoryLabel(t, k),
        value: summary.category_breakdown[k] ?? 0,
      }))
      .filter((x) => x.value > 0);
    return resourceClassPieFromNamed(items);
  }, [summary, t]);

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
    return shellTrendOption(summary.success_trend, t);
  }, [summary, t]);

  const contextBlocks = useMemo(() => {
    const items = spansContextQuery.data?.items ?? [];
    const target = drawerSpanId;
    if (!target || items.length === 0) {
      return { before: null as SemanticSpanRow | null, after: null as SemanticSpanRow | null };
    }
    const idx = items.findIndex((s) => s.span_id === target);
    if (idx < 0) {
      return { before: null, after: null };
    }
    let before: SemanticSpanRow | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (items[i]!.type === "llm") {
        before = items[i]!;
        break;
      }
    }
    let after: SemanticSpanRow | null = null;
    for (let i = idx + 1; i < items.length; i++) {
      if (items[i]!.type === "llm") {
        after = items[i]!;
        break;
      }
    }
    return { before, after };
  }, [spansContextQuery.data, drawerSpanId]);

  const onDateChange = useCallback((next: ObserveDateRange) => {
    setDateRange(next);
    writeCommandAnalysisDateRange(next);
    setPage(1);
  }, []);

  const listColumns: TableColumnProps<ShellExecListRow>[] = useMemo(
    () => [
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
        title: t("colTrace"),
        width: 120,
        render: (_: unknown, row) => {
          const tid = String(row.trace_id ?? "");
          return (
            <LocalizedLink
              className="font-mono text-xs text-primary underline-offset-2 hover:underline"
              href={`/messages/${encodeURIComponent(tid)}`}
            >
              {formatShortId(tid)}
            </LocalizedLink>
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
        title: t("colCategory"),
        width: 100,
        render: (_: unknown, row) => {
          const c = row.parsed?.category;
          return c ? <Tag size="small">{categoryLabel(t, c)}</Tag> : "—";
        },
      },
      {
        title: t("colExit"),
        width: 72,
        render: (_: unknown, row) => {
          const ec = row.parsed?.exitCode;
          return <span className="font-mono text-xs">{ec != null ? String(ec) : "—"}</span>;
        },
      },
      {
        title: t("colOk"),
        width: 72,
        render: (_: unknown, row) => {
          const ok = row.parsed?.success;
          if (ok === true) {
            return <Tag color="green">{t("okYes")}</Tag>;
          }
          if (ok === false) {
            return <Tag color="red">{t("okNo")}</Tag>;
          }
          return "—";
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
        title: t("colStdout"),
        width: 88,
        render: (_: unknown, row) => {
          const n = row.parsed?.stdoutLen ?? 0;
          return <span className="text-xs tabular-nums">{n.toLocaleString()}</span>;
        },
      },
      {
        title: t("colRisk"),
        width: 88,
        render: (_: unknown, row) =>
          row.parsed?.tokenRisk ? <Tag color="orangered">{t("riskTag")}</Tag> : "—",
      },
      {
        title: t("colAction"),
        width: 96,
        render: (_: unknown, row) => {
          const sid = String(row.span_id ?? "");
          return (
            <Button type="text" size="mini" onClick={() => setDrawerSpanId(sid)}>
              {t("detailBtn")}
            </Button>
          );
        },
      },
    ],
    [t],
  );

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

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
          <div>
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {t("title")}
            </Typography.Title>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 max-w-3xl text-sm">
              {t("blurb")}
            </Typography.Paragraph>
          </div>
          <Space>
            <ObserveDateRangeTrigger value={dateRange} onChange={onDateChange} />
            <Button
              type="outline"
              icon={<IconRefresh />}
              loading={summaryQuery.isFetching || listQuery.isFetching}
              onClick={() => {
                void summaryQuery.refetch();
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
        {summaryQuery.isSuccess && snap?.db_basename ? (
          <Typography.Text type="secondary" className="block text-xs">
            {t("dbSourceLine", {
              file: snap.db_basename,
              tools: snap.tool_spans,
              shell: snap.shell_like_spans,
            })}
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

        {/* Executive summary KPIs */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: t("kpiCommands"), value: s?.totals.commands },
            { label: t("kpiTraces"), value: s?.totals.distinct_traces },
            { label: t("kpiSuccess"), value: s?.totals.success },
            { label: t("kpiFailed"), value: s?.totals.failed },
          ].map((k) => (
            <Card key={k.label} bordered={false} className={kpiShellClass} bodyStyle={{ padding: "14px 16px" }}>
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1D2129] dark:text-foreground">
                {summaryQuery.isLoading ? <Spin size={20} /> : (k.value ?? 0).toLocaleString()}
              </div>
            </Card>
          ))}
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card bordered={false} className={cn(kpiShellClass, "lg:col-span-1")} title={t("sectionCategory")}>
            <div className="h-[260px] w-full min-w-0">
              {categoryPie && summaryQuery.isSuccess ? (
                <ReactEChart option={categoryPie} style={{ height: 240 }} />
              ) : (
                <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                  {summaryQuery.isLoading ? <Spin /> : t("emptyChart")}
                </div>
              )}
            </div>
          </Card>
          <Card bordered={false} className={cn(kpiShellClass, "lg:col-span-2")} title={t("sectionTrend")}>
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
        </div>

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
          <Card bordered={false} className={kpiShellClass} title={t("sectionTopCmd")}>
            {s?.top_commands?.length ? (
              <ol className="list-decimal space-y-2 pl-4 text-sm">
                {s.top_commands.map((x) => (
                  <li key={x.command}>
                    <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
                      {x.command}
                    </Typography.Text>
                    <span className="ml-2 text-xs text-muted-foreground">×{x.count}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{t("emptyTopCmd")}</p>
            )}
          </Card>
          <Card bordered={false} className={kpiShellClass} title={t("sectionSlowest")}>
            {s?.slowest?.length ? (
              <ul className="space-y-2 text-sm">
                {s.slowest.map((x) => (
                  <li key={x.span_id} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-xs font-medium">{x.duration_ms} ms</span>
                    <Button type="text" size="mini" onClick={() => setDrawerSpanId(x.span_id)}>
                      {t("detailBtn")}
                    </Button>
                    <Typography.Text className="min-w-0 flex-1 text-xs" ellipsis={{ showTooltip: true }}>
                      {x.command}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("emptySlowest")}</p>
            )}
          </Card>
        </div>

        {/* Behavior */}
        <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
          {t("sectionBehavior")}
        </Typography.Title>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card bordered={false} className={kpiShellClass} title={t("sectionLoops")}>
            {s?.loop_alerts?.length ? (
              <ul className="space-y-2 text-sm">
                {s.loop_alerts.slice(0, 8).map((lo) => (
                  <li key={`${lo.trace_id}-${lo.command}`} className="rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag color="red">{t("loopTag", { n: lo.repeat_count })}</Tag>
                      <LocalizedLink
                        className="font-mono text-xs text-primary"
                        href={`/command-analysis?trace_id=${encodeURIComponent(lo.trace_id)}`}
                      >
                        {formatShortId(lo.trace_id)}
                      </LocalizedLink>
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
          <Card bordered={false} className={kpiShellClass} title={t("sectionChain")}>
            {s?.chain_preview?.steps?.length ? (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {s.chain_preview.steps.map((st, i) => (
                  <span key={`${st.kind}-${i}-${st.name}`} className="flex items-center gap-1">
                    {i > 0 ? <span className="text-muted-foreground">→</span> : null}
                    <Tag size="small" color={st.kind === "llm" ? "arcoblue" : "gray"}>
                      {st.kind}:{st.name.slice(0, 40)}
                    </Tag>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noChain")}</p>
            )}
            {s?.chain_preview?.trace_id ? (
              <LocalizedLink
                className="mt-2 inline-block text-xs text-primary"
                href={`/messages/${encodeURIComponent(s.chain_preview.trace_id)}`}
              >
                {t("openTrace")}
              </LocalizedLink>
            ) : null}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card bordered={false} className={kpiShellClass} title={t("sectionIdempotency")}>
            {s?.idempotency_samples?.length ? (
              <ul className="space-y-2 text-sm">
                {s.idempotency_samples.map((x) => (
                  <li key={x.command_key} className="border-b border-border/60 pb-2 last:border-0">
                    <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
                      {x.command_key}
                    </Typography.Text>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("idempoHint", { traces: x.traces, outcomes: x.outcomes })}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noIdempo")}</p>
            )}
          </Card>
          <Card bordered={false} className={kpiShellClass} title={t("sectionRedundant")}>
            {s?.redundant_read_hints?.length ? (
              <ul className="space-y-2 text-sm">
                {s.redundant_read_hints.map((r) => (
                  <li key={`${r.trace_id}-${r.command}`}>
                    <LocalizedLink
                      className="font-mono text-xs text-primary"
                      href={`/command-analysis?trace_id=${encodeURIComponent(r.trace_id)}`}
                    >
                      {formatShortId(r.trace_id)}
                    </LocalizedLink>
                    <span className="ml-2 text-xs text-muted-foreground">
                      ×{r.repeats} {r.command.slice(0, 80)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noRedundant")}</p>
            )}
          </Card>
        </div>

        {/* Efficiency */}
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
                {
                  title: t("colCommand"),
                  render: (_, r) => (
                    <Typography.Text className="text-xs" ellipsis>
                      {r.command}
                    </Typography.Text>
                  ),
                },
                { title: t("colStdout"), dataIndex: "stdout_chars" },
                { title: t("colEstTokens"), dataIndex: "est_tokens" },
                { title: t("colEstUsd"), dataIndex: "est_usd" },
                {
                  title: t("colAction"),
                  render: (_, r) => (
                    <Button type="text" size="mini" onClick={() => setDrawerSpanId(r.span_id)}>
                      {t("detailBtn")}
                    </Button>
                  ),
                },
              ]}
              data={s.token_risks}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noTokenRisk")}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("tokenNote")}</p>
        </Card>

        {/* Diagnostics */}
        <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
          {t("sectionDiagnostics")}
        </Typography.Title>
        <div className="flex flex-wrap gap-2">
          <Tag color="red">
            {t("diagNotFound")}: {s?.diagnostics.command_not_found ?? 0}
          </Tag>
          <Tag color="orangered">
            {t("diagPerm")}: {s?.diagnostics.permission_denied ?? 0}
          </Tag>
          <Tag color="gold">
            {t("diagArg")}: {s?.diagnostics.illegal_arg_hint ?? 0}
          </Tag>
        </div>

        {/* Filters + list */}
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
          <Table
            size="small"
            rowKey="span_id"
            loading={listQuery.isLoading}
            columns={listColumns}
            data={listQuery.data?.items ?? []}
            pagination={false}
            border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
            className="[&_.arco-table-th]:bg-[#f7f9fc] dark:[&_.arco-table-th]:bg-muted/50"
          />
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 px-3 py-3">
            <Pagination
              size="small"
              total={totalRows}
              current={page}
              pageSize={pageSize}
              showTotal={(tot) => t("paginationTotal", { total: tot })}
              pageSizeChangeResetCurrent={false}
              sizeOptions={[...PAGE_SIZE_OPTIONS]}
              onChange={(p, ps) => {
                setPage(p);
                if (ps !== pageSize) {
                  setPageSize(ps);
                  writeStoredPageSize(ps);
                }
              }}
            />
          </div>
        </Card>

        <Drawer
          width={520}
          title={t("drawerTitle")}
          visible={drawerSpanId != null}
          onCancel={() => setDrawerSpanId(null)}
          footer={null}
        >
          {detailQuery.isLoading ? (
            <Spin className="block py-10" />
          ) : detailQuery.isError ? (
            <Typography.Text type="error">{t("detailError")}</Typography.Text>
          ) : (
            <div className="space-y-4 text-sm">
              {(() => {
                const d = detailQuery.data;
                const p = d?.parsed as Record<string, unknown> | undefined;
                if (!d) {
                  return null;
                }
                return (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("lblCommand")}</div>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-xs">
                        {String(p?.command ?? "")}
                      </pre>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">{t("lblExit")}</span>{" "}
                        {p?.exitCode != null ? String(p.exitCode) : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("lblCwd")}</span>{" "}
                        {p?.cwd != null ? String(p.cwd) : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("lblUser")}</span>{" "}
                        {p?.userId != null ? String(p.userId) : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("lblHost")}</span>{" "}
                        {p?.host != null ? String(p.host) : "—"}
                      </div>
                    </div>
                    {Array.isArray(p?.envKeys) && (p.envKeys as string[]).length > 0 ? (
                      <div>
                        <div className="text-xs text-muted-foreground">{t("lblEnvKeys")}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(p.envKeys as string[]).slice(0, 24).map((k) => (
                            <Tag key={k} size="small">
                              {k}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs text-muted-foreground">{t("lblStdout")}</div>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-xs">
                        {p?.stdoutPreview != null ? String(p.stdoutPreview) : "—"}
                      </pre>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("lblStderr")}</div>
                      <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-xs">
                        {p?.stderrPreview != null ? String(p.stderrPreview) : "—"}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold">{t("lblContext")}</div>
                      {spansContextQuery.isLoading ? (
                        <Spin />
                      ) : (
                        <div className="space-y-2 rounded-md border border-border/60 p-2">
                          <div>
                            <div className="text-xs text-muted-foreground">{t("lblPromptBefore")}</div>
                            <pre className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">
                              {contextBlocks.before
                                ? JSON.stringify(contextBlocks.before.input ?? {}, null, 2).slice(0, 4000)
                                : t("noContext")}
                            </pre>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">{t("lblModelAfter")}</div>
                            <pre className="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">
                              {contextBlocks.after
                                ? JSON.stringify(contextBlocks.after.output ?? {}, null, 2).slice(0, 4000)
                                : t("noContext")}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </Drawer>
      </main>
    </AppPageShell>
  );
}
