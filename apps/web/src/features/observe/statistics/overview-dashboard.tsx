"use client";

import "@/lib/arco-react19-setup";
import { Card, Radio, Select, Skeleton, Space, Spin, Typography } from "@arco-design/web-react";
import {
  IconArrowFall,
  IconArrowRise,
  IconRefresh,
  IconShareExternal,
} from "@arco-design/web-react/icon";
import { Button } from "@/shared/ui/button";
import {
  OBSERVE_CONTROL_OUTLINE_CLASSNAME,
  OBSERVE_TOOLBAR_HOVER_FG_ICO,
} from "@/lib/observe-table-style";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ReactEChart } from "@/shared/components/react-echart";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint, TitleHintIcon } from "@/shared/components/message-hint";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import {
  defaultObserveDateRange,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  writeStoredObserveDateRange,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import {
  areaPercentOption,
  areaSingleOption,
  lineSingleOption,
  OV_CHART_PRIMARY as CHART_PRIMARY,
  OV_CHART_SECONDARY as CHART_SECONDARY,
  pieNamedPctOption,
  pieSimpleOption,
  tokenSplitOption,
} from "@/lib/overview-echarts-options";
import {
  buildOverview,
  collectModelOptions,
  filterByModel,
  loadPagedSpans,
  loadPagedTraces,
  traceCountByDayForModelQps,
} from "@/lib/overview-metrics";
import { loadSpanRecords } from "@/lib/span-records";
import { loadTraceRecords } from "@/lib/trace-records";
import { cn } from "@/lib/utils";
import { ActivityTimeline } from "@/components/activity-timeline";
import { LocalizedLink } from "@/shared/components/localized-link";
import { buildTracesListDeepLink } from "@/lib/observe-list-deep-link";
import { loadActivityTimelineData } from "@/lib/activity-timeline-data";
import { BarChart3, LineChart } from "lucide-react";

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

type MomTagTone = "green" | "red" | "gray";

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

/** 与 Arco 统计卡片一致的环比标签色（图 1） */
function KpiMomPill({ tone, text }: { tone: MomTagTone; text: string }) {
  const palette =
    tone === "green"
      ? "bg-[#E8FFEA] text-[#00B42A]"
      : tone === "red"
        ? "bg-[#FFECE8] text-[#F53F3F]"
        : "bg-[#F2F3F5] text-[#86909C]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium tabular-nums",
        palette,
      )}
    >
      {tone === "green" ? <IconArrowRise className="size-3 shrink-0" aria-hidden /> : null}
      {tone === "red" ? <IconArrowFall className="size-3 shrink-0" aria-hidden /> : null}
      {text}
    </span>
  );
}

const kpiCardShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-200 ease-out hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] dark:border-border dark:bg-card dark:shadow-sm dark:hover:shadow-md";

const kpiMetricGradientClass =
  "border-[#DCE3F8] bg-gradient-to-br from-[#F7F9FF] via-[#F9FBFF] to-[#EEF3FF]";

/** 消息列表页默认入口（其它 KPI 仍指向列表，由用户在目标页选时间） */
const OVERVIEW_KPI_TRACES_HREF = "/traces";

type KpiCardProps = {
  title: string;
  hint?: string;
  value: string;
  suffix?: string;
  mom?: number | null;
  momLabel: string;
  /** 可跳转时：悬停显示「查看」；仅「查看」在新标签页打开 */
  tracesHref?: string;
  hrefAriaLabel?: string;
};

