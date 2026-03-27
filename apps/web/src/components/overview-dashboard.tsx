"use client";

import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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

function fmtMomBadge(n: number | null): { text: string; className: string } {
  if (n == null || !Number.isFinite(n)) {
    return { text: "—", className: "bg-neutral-100 text-neutral-600" };
  }
  if (Math.abs(n) < 0.005) {
    return { text: "0.00%", className: "bg-neutral-100 text-neutral-600" };
  }
  if (n > 0) {
    return { text: fmtPct(n), className: "bg-emerald-50 text-emerald-800" };
  }
  return { text: fmtPct(n), className: "bg-red-50 text-red-800" };
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
  const momB = fmtMomBadge(mom ?? null);
  return (
    <Card className="border-border/80 shadow-sm" size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2 pt-4 px-4">
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
          {hint ? <TitleHintIcon tooltipText={hint} iconClassName="h-4 w-4" className="shrink-0" /> : null}
        </div>
      </CardHeader>
      <CardContent className="pb-4 px-4 pt-0">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</span>
          {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{momLabel}</span>
          <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums", momB.className)}>
            {mom === null ? "—" : momB.text}
          </span>
        </div>
      </CardContent>
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
  return (
    <Card className={cn("border-border/80 shadow-sm", className)} size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 pt-3 px-4">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          {hint ? <TitleHintIcon tooltipText={hint} iconClassName="h-4 w-4" className="shrink-0" /> : null}
        </div>
        {rightSlot}
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">{children}</CardContent>
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
        <main className="ca-page relative z-[1]">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-56 rounded-lg bg-neutral-200" />
            <div className="h-40 max-w-full rounded-xl bg-neutral-100" />
          </div>
        </main>
      </AppPageShell>
    );
  }

  if (!baseUrl.trim()) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1]">
          <header className="mb-6">
            <h1 className="ca-page-title">{t("statsTitle")}</h1>
          </header>
          <p className="text-sm text-ca-muted">{t("needCollector")}</p>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="overview">
  <main className="ca-page relative z-[1] space-y-8 pb-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="ca-page-title">{t("statsTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("statsSubtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              {t("dataSourceSdk")}
            </span>
            <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangePersist} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={q.isFetching}
              onClick={() => void q.refetch()}
            >
              <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} aria-hidden />
              {t("refresh")}
            </Button>
          </div>
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
              <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{t("filterModel")}</span>
                <select
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="__all__">{t("filterModelAll")}</option>
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-muted-foreground">{t("sampleNote", { spans: q.data?.spans.length ?? 0, traces: q.data?.traces.length ?? 0 })}</p>
            </div>

            <section className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{t("sectionTokens")}</h2>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span className="text-muted-foreground">
                      {t("tokenTotal")}:{" "}
                      <strong className="font-mono text-foreground">
                        {(overview.kpis.totalTokens / 1000).toFixed(2)}
                      </strong>{" "}
                      {t("unitKTokensAbs")}
                    </span>
                    <span className="text-muted-foreground">
                      {t("tokenInputEst")}:{" "}
                      <strong className="font-mono text-foreground" style={{ color: CHART_PRIMARY }}>
                        {((overview.kpis.totalTokens * 0.58) / 1000).toFixed(2)}
                      </strong>
                    </span>
                    <span className="text-muted-foreground">
                      {t("tokenOutputEst")}:{" "}
                      <strong className="font-mono text-foreground" style={{ color: CHART_SECONDARY }}>
                        {((overview.kpis.totalTokens * 0.42) / 1000).toFixed(2)}
                      </strong>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("tokenUnitLabel")}</span>
                  <div className="flex rounded-lg border border-border p-0.5">
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition",
                        tokenUnit === "k" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setTokenUnit("k")}
                    >
                      {t("unitKTokens")}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition",
                        tokenUnit === "wan" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setTokenUnit("wan")}
                    >
                      {t("unitWanTokens")}
                    </button>
                  </div>
                </div>
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
              <h2 className="text-sm font-semibold text-foreground">{t("sectionModel")}</h2>
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
              <h2 className="text-sm font-semibold text-foreground">{t("sectionLatency")}</h2>
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
              <h2 className="text-sm font-semibold text-foreground">{t("sectionTools")}</h2>
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
              <h2 className="text-sm font-semibold text-foreground">{t("sectionAgent")}</h2>
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
              <h2 className="text-sm font-semibold text-foreground">{t("sectionServiceTop")}</h2>
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
              <h3 className="text-sm font-semibold text-foreground">{t("sectionServiceCharts")}</h3>
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
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : null}
</main>
    </AppPageShell>
  );
}
