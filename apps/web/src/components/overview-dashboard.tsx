"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Radio, Select, Skeleton, Space, Spin, Tag, Typography } from "@arco-design/web-react";
import { IconRefresh } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ReactEChart } from "@/components/react-echart";
import { AppPageShell } from "@/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint, TitleHintIcon } from "@/components/message-hint";
import { ObserveDateRangeTrigger } from "@/components/observe-date-range-trigger";
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
} from "@/lib/overview-metrics";
import { loadSpanRecords } from "@/lib/span-records";
import { loadTraceRecords } from "@/lib/trace-records";
import { cn } from "@/lib/utils";
import { ActivityTimeline } from "@/components/activity-timeline";
import { loadActivityTimelineData } from "@/lib/activity-timeline-data";

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

type KpiCardProps = {
  title: string;
  hint?: string;
  value: string;
  suffix?: string;
  mom?: number | null;
  momLabel: string;
};

function KpiCard({ title, hint, value, suffix, mom, momLabel }: KpiCardProps) {
  const momM = momTagMeta(mom ?? null);
  return (
    <Card bordered className="overflow-hidden rounded-lg border-border/80 shadow-sm" bodyStyle={{ padding: "16px" }}>
      <div className="mb-2 flex flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
            {title}
          </Typography.Text>
          {hint ? <TitleHintIcon tooltipText={hint} iconClassName="h-4 w-4" className="shrink-0" /> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <Typography.Title heading={5} className="!m-0 tabular-nums tracking-tight">
          {value}
        </Typography.Title>
        {suffix ? (
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            {suffix}
          </Typography.Text>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {momLabel}
        </Typography.Text>
        {mom === null ? (
          <Tag size="small" color="gray">
            —
          </Tag>
        ) : (
          <Tag size="small" color={momM.color}>
            {momM.text}
          </Tag>
        )}
      </div>
    </Card>
  );
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
    <Card bordered className={cn("overflow-hidden rounded-lg border-border/80 shadow-sm", className)} bodyStyle={{ padding: showHeader ? "10px 12px 12px" : "12px" }}>
      {showHeader ? (
        <div className="mb-2 flex flex-row items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-1">
            {title ? (
              <Typography.Text bold className="truncate text-sm">
                {title}
              </Typography.Text>
            ) : null}
            {hint ? <TitleHintIcon tooltipText={hint} iconClassName="h-4 w-4" className="shrink-0" /> : null}
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

  const tokenSeries = useMemo(() => {
    if (!overview?.charts.tokensByDay) {
      return [];
    }
    const mult = tokenUnit === "wan" ? 1 : 10;
    return overview.charts.tokensByDay.map((row) => ({
      day: row.day.slice(5),
      input: Math.round(row.inputWan * mult * 100) / 100,
      output: Math.round(row.outputWan * mult * 100) / 100,
    }));
  }, [overview?.charts.tokensByDay, tokenUnit]);

  const tokenScaleHint =
    tokenUnit === "wan" ? t("tokenAxisWan") : t("tokenAxisK");

  const echartsOpts = useMemo(() => {
    if (!overview) {
      return null;
    }
    const c = overview.charts;
    return {
      token: tokenSplitOption(tokenSeries, tokenScaleHint, t("legendInput"), t("legendOutput")),
      modelQps: areaSingleOption(
        c.traceCountByDay.map((d) => ({ day: d.day, v: d.n / 86_400 })),
        "QPS",
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
        true,
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
  }, [overview, tokenSeries, tokenScaleHint, t]);

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
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-sm">
              {t("statsSubtitle")}
            </Typography.Paragraph>
          </div>
          <Space size={12} wrap className="items-center">
            <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangePersist} />
            <Button
              type="default"
              size="small"
              icon={<IconRefresh className={cn("size-3.5", q.isFetching && "animate-spin")} />}
              disabled={q.isFetching}
              onClick={() => void q.refetch()}
            >
              {t("refresh")}
            </Button>
          </Space>
        </header>

        {q.isError ? (
          <MessageHint text={String(q.error)} clampClass="line-clamp-6" className="text-destructive" />
        ) : null}

        {overview ? (
          <>
            <section aria-label={t("sectionKpi")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title={t("kpiUsage")}
                hint={t("hintUsage")}
                value={String(overview.kpis.usageCount)}
                suffix={t("unitTimes")}
                mom={model === "__all__" ? overview.kpis.momUsage : null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiSpanErr")}
                hint={t("hintSpanErr")}
                value={overview.kpis.spanErrorRatePct.toFixed(2)}
                suffix="%"
                mom={null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiModelErr")}
                hint={t("hintModelErr")}
                value={overview.kpis.modelCallErrorRatePct.toFixed(2)}
                suffix="%"
                mom={null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiModelDur")}
                hint={t("hintModelDur")}
                value={overview.kpis.avgModelCallMs.toFixed(2)}
                suffix="ms"
                mom={null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiTokens")}
                hint={t("hintTokens")}
                value={(overview.kpis.totalTokens / 10_000).toFixed(2)}
                suffix={t("unitWanTokens")}
                mom={model === "__all__" ? overview.kpis.momTokens : null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiToolCalls")}
                hint={t("hintToolCalls")}
                value={String(overview.kpis.toolCallCount)}
                suffix={t("unitTimes")}
                mom={model === "__all__" ? overview.kpis.momToolCalls : null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiToolErr")}
                hint={t("hintToolErr")}
                value={overview.kpis.toolErrorRatePct.toFixed(2)}
                suffix="%"
                mom={null}
                momLabel={t("mom")}
              />
              <KpiCard
                title={t("kpiToolDur")}
                hint={t("hintToolDur")}
                value={overview.kpis.avgToolCallMs.toFixed(2)}
                suffix="ms"
                mom={null}
                momLabel={t("mom")}
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
                  triggerProps={{ autoAlignPopupWidth: false }}
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

            <section className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                    {t("sectionTokens")}
                  </Typography.Title>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <Typography.Text type="secondary">
                      {t("tokenTotal")}:{" "}
                      <Typography.Text bold className="font-mono">
                        {(overview.kpis.totalTokens / 1000).toFixed(2)}
                      </Typography.Text>{" "}
                      {t("unitKTokensAbs")}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {t("tokenInputEst")}:{" "}
                      <Typography.Text bold className="font-mono" style={{ color: CHART_PRIMARY }}>
                        {((overview.kpis.totalTokens * 0.58) / 1000).toFixed(2)}
                      </Typography.Text>
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {t("tokenOutputEst")}:{" "}
                      <Typography.Text bold className="font-mono" style={{ color: CHART_SECONDARY }}>
                        {((overview.kpis.totalTokens * 0.42) / 1000).toFixed(2)}
                      </Typography.Text>
                    </Typography.Text>
                  </div>
                </div>
                <Space size={8} className="items-center">
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
                </Space>
              </div>
              <ChartCard title="" hint={t("hintTokenSplit")}>
                <div className="h-[300px] w-full min-w-0">
                  {tokenSeries.length === 0 ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                  ) : (
                    <ReactEChart option={echartsOpts!.token} />
                  )}
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
                <ChartCard title={t("chartModelQps")} hint={t("hintModelQps")}>
                  <div className="h-[240px] w-full min-w-0">
                    {overview.charts.traceCountByDay.length === 0 ? (
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
              </div>
            </section>

            <section aria-label={t("sectionLatency")} className="space-y-3">
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionLatency")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={t("chartTtft")} hint={t("hintTtft")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.ttft} />
                  </div>
                </ChartCard>
                <ChartCard title={t("chartTpot")} hint={t("hintTpot")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ReactEChart option={echartsOpts!.tpot} />
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
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionServiceCharts")}
              </Typography.Title>
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
