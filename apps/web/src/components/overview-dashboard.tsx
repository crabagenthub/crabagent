"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Radio, Select, Skeleton, Space, Spin, Tag, Typography } from "@arco-design/web-react";
import { IconRefresh } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
  buildOverview,
  collectModelOptions,
  filterByModel,
  loadPagedSpans,
  loadPagedTraces,
} from "@/lib/overview-metrics";
import { loadSpanRecords } from "@/lib/span-records";
import { loadTraceRecords } from "@/lib/trace-records";
import { cn } from "@/lib/utils";

const CHART_PRIMARY = "#7c3aed";
const CHART_SECONDARY = "#14b8a6";
const PIE_COLORS = ["#7c3aed", "#14b8a6", "#f59e0b", "#ec4899", "#3b82f6", "#64748b"];

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

function ChartCard({ title, hint, children, className, rightSlot }: ChartCardProps) {
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
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={tokenSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="ovIn" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_PRIMARY} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={CHART_PRIMARY} stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="ovOut" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_SECONDARY} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={CHART_SECONDARY} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => String(v)} label={{ value: tokenScaleHint, angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                            fontSize: 12,
                          }}
                          formatter={(val: number, name: string) => [`${val}`, name === "input" ? t("legendInput") : t("legendOutput")]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "input" ? t("legendInput") : t("legendOutput"))} />
                        <Area type="monotone" dataKey="input" stroke={CHART_PRIMARY} fill="url(#ovIn)" strokeWidth={2} name="input" />
                        <Area type="monotone" dataKey="output" stroke={CHART_SECONDARY} fill="url(#ovOut)" strokeWidth={2} name="output" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </ChartCard>
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
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={overview.charts.traceCountByDay.map((d) => ({ ...d, qps: d.n / 86400 }))}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                          <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Area type="monotone" dataKey="qps" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.15} strokeWidth={2} name="QPS" />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelSuccess")} hint={t("hintModelSuccess")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.modelSuccessByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, t("rate")]} />
                        <Area type="monotone" dataKey="rate" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.12} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartTokenRate")} hint={t("hintTokenRate")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.modelTokenRateByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="tps" stroke={CHART_PRIMARY} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelDurSum")} hint={t("hintModelDurSum")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.modelDurationSumByDay.map((d) => ({ ...d, sec: d.ms / 1000 }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(1)} s`, t("duration")]} />
                        <Area type="monotone" dataKey="sec" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
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
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.ttftByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(0)} ms`, ""]} />
                        <Line type="monotone" dataKey="ms" stroke={CHART_PRIMARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartTpot")} hint={t("hintTpot")}>
                  <div className="h-[240px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.tpotByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(2)} ms`, "TPOT"]} />
                        <Area type="monotone" dataKey="ms" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.14} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartModelDist")} hint={t("hintModelDist")}>
                  <div className="h-[260px] w-full min-w-0">
                    {overview.charts.modelDistribution.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={overview.charts.modelDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label={(e) => `${(e as { name: string }).name}`}>
                            {overview.charts.modelDistribution.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, _n, p) => [`${v} (${(p as { payload?: { pct?: number } }).payload?.pct?.toFixed?.(1)}%)`, t("calls")]} />
                          <Legend layout="vertical" align="left" verticalAlign="middle" />
                        </PieChart>
                      </ResponsiveContainer>
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
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.toolVolumeByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="n" stroke={CHART_PRIMARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartToolLat")} hint={t("hintToolLat")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.toolLatencyByDay.map((d) => ({ ...d, s: d.avgMs / 1000 }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(2)} s`, t("avg")]} />
                        <Area type="monotone" dataKey="s" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartToolOk")} hint={t("hintToolOk")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.toolSuccessByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, t("rate")]} />
                        <Area type="monotone" dataKey="rate" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.12} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={t("chartToolDist")} hint={t("hintToolDist")}>
                  <div className="h-[260px] w-full min-w-0">
                    {overview.charts.toolDistribution.length === 0 ? (
                      <p className="py-16 text-center text-sm text-muted-foreground">{t("noChartData")}</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={overview.charts.toolDistribution.slice(0, 6)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>
                            {overview.charts.toolDistribution.slice(0, 6).map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend layout="vertical" align="left" verticalAlign="middle" />
                        </PieChart>
                      </ResponsiveContainer>
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
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.agentStepsByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="avg" stroke={CHART_PRIMARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartAgentTools")} hint={t("hintAgentTools")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.agentToolsByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="avg" stroke={CHART_PRIMARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartAgentModels")} hint={t("hintAgentModels")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.agentModelsByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="avg" stroke={CHART_PRIMARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
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
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.traceReportByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="n" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartUsers")} hint={t("hintUsers")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.uniqueThreadsByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip />
                        <Line type="monotone" dataKey="n" stroke={CHART_PRIMARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartMessages")} hint={t("hintMessages")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overview.charts.traceCountByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="n" stroke={CHART_SECONDARY} strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
              </div>
              <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
                {t("sectionServiceCharts")}
              </Typography.Title>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title={t("chartServiceQps")} hint={t("hintServiceQps")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.serviceQpsByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="qps" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartServiceLatency")} hint={t("hintServiceLatency")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.serviceLatencyByDay.map((d) => ({ ...d, s: d.avgMs / 1000 }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(1)} s`, t("avg")]} />
                        <Area type="monotone" dataKey="s" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard title={t("chartServiceSuccess")} hint={t("hintServiceSuccess")}>
                  <div className="h-[220px] w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.charts.serviceSuccessByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(x) => String(x).slice(5)} />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, t("rate")]} />
                        <Area type="monotone" dataKey="rate" stroke={CHART_PRIMARY} fill={CHART_PRIMARY} fillOpacity={0.12} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
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