function KpiCard({ title, hint, value, suffix, mom, momLabel, tracesHref, hrefAriaLabel }: KpiCardProps) {
  const tOv = useTranslations("Overview");
  const momM = momTagMeta(mom ?? null);

  const card = (
    <Card
      bordered={false}
      className={cn(kpiCardShellClass, kpiMetricGradientClass, tracesHref ? "group" : null)}
      bodyStyle={{ padding: "16px" }}
    >
      <div className="mb-3 flex flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Typography.Text className="text-[13px] font-medium text-[#86909C] dark:text-muted-foreground">
            {title}
          </Typography.Text>
          {hint ? (
            <TitleHintIcon
              tooltipText={hint}
              iconClassName="h-3.5 w-3.5 text-[#86909C] dark:text-muted-foreground"
              className="shrink-0"
            />
          ) : null}
        </div>
        {tracesHref ? (
          <LocalizedLink
            href={tracesHref}
            prefetch={false}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={hrefAriaLabel ?? tOv("kpiViewTracesAria")}
            className={cn(
              "relative z-[1] inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium",
              "text-primary opacity-0 transition-opacity duration-150",
              "group-hover:opacity-100 focus-visible:opacity-100",
              "hover:underline",
            )}
          >
            <IconShareExternal className="size-3.5 shrink-0" aria-hidden />
            {tOv("kpiViewTraces")}
          </LocalizedLink>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
        <span className="text-[22px] font-semibold leading-tight tracking-tight text-[#1D2129] tabular-nums dark:text-foreground">
          {value}
        </span>
        {suffix ? (
          <span className="text-[22px] font-semibold leading-tight text-[#1D2129] dark:text-foreground">{suffix}</span>
        ) : null}
      </div>
      <div className="mt-4 flex flex-row items-center justify-between gap-2">
        <Typography.Text className="text-[11px] text-[#86909C] dark:text-muted-foreground">{momLabel}</Typography.Text>
        {mom === null ? <KpiMomPill tone="gray" text="—" /> : <KpiMomPill tone={momM.color} text={momM.text} />}
      </div>
    </Card>
  );
  return card;
}

type ChartCardProps = {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  rightSlot?: React.ReactNode;
};

export function ChartCard({ title, hint, children, className, rightSlot }: ChartCardProps) {
  const showHeader = Boolean(title) || Boolean(hint) || Boolean(rightSlot);
  return (
    <Card
      bordered={false}
      className={cn(kpiCardShellClass, className)}
      bodyStyle={{ padding: showHeader ? "10px 12px 12px" : "12px" }}
    >
      {showHeader ? (
        <div className="mb-2 flex flex-row items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-1">
            {title ? (
              <Typography.Text bold className="truncate text-sm text-[#4E5969] dark:text-foreground/90">
                {title}
              </Typography.Text>
            ) : null}
            {hint ? (
              <TitleHintIcon tooltipText={hint} iconClassName="h-3.5 w-3.5 text-[#86909C]" className="shrink-0" />
            ) : null}
          </div>
          {rightSlot}
        </div>
      ) : null}
      <div className="px-0.5">{children}</div>
    </Card>
  );
}

export function OverviewDashboard() {
  const t = useTranslations("Overview");
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());
  const [model, setModel] = useState<string>("__all__");
  const [tokenUnit, setTokenUnit] = useState<"k" | "wan">("wan");
  const [tokenChartKind, setTokenChartKind] = useState<"line" | "bar">("line");
  const [modelQpsRateKind, setModelQpsRateKind] = useState<"qps" | "qpm">("qps");
  const [modelQpsStatusFilter, setModelQpsStatusFilter] = useState<"all" | "success" | "fail">("all");

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
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      void queryClient.invalidateQueries({ queryKey: ["overview-stats"] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange), [dateRange]);

  const kpiMessagesListHref = useMemo(() => {
    const windowAll = dateRange.kind === "preset" && dateRange.preset === "all";
    return buildTracesListDeepLink({ kind: "traces", sinceMs, untilMs, windowAll });
  }, [dateRange, sinceMs, untilMs]);

  const kpiSpansErrListHref = useMemo(() => {
    const windowAll = dateRange.kind === "preset" && dateRange.preset === "all";
    return buildTracesListDeepLink({
      kind: "spans",
      sinceMs,
      untilMs,
      windowAll,
      statuses: ["error", "timeout"],
      spanType: "",
    });
  }, [dateRange, sinceMs, untilMs]);

  const kpiModelErrSpansHref = useMemo(() => {
    const windowAll = dateRange.kind === "preset" && dateRange.preset === "all";
    return buildTracesListDeepLink({
      kind: "spans",
      sinceMs,
      untilMs,
      windowAll,
      statuses: ["error", "timeout"],
      spanType: "llm",
    });
  }, [dateRange, sinceMs, untilMs]);

  /** 统计时间窗 + LLM 步骤、无状态筛选（与模型耗时 / Tokens 等指标口径一致） */
  const kpiSpansStatsLlmOnlyHref = useMemo(() => {
    const windowAll = dateRange.kind === "preset" && dateRange.preset === "all";
    return buildTracesListDeepLink({
      kind: "spans",
      sinceMs,
      untilMs,
      windowAll,
      spanType: "llm",
      clearStatusParam: true,
    });
  }, [dateRange, sinceMs, untilMs]);

  /** 统计时间窗 + tool 步骤、无状态筛选（与工具调用次数 / 工具耗时均值口径一致） */
  const kpiSpansStatsToolOnlyHref = useMemo(() => {
    const windowAll = dateRange.kind === "preset" && dateRange.preset === "all";
    return buildTracesListDeepLink({
      kind: "spans",
      sinceMs,
      untilMs,
      windowAll,
      spanType: "tool",
      clearStatusParam: true,
    });
  }, [dateRange, sinceMs, untilMs]);

  /** 统计时间窗 + tool 步骤 + error/timeout（与工具调用错误率口径一致） */
  const kpiToolErrSpansHref = useMemo(() => {
    const windowAll = dateRange.kind === "preset" && dateRange.preset === "all";
    return buildTracesListDeepLink({
      kind: "spans",
      sinceMs,
      untilMs,
      windowAll,
      statuses: ["error", "timeout"],
      spanType: "tool",
    });
  }, [dateRange, sinceMs, untilMs]);

  const setDateRangePersist = useCallback((next: ObserveDateRange) => {
    setDateRange(next);
    writeStoredObserveDateRange(next);
  }, []);

  const enabled = mounted && baseUrl.trim().length > 0;

  const q = useQuery({
    queryKey: ["overview-stats", baseUrl, apiKey, sinceMs ?? 0, untilMs ?? 0],
    queryFn: async () => {
      const until = untilMs ?? Date.now();
      const since = sinceMs;
      const hasComparableWindow = since != null && since > 0 && until > since;
      const prevSince = hasComparableWindow ? Math.max(0, since - (until - since)) : undefined;
      const prevUntil = hasComparableWindow ? since : undefined;

      const [curT, curS, prevMeta] = await Promise.all([
        loadPagedTraces(baseUrl, apiKey, loadTraceRecords, since ?? 0, until),
        loadPagedSpans(baseUrl, apiKey, loadSpanRecords, since ?? 0, until),
        prevSince != null && prevUntil != null
          ? Promise.all([
              loadTraceRecords(baseUrl, apiKey, {
                limit: 1,
                offset: 0,
                sinceMs: prevSince,
                untilMs: prevUntil,
              }),
              loadPagedTraces(baseUrl, apiKey, loadTraceRecords, prevSince, prevUntil, 2500),
            ]).then(([meta, full]) => ({
              traceTotal: meta.total,
              tokenSum: full.items.reduce((a, x) => a + (x.total_tokens || 0), 0),
              toolCalls: full.items.reduce((a, x) => a + (x.tool_call_count || 0), 0),
            }))
          : Promise.resolve(null),
      ]);

      return {
        traces: curT.items,
        spans: curS.items,
        traceTotal: curT.total,
        spanTotal: curS.total,
        prevTraceTotal: prevMeta?.traceTotal,
        prevTokenSum: prevMeta?.tokenSum,
        prevToolCallsSum: prevMeta?.toolCalls,
      };
    },
    enabled,
    staleTime: 30_000,
  });

  // 活动时间线数据查询
  const activityQuery = useQuery({
    queryKey: ["activity-timeline", baseUrl, apiKey, sinceMs ?? 0, untilMs ?? 0],
    queryFn: async () => {
      return await loadActivityTimelineData(baseUrl, apiKey, sinceMs ?? 0, untilMs ?? 0);
    },
    enabled,
    staleTime: 30_000,
  });

  const modelOptions = useMemo(() => collectModelOptions(q.data?.spans ?? []), [q.data?.spans]);

  const overview = useMemo(() => {
    if (!q.data) {
      return null;
    }
    const { traces, spans, traceTotal, prevTraceTotal, prevTokenSum, prevToolCallsSum } = q.data;
    const filtered = filterByModel(traces, spans, model === "__all__" ? null : model);
    const usageOverride = model === "__all__" ? undefined : filtered.traces.length;
    const mom =
      model !== "__all__"
        ? { pt: undefined, ptk: undefined, ptc: undefined }
        : { pt: prevTraceTotal, ptk: prevTokenSum, ptc: prevToolCallsSum };
    return buildOverview(
      filtered.traces,
      filtered.spans,
      traceTotal,
      mom.pt,
      mom.ptk,
      mom.ptc,
      usageOverride,
    );
  }, [q.data, model]);

  const filteredTracesForModelQps = useMemo(() => {
    if (!q.data) {
      return [];
    }
    return filterByModel(q.data.traces, q.data.spans, model === "__all__" ? null : model).traces;
  }, [q.data, model]);

  const modelQpsCountByDay = useMemo(
    () => traceCountByDayForModelQps(filteredTracesForModelQps, modelQpsStatusFilter),
    [filteredTracesForModelQps, modelQpsStatusFilter],
  );

  const modelQpsRows = useMemo(() => {
    const div = modelQpsRateKind === "qps" ? 86_400 : 1440;
    return modelQpsCountByDay.map((d) => ({ day: d.day, v: d.n / div }));
  }, [modelQpsCountByDay, modelQpsRateKind]);

  const tokenSeries = useMemo(() => {
    if (!overview?.charts.tokensByDay) {
      return [];
    }
    const mult = tokenUnit === "wan" ? 1 : 10;
    return overview.charts.tokensByDay.map((row) => ({
      day: row.day,
      input: Math.round(row.inputWan * mult * 100) / 100,
      output: Math.round(row.outputWan * mult * 100) / 100,
    }));
  }, [overview?.charts.tokensByDay, tokenUnit]);

  const tokenScaleHint =
    tokenUnit === "wan" ? t("tokenAxisWan") : t("tokenAxisK");

  const tokenSummary = useMemo(() => {
    if (!overview) {
      return null;
    }
    const { totalTokens } = overview.kpis;
    if (tokenUnit === "k") {
      const k = totalTokens / 1000;
      return {
        total: k.toFixed(2),
        input: (k * 0.58).toFixed(2),
        output: (k * 0.42).toFixed(2),
        unitLabel: t("unitKTokensAbs"),
      };
    }
    const w = totalTokens / 10_000;
    return {
      total: w.toFixed(2),
      input: (w * 0.58).toFixed(2),
      output: (w * 0.42).toFixed(2),
      unitLabel: t("unitWanTokens"),
    };
  }, [overview, tokenUnit, t]);

  const echartsOpts = useMemo(() => {
    if (!overview) {
      return null;
    }
    const c = overview.charts;
    return {
      token: tokenSplitOption(
        tokenSeries,
        tokenScaleHint,
        t("legendInput"),
        t("legendOutput"),
        t("legendTokenTotal"),
        tokenChartKind,
      ),
      modelQps: areaSingleOption(
        modelQpsRows,
        t("chartModelQps"),
        (v) => `${v.toFixed(4)}${modelQpsRateKind === "qps" ? "/s" : "/min"}`,
        modelQpsRateKind === "qps" ? "/s" : "/min",
      ),
      modelSuccess: areaPercentOption(c.modelSuccessByDay, t("rate")),
      modelTokenRate: lineSingleOption(
        c.modelTokenRateByDay.map((d) => ({ day: d.day, v: d.tps })),
        false,
      ),
      modelDur: areaSingleOption(
        c.modelDurationSumByDay.map((d) => ({ day: d.day, v: d.ms / 1000 })),
        t("duration"),
        (v) => `${v.toFixed(1)} s`,
      ),
      ttft: lineSingleOption(
        c.ttftByDay.map((d) => ({ day: d.day, v: d.ms })),
        false,
        CHART_PRIMARY,
        (v) => `${v.toFixed(0)} ms`,
      ),
      tpot: areaSingleOption(
        c.tpotByDay.map((d) => ({ day: d.day, v: d.ms })),
        "TPOT",
        (v) => `${v.toFixed(2)} ms`,
      ),
      modelPie: pieNamedPctOption(c.modelDistribution, t("calls")),
      toolVol: lineSingleOption(c.toolVolumeByDay.map((d) => ({ day: d.day, v: d.n })), true),
      toolLat: areaSingleOption(
        c.toolLatencyByDay.map((d) => ({ day: d.day, v: d.avgMs / 1000 })),
        t("avg"),
        (v) => `${v.toFixed(2)} s`,
      ),
      toolOk: areaPercentOption(c.toolSuccessByDay, t("rate")),
      toolPie: pieSimpleOption(c.toolDistribution.slice(0, 6)),
      agentSteps: lineSingleOption(c.agentStepsByDay.map((d) => ({ day: d.day, v: d.avg })), true),
      agentTools: lineSingleOption(c.agentToolsByDay.map((d) => ({ day: d.day, v: d.avg })), true),
      agentModels: lineSingleOption(c.agentModelsByDay.map((d) => ({ day: d.day, v: d.avg })), true),
      traceReport: areaSingleOption(c.traceReportByDay.map((d) => ({ day: d.day, v: d.n })), "n"),
      uniqueThreads: lineSingleOption(
        c.uniqueThreadsByDay.map((d) => ({ day: d.day, v: d.n })),
        true,
        CHART_PRIMARY,
        undefined,
        true,
      ),
      messages: lineSingleOption(
        c.traceCountByDay.map((d) => ({ day: d.day, v: d.n })),
        true,
        CHART_SECONDARY,
      ),
      serviceQps: areaSingleOption(c.serviceQpsByDay.map((d) => ({ day: d.day, v: d.qps })), "QPS"),
      serviceLat: areaSingleOption(
        c.serviceLatencyByDay.map((d) => ({ day: d.day, v: d.avgMs / 1000 })),
        t("avg"),
        (v) => `${v.toFixed(1)} s`,
      ),
      serviceOk: areaPercentOption(c.serviceSuccessByDay, t("rate")),
    };
  }, [overview, tokenSeries, tokenScaleHint, tokenChartKind, modelQpsRows, modelQpsRateKind, t]);

  if (!mounted) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1] space-y-4">
          <Skeleton animation text={{ rows: 1, width: ["40%"] }} />
          <Skeleton animation className="h-40 max-w-full rounded-lg" />
        </main>
      </AppPageShell>
    );
  }

  if (!baseUrl.trim()) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1]">
          <header className="mb-6">
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {t("statsTitle")}
            </Typography.Title>
          </header>
          <Typography.Text type="secondary">{t("needCollector")}</Typography.Text>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="overview">
  <main className="ca-page relative z-[1] space-y-8 pb-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <Typography.Title heading={4} className="ca-page-title !m-0">
              {t("statsTitle")}
            </Typography.Title>
          </div>
          <Space size={12} wrap className="items-center">
            <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangePersist} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={q.isFetching}
              onClick={() => void q.refetch()}
              className={cn(
                "group/ico h-9 gap-2 rounded-md bg-white px-3 font-medium text-neutral-700 shadow-sm transition-all active:scale-[0.98] dark:bg-zinc-950/50 dark:text-zinc-300",
                OBSERVE_CONTROL_OUTLINE_CLASSNAME
              )}
            >
              <IconRefresh
                className={cn(
                  "size-4 shrink-0 text-neutral-500 transition-colors duration-150 dark:text-zinc-400",
                  OBSERVE_TOOLBAR_HOVER_FG_ICO,
                  q.isFetching && "animate-spin"
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "text-neutral-700 transition-colors duration-150 dark:text-zinc-300",
                  OBSERVE_TOOLBAR_HOVER_FG_ICO
                )}
              >
                {t("refresh")}
              </span>
            </Button>
          </Space>
        </header>

        {q.isError ? (
          <MessageHint text={String(q.error)} clampClass="line-clamp-6" className="text-destructive" />
        ) : null}

        {overview ? (
          <>
            <section
              aria-label={t("sectionKpi")}
              className="grid gap-4 rounded-xl  sm:grid-cols-2 xl:grid-cols-4 dark:border-border/50 dark:bg-muted/25"
            >
              <KpiCard
                title={t("kpiUsage")}
                hint={t("hintUsage")}
                value={String(overview.kpis.usageCount)}
                suffix={t("unitTimes")}
                mom={model === "__all__" ? overview.kpis.momUsage : null}
                momLabel={t("mom")}
                tracesHref={kpiMessagesListHref}
                hrefAriaLabel={t("kpiDeepLinkMessagesAria")}
              />
              <KpiCard
                title={t("kpiSpanErr")}
                hint={t("hintSpanErr")}
                value={overview.kpis.spanErrorRatePct.toFixed(2)}
                suffix="%"
                mom={null}
                momLabel={t("mom")}
                tracesHref={kpiSpansErrListHref}
                hrefAriaLabel={t("kpiDeepLinkSpansErrAria")}
              />
              <KpiCard
                title={t("kpiModelErr")}
                hint={t("hintModelErr")}
                value={overview.kpis.modelCallErrorRatePct.toFixed(2)}
                suffix="%"
                mom={null}
                momLabel={t("mom")}
                tracesHref={kpiModelErrSpansHref}
                hrefAriaLabel={t("kpiDeepLinkModelErrAria")}
              />
              <KpiCard
                title={t("kpiModelDur")}
                hint={t("hintModelDur")}
                value={overview.kpis.avgModelCallMs.toFixed(2)}
                suffix="ms"
                mom={null}
                momLabel={t("mom")}
                tracesHref={kpiSpansStatsLlmOnlyHref}
                hrefAriaLabel={t("kpiDeepLinkModelDurAria")}
              />
              <KpiCard
                title={t("kpiTokens")}
                hint={t("hintTokens")}
                value={(overview.kpis.totalTokens / 10_000).toFixed(2)}
                suffix={t("unitWanTokens")}
                mom={model === "__all__" ? overview.kpis.momTokens : null}
                momLabel={t("mom")}
                tracesHref={kpiSpansStatsLlmOnlyHref}
                hrefAriaLabel={t("kpiDeepLinkModelTokensAria")}
              />
              <KpiCard
                title={t("kpiToolCalls")}
                hint={t("hintToolCalls")}
                value={String(overview.kpis.toolCallCount)}
                suffix={t("unitTimes")}
                mom={model === "__all__" ? overview.kpis.momToolCalls : null}
                momLabel={t("mom")}
                tracesHref={kpiSpansStatsToolOnlyHref}
                hrefAriaLabel={t("kpiDeepLinkToolCallsAria")}
              />
              <KpiCard
                title={t("kpiToolErr")}
                hint={t("hintToolErr")}
                value={overview.kpis.toolErrorRatePct.toFixed(2)}
                suffix="%"
                mom={null}
                momLabel={t("mom")}
                tracesHref={kpiToolErrSpansHref}
                hrefAriaLabel={t("kpiDeepLinkToolErrAria")}
              />
              <KpiCard
                title={t("kpiToolDur")}
                hint={t("hintToolDur")}
                value={overview.kpis.avgToolCallMs.toFixed(2)}
                suffix="ms"
                mom={null}
                momLabel={t("mom")}
                tracesHref={kpiSpansStatsToolOnlyHref}
                hrefAriaLabel={t("kpiDeepLinkToolDurAria")}
              />
            </section>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Space size={8} className="items-center">
                <Typography.Text type="secondary" className="text-sm">
                  {t("filterModel")}
                </Typography.Text>
                <Select
                  value={model}
                  onChange={(v) => setModel(String(v))}
                  style={{ minWidth: 220 }}
                  size="small"
                >
                  <Select.Option value="__all__">{t("filterModelAll")}</Select.Option>
                  {modelOptions.map((m) => (
                    <Select.Option key={m} value={m}>
                      {m}
                    </Select.Option>
                  ))}
                </Select>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t("sampleNote", { spans: q.data?.spans.length ?? 0, traces: q.data?.traces.length ?? 0 })}
              </Typography.Text>
            </div>

            <section className="space-y-3" aria-label={t("sectionTokens")}>
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
                {t("sectionTokens")}
              </Typography.Title>
              <ChartCard title="" hint="">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 flex-1 flex-wrap gap-x-10 gap-y-5">
                      {tokenSummary ? (
                        <>
                          <div className="min-w-[140px]">
                            <div className="mb-1 flex items-center gap-1">
                              <Typography.Text
                                type="secondary"
                                className="text-[13px] font-medium text-[#86909C] dark:text-muted-foreground"
                              >
                                {t("tokenTotal")}
                              </Typography.Text>
                              <TitleHintIcon
                                tooltipText={t("hintTokens")}
                                iconClassName="h-3.5 w-3.5 text-[#86909C] dark:text-muted-foreground"
                                className="shrink-0"
                              />
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-1">
                              <span className="text-[22px] font-semibold tabular-nums text-[#1D2129] dark:text-foreground">
                                {tokenSummary.total}
                              </span>
                              <span className="text-sm text-[#86909C] dark:text-muted-foreground">
                                {tokenSummary.unitLabel}
                              </span>
                            </div>
                          </div>
                          <div className="min-w-[140px]">
                            <div className="mb-1 flex items-center gap-1">
                              <Typography.Text
                                type="secondary"
                                className="text-[13px] font-medium text-[#86909C] dark:text-muted-foreground"
                              >
                                {t("tokenInputEst")}
                              </Typography.Text>
                              <TitleHintIcon
                                tooltipText={t("hintTokenSplit")}
                                iconClassName="h-3.5 w-3.5 text-[#86909C] dark:text-muted-foreground"
                                className="shrink-0"
                              />
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-1">
                              <span
                                className="text-[22px] font-semibold tabular-nums dark:text-foreground"
                                style={{ color: CHART_PRIMARY }}
                              >
                                {tokenSummary.input}
                              </span>
                              <span className="text-sm text-[#86909C] dark:text-muted-foreground">
                                {tokenSummary.unitLabel}
                              </span>
                            </div>
                          </div>
                          <div className="min-w-[140px]">
                            <div className="mb-1 flex items-center gap-1">
                              <Typography.Text
                                type="secondary"
                                className="text-[13px] font-medium text-[#86909C] dark:text-muted-foreground"
                              >
                                {t("tokenOutputEst")}
                              </Typography.Text>
                              <TitleHintIcon
                                tooltipText={t("hintTokenSplit")}
                                iconClassName="h-3.5 w-3.5 text-[#86909C] dark:text-muted-foreground"
                                className="shrink-0"
                              />
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-1">
                              <span
                                className="text-[22px] font-semibold tabular-nums dark:text-foreground"
                                style={{ color: CHART_SECONDARY }}
                              >
                                {tokenSummary.output}
                              </span>
                              <span className="text-sm text-[#86909C] dark:text-muted-foreground">
                                {tokenSummary.unitLabel}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                    <Space size={8} className="shrink-0 flex-wrap items-center lg:pt-0.5">
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t("tokenUnitLabel")}
                      </Typography.Text>
                      <Radio.Group
                        type="button"
                        name="overview-token-unit"
                        size="small"
                        value={tokenUnit}
                        onChange={(v) => setTokenUnit(v as "k" | "wan")}
                      >
                        <Radio value="k">{t("unitKTokens")}</Radio>
                        <Radio value="wan">{t("unitWanTokens")}</Radio>
                      </Radio.Group>
                      <div
                        className="flex rounded-md border border-solid border-[#E5E6EB] bg-white p-0.5 shadow-sm dark:border-border dark:bg-card"
                        role="group"
                        aria-label={`${t("tokenChartLine")} / ${t("tokenChartBar")}`}
                      >
                        <button
                          type="button"
                          className={cn(
                            "inline-flex size-8 items-center justify-center rounded transition-colors",
                            tokenChartKind === "line"
                              ? "bg-[#F2F3F5] text-[#1D2129] dark:bg-muted dark:text-foreground"
                              : "text-[#86909C] hover:bg-[#F7F8FA] dark:text-muted-foreground dark:hover:bg-muted/60",
                          )}
                          aria-pressed={tokenChartKind === "line"}
                          aria-label={t("tokenChartLine")}
                          onClick={() => setTokenChartKind("line")}
                        >
                          <LineChart className="size-4" strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "inline-flex size-8 items-center justify-center rounded transition-colors",
                            tokenChartKind === "bar"
                              ? "bg-[#F2F3F5] text-[#1D2129] dark:bg-muted dark:text-foreground"
                              : "text-[#86909C] hover:bg-[#F7F8FA] dark:text-muted-foreground dark:hover:bg-muted/60",
                          )}
                          aria-pressed={tokenChartKind === "bar"}
                          aria-label={t("tokenChartBar")}
                          onClick={() => setTokenChartKind("bar")}
                        >
                          <BarChart3 className="size-4" strokeWidth={1.75} aria-hidden />
                        </button>
                      </div>
                    </Space>
                  </div>

                  <div className="h-[320px] w-full min-w-0">
                    {tokenSeries.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                    ) : (
                      <ReactEChart key={tokenChartKind} option={echartsOpts!.token} />
                    )}
                  </div>
                </div>
              </ChartCard>
            </section>

            {/* 活动时间线部分 */}
            <section aria-label={t("activityTimeline")}>
              <ActivityTimeline
                totalTokens={activityQuery.data?.totalTokens}
                dayData={activityQuery.data?.dayData}
                hourData={activityQuery.data?.hourData}
                loading={activityQuery.isFetching}
              />
            </section>

            <section aria-label={t("sectionModel")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionModel")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                  title={t("chartModelQps")}
                  hint={t("hintModelQps")}
                  rightSlot={
                    <Space size={6} className="shrink-0">
                      <Select
                        size="small"
                        className="min-w-[5.5rem]"
                        value={modelQpsRateKind}
                        onChange={(v) => setModelQpsRateKind(v as "qps" | "qpm")}
                        triggerProps={{ autoAlignPopupWidth: false }}
                      >
                        <Select.Option value="qps">{t("modelQpsUnitQps")}</Select.Option>
                        <Select.Option value="qpm">{t("modelQpsUnitQpm")}</Select.Option>
                      </Select>
                      <Select
                        size="small"
                        className="min-w-[5.5rem]"
                        value={modelQpsStatusFilter}
                        onChange={(v) => setModelQpsStatusFilter(v as "all" | "success" | "fail")}
                        triggerProps={{ autoAlignPopupWidth: false }}
                      >
                        <Select.Option value="all">{t("modelQpsFilterAll")}</Select.Option>
                        <Select.Option value="success">{t("modelQpsFilterSuccess")}</Select.Option>
                        <Select.Option value="fail">{t("modelQpsFilterFail")}</Select.Option>
                      </Select>
                    </Space>
                  }
                >
                  <div className="h-[240px] w-full min-w-0">
                    {modelQpsRows.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                    ) : (
                      <ReactEChart option={echartsOpts!.modelQps} />
                    )}
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelSuccess")} hint={t("hintModelSuccess")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.modelSuccess} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartTokenRate")} hint={t("hintTokenRate")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.modelTokenRate} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelDurSum")} hint={t("hintModelDurSum")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.modelDur} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelDist")} hint={t("hintModelDist")}>
                  <div className="h-[260px] w-full min-w-0">
                    {overview.charts.modelDistribution.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                    ) : (
                      <ReactEChart option={echartsOpts!.modelPie} />
                    )}
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelErrDist")} hint={t("hintModelErrDist")}>
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
                    <span className="text-4xl font-bold tabular-nums text-foreground">{overview.kpis.modelErrorCount}</span>
                    <p className="text-center text-xs text-muted-foreground">{t("modelErrCountHint")}</p>
                  </div>
                </ChartCard>
              </div>
            </section>

            <section aria-label={t("sectionLatency")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionLatency")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={t("chartTtft")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.ttft} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartTpot")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.tpot} />
                  </div>
                </ChartCard>
              </div>
            </section>

            <section aria-label={t("sectionTools")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionTools")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title={t("chartToolVol")} hint={t("hintToolVol")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.toolVol} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartToolLat")} hint={t("hintToolLat")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.toolLat} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartToolOk")} hint={t("hintToolOk")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.toolOk} />
                  </div>
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={t("chartToolDist")} hint={t("hintToolDist")}>
                  <div className="h-[260px] w-full min-w-0">
                    {overview.charts.toolDistribution.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                    ) : (
                      <ReactEChart option={echartsOpts!.toolPie} />
                    )}
                  </div>
                </ChartCard>
                <ChartCard title={t("chartToolErrDist")} hint={t("hintToolErrDist")}>
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
                    <span className="text-4xl font-bold tabular-nums text-foreground">{overview.kpis.toolErrorCount}</span>
                    <p className="text-center text-xs text-muted-foreground">{t("toolErrCountHint")}</p>
                  </div>
                </ChartCard>
              </div>
            </section>

            <section aria-label={t("sectionAgent")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionAgent")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title={t("chartAgentSteps")} hint={t("hintAgentSteps")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.agentSteps} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartAgentTools")} hint={t("hintAgentTools")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.agentTools} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartAgentModels")} hint={t("hintAgentModels")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.agentModels} />
                  </div>
                </ChartCard>
              </div>
            </section>

            <section aria-label={t("sectionService")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionServiceTop")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title={t("chartTraceReport")} hint={t("hintTraceReport")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.traceReport} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartUsers")} hint={t("hintUsers")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.uniqueThreads} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartMessages")} hint={t("hintMessages")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.messages} />
                  </div>
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title={t("chartServiceQps")} hint={t("hintServiceQps")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.serviceQps} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartServiceLatency")} hint={t("hintServiceLatency")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.serviceLat} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartServiceSuccess")} hint={t("hintServiceSuccess")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.serviceOk} />
                  </div>
                </ChartCard>
              </div>
            </section>
          </>
        ) : q.isFetching ? (
          <div className="flex justify-center py-12">
            <Spin tip={t("loading")} />
          </div>
        ) : null}
</main>
    </AppPageShell>
  );
}
