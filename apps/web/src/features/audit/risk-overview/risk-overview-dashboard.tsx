"use client";

import "@/lib/arco-react19-setup";
import { Card, Radio, Select, Skeleton, Space, Spin, Typography } from "@arco-design/web-react";
import {
  IconArrowRise,
  IconArrowFall,
  IconCheck,
  IconRefresh,
  IconShareExternal,
  IconQuestionCircle,
} from "@arco-design/web-react/icon";
import { Button } from "@/shared/ui/button";
import {
  OBSERVE_CONTROL_OUTLINE_CLASSNAME,
  OBSERVE_TOOLBAR_HOVER_FG_ICO,
} from "@/lib/observe-table-style";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { ReactEChart } from "@/shared/components/react-echart";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint, TitleHintIcon } from "@/shared/components/message-hint";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { resolveObserveSinceUntil, type ObserveDateRange } from "@/lib/observe-date-range";
import {
  defaultCommandAnalysisDateRange,
  readCommandAnalysisDateRange,
  writeCommandAnalysisDateRange,
} from "@/lib/command-analysis-date-range";
import { cn } from "@/lib/utils";
import { LocalizedLink } from "@/shared/components/localized-link";
import type { TableColumnProps } from "@arco-design/web-react";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import {
  loadRiskOverviewDailyRiskTrends,
  loadRiskOverviewKPI,
  loadRiskOverviewDistribution,
  loadRiskOverviewRankings,
  loadRiskOverviewTrend,
  type RiskOverviewKPI,
  type RiskOverviewRankings,
  type RiskOverviewTrendData,
} from "@/lib/risk-overview-metrics";
import {
  eventTypePieOption,
  riskTrendLineOption,
  singleMetricLineOption,
} from "@/lib/risk-overview-echarts-options";

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

const kpiMetricCardClass =
  "border-[#DCE3F8] bg-gradient-to-br from-[#F7F9FF] via-[#F9FBFF] to-[#EEF3FF]";

type KpiCardProps = {
  title: string;
  hint?: string;
  value: string;
  suffix?: string;
  mom?: number | null;
  momLabel: string;
  tracesHref?: string;
  hrefAriaLabel?: string;
};

function KpiCard({ title, hint, value, suffix, mom, momLabel, tracesHref, hrefAriaLabel }: KpiCardProps) {
  const tRisk = useTranslations("RiskOverview");
  const momM = momTagMeta(mom ?? null);

  const card = (
    <Card
      bordered={false}
      className={cn(kpiCardShellClass, kpiMetricCardClass, tracesHref ? "group" : null)}
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
            aria-label={hrefAriaLabel ?? tRisk("kpiViewEventsAria")}
            className={cn(
              "relative z-[1] inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium",
              "text-primary opacity-0 transition-opacity duration-150",
              "group-hover:opacity-100 focus-visible:opacity-100",
              "hover:underline",
            )}
          >
            <IconShareExternal className="size-3.5 shrink-0" aria-hidden />
            {tRisk("kpiViewEvents")}
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

function ChartCard({ title, hint, children, className, rightSlot }: ChartCardProps) {
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

function singleMetricTrendOption(
  points: { day: string; count: number }[] | undefined | null,
  seriesName: string,
  color: string,
) {
  const safePoints = points ?? [];
  return singleMetricLineOption(safePoints, seriesName, color);
}

function metricDayDelta(points: { day: string; count: number }[]): number | null {
  if (!points || points.length < 2) {
    return null;
  }
  const last = points[points.length - 1]?.count ?? 0;
  const prev = points[points.length - 2]?.count ?? 0;
  if (!Number.isFinite(last) || !Number.isFinite(prev)) {
    return null;
  }
  return last - prev;
}

function TrendDeltaPill({ delta, label }: { delta: number | null; label: string }) {
  if (delta == null) {
    return <span className="text-xs text-[#86909C]">{label} —</span>;
  }
  const tone: MomTagTone = delta > 0 ? "green" : delta < 0 ? "red" : "gray";
  const text = delta > 0 ? `+${delta}` : `${delta}`;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-[#86909C]">{label}</span>
      <KpiMomPill tone={tone} text={text} />
    </span>
  );
}

type RankingViewKey =
  | "resourceTopResources"
  | "resourceTopDuration"
  | "commandTopCommands"
  | "commandSlowest";

function topRankColorClass(rank: number): string {
  if (rank <= 3) {
    return "text-[#F53F3F]";
  }
  return "text-[#86909C]";
}

export function RiskOverviewDashboard() {
  const t = useTranslations("RiskOverview");
  const queryClient = useQueryClient();
  /** 首屏在 useLayoutEffect 中从 localStorage 读入命令分析时间窗后再拉数，避免与命令执行页窗口不一致导致死循环/重复读为 0 */
  const [bootstrapped, setBootstrapped] = useState(false);
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultCommandAnalysisDateRange());
  const [rankingView, setRankingView] = useState<RankingViewKey>("resourceTopResources");

  const dateRangeKey = useMemo(() => {
    const key = JSON.stringify(dateRange);
    console.log("[DEBUG] dateRangeKey updated:", key);
    return key;
  }, [dateRange]);
  // 与 command-analysis 一致：KPI/分布等在 queryFn 内用当前页的 dateRange+Date.now() 解析，与 UI 与执行指令页 state 一致
  const { sinceMs, untilMs } = useMemo(
    () => resolveObserveSinceUntil(dateRange, Date.now()),
    [dateRange],
  );

  const kpiQueryKey = useMemo(() => {
    const key = [COLLECTOR_QUERY_SCOPE.riskOverviewDailyRiskTrends, "kpi", dateRangeKey];
    console.log("[DEBUG] kpiQueryKey updated:", key);
    return key;
  }, [dateRangeKey]);

  console.log("[DEBUG] bootstrapped:", bootstrapped, "kpiQueryKey:", kpiQueryKey);

  const kpiQuery = useQuery({
    queryKey: kpiQueryKey,
    queryFn: () => {
      console.log("[DEBUG] kpiQuery queryFn running with dateRange:", dateRange);
      return loadRiskOverviewKPI(dateRange);
    },
    enabled: bootstrapped,
    staleTime: 0,
  });

  const distributionQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.riskOverviewDailyRiskTrends, "distribution", dateRangeKey],
    queryFn: () => loadRiskOverviewDistribution(dateRange),
    enabled: bootstrapped,
    staleTime: 0,
  });

  const trendQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.riskOverviewTrend, dateRangeKey],
    queryFn: () => loadRiskOverviewTrend(dateRange),
    enabled: bootstrapped,
    staleTime: 0,
  });

  const dailyRiskTrendQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.riskOverviewDailyRiskTrends, dateRangeKey],
    queryFn: () => loadRiskOverviewDailyRiskTrends(dateRange),
    enabled: bootstrapped,
    staleTime: 0,
  });

  const rankingsQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.riskOverviewDailyRiskTrends, "rankings", dateRangeKey],
    queryFn: () => loadRiskOverviewRankings(dateRange),
    enabled: bootstrapped,
    staleTime: 0,
  });

  useLayoutEffect(() => {
    setDateRange(readCommandAnalysisDateRange());
    setBootstrapped(true);
  }, []);

  useEffect(() => {
    console.log("[DEBUG] dateRange state changed:", dateRange);
  }, [dateRange]);

  const handleDateRangeChange = useCallback((range: ObserveDateRange) => {
    console.log("[DEBUG] handleDateRangeChange called:", range);
    setDateRange(range);
    writeCommandAnalysisDateRange(range);
  }, []);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const rankingRows = useMemo(() => {
    const data: RiskOverviewRankings | undefined = rankingsQuery.data;
    if (!data) {
      return [];
    }
    switch (rankingView) {
      case "resourceTopResources":
        return data.resourceTopResources.map((x) => ({ label: x.name || "—", value: x.count, unit: "" }));
      case "resourceTopDuration":
        return data.resourceTopDuration.map((x) => ({ label: x.name || "—", value: x.durationMs, unit: "ms" }));
      case "commandTopCommands":
        return data.commandTopCommands.map((x) => ({ label: x.name || "—", value: x.count, unit: "" }));
      case "commandSlowest":
        return data.commandSlowest.map((x) => ({ label: x.name || "—", value: x.durationMs, unit: "ms" }));
      default:
        return [];
    }
  }, [rankingsQuery.data, rankingView]);

  const buildInvestigationLink = useCallback(
    (eventType: "resource" | "command", keyword: string) => {
      const sp = new URLSearchParams();
      sp.set("event_type", eventType);
      if (keyword.trim()) {
        sp.set("keyword", keyword.trim());
      }
      if (sinceMs != null && sinceMs > 0) {
        sp.set("since_ms", String(Math.floor(sinceMs)));
      }
      if (untilMs != null && untilMs > 0) {
        sp.set("until_ms", String(Math.floor(untilMs)));
      }
      sp.set("source", "risk");
      return `/events?${sp.toString()}`;
    },
    [sinceMs, untilMs],
  );

  const buildCommandAnalysisLink = useCallback(() => {
    const sp = new URLSearchParams();
    if (sinceMs != null && sinceMs > 0) {
      sp.set("since_ms", String(Math.floor(sinceMs)));
    }
    if (untilMs != null && untilMs > 0) {
      sp.set("until_ms", String(Math.floor(untilMs)));
    }
    sp.set("source", "risk");
    const qs = sp.toString();
    return qs ? `/command-analysis?${qs}` : `/command-analysis?source=risk`;
  }, [sinceMs, untilMs]);

  if (!bootstrapped) {
    return (
      <AppPageShell variant="overview">
        <main className="ca-page relative z-[1]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          </div>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Typography.Title heading={5} className="!m-0">
            {t("title")}
          </Typography.Title>
          <div className="flex flex-wrap items-center gap-2">
            <ObserveDateRangeTrigger value={dateRange} onChange={handleDateRangeChange} />
            <Button
              variant="outline"
              size="sm"
              className={cn(OBSERVE_CONTROL_OUTLINE_CLASSNAME, OBSERVE_TOOLBAR_HOVER_FG_ICO)}
              onClick={handleRefresh}
            >
              <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
              {t("refresh")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title={t("kpiTotalEvents")}
            value={String(kpiQuery.data?.totalEvents ?? 0)}
            momLabel={t("momLabel")}
            tracesHref="/audit/events"
          />
          <KpiCard
            title={t("kpiHighRiskEvents")}
            value={String(kpiQuery.data?.highRiskEvents ?? 0)}
            momLabel={t("momLabel")}
            tracesHref="/audit/events?severity=P0,P1"
          />
          <KpiCard
            title={t("kpiCommandLoopAlerts")}
            hint={t("kpiCommandLoopAlertsHint")}
            value={String(kpiQuery.data?.commandLoopAlerts ?? 0)}
            momLabel={t("momLabel")}
            tracesHref={buildCommandAnalysisLink()}
          />
          <KpiCard
            title={t("kpiCommandRedundantReads")}
            hint={t("kpiCommandRedundantReadsHint")}
            value={String(kpiQuery.data?.commandRedundantReads ?? 0)}
            momLabel={t("momLabel")}
            tracesHref={buildCommandAnalysisLink()}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title={t("chartRiskTrend")} hint={t("chartRiskTrendHint")}>
            {trendQuery.data && trendQuery.data.length > 0 ? (
              <ReactEChart
                option={riskTrendLineOption(
                  trendQuery.data.map((d) => ({
                    date: new Date(d.timestamp).toLocaleDateString(),
                    p0: d.p0,
                    p1: d.p1,
                    p2: d.p2,
                    p3: d.p3,
                  }))
                )}
                style={{ height: "300px" }}
              />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                {t("noData")}
              </div>
            )}
          </ChartCard>
          <ChartCard title={t("chartEventTypeDistribution")} hint={t("chartEventTypeDistributionHint")}>
            {distributionQuery.data ? (
              <ReactEChart
                option={eventTypePieOption([
                  { name: t("eventTypeCommand"), value: distributionQuery.data.eventType.command },
                  { name: t("eventTypeResource"), value: distributionQuery.data.eventType.resource },
                  { name: t("eventTypePolicy"), value: distributionQuery.data.eventType.policy },
                ])}
                style={{ height: "300px" }}
              />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                {t("noData")}
              </div>
            )}
          </ChartCard>
        </div>

        <ChartCard
          title={t("rankingCardTitle")}
          rightSlot={
            <Radio.Group
              type="button"
              size="small"
              value={rankingView}
              onChange={(v) => setRankingView(v as RankingViewKey)}
            >
              <Radio value="resourceTopResources">{t("rankingResourceTopResources")}</Radio>
              <Radio value="resourceTopDuration">{t("rankingResourceTopDuration")}</Radio>
              <Radio value="commandTopCommands">{t("rankingCommandTopCommands")}</Radio>
              <Radio value="commandSlowest">{t("rankingCommandSlowest")}</Radio>
            </Radio.Group>
          }
        >
          {rankingsQuery.isFetching && !rankingsQuery.data ? (
            <div className="h-[240px] flex items-center justify-center">
              <Spin />
            </div>
          ) : rankingRows.length > 0 ? (
            <ul className="space-y-1.5">
              {rankingRows.map((row, idx) => (
                <li key={`${rankingView}-${idx}`} className="last:border-0">
                  <div className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_6rem] items-center gap-2 rounded px-1 py-1 text-left">
                    <span
                      className={cn(
                        "inline-flex w-6 shrink-0 items-center justify-center text-base font-semibold leading-none",
                        topRankColorClass(idx + 1),
                      )}
                    >
                      {idx + 1}
                    </span>
                    <Typography.Text ellipsis className="min-w-0 text-xs text-[#1D2129] dark:text-foreground">
                      {row.label}
                    </Typography.Text>
                    <span className="shrink-0 text-right text-sm tabular-nums text-[#86909C]">
                      {row.unit ? `${Math.round(row.value).toLocaleString()} ${row.unit}` : Math.round(row.value).toLocaleString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
          )}
        </ChartCard>

        <section aria-label={t("chartResourceRiskGroupTitle")} className="space-y-3">
          <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
            {t("chartResourceRiskGroupTitle")}
          </Typography.Title>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title={t("seriesSensitivePath")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.resource.sensitivePath ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("resource", "sensitive_path")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.resource.sensitivePath,
                    t("seriesSensitivePath"),
                    "#F53F3F",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
            <ChartCard
              title={t("seriesRedundantRead")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.resource.redundantRead ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("resource", "redundant_read")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.resource.redundantRead,
                    t("seriesRedundantRead"),
                    "#FF7D00",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
            <ChartCard
              title={t("seriesCredentialSecret")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.resource.credentialAndSecret ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("resource", "credential_hint")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.resource.credentialAndSecret,
                    t("seriesCredentialSecret"),
                    "#165DFF",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
            <ChartCard
              title={t("seriesLargeRead")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.resource.largeRead ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("resource", "large_read")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.resource.largeRead,
                    t("seriesLargeRead"),
                    "#00B42A",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
          </div>
        </section>

        <section aria-label={t("chartCommandRiskGroupTitle")} className="space-y-3">
          <Typography.Title heading={6} className="!m-0 text-sm font-semibold text-[#1D2129] dark:text-foreground">
            {t("chartCommandRiskGroupTitle")}
          </Typography.Title>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title={t("seriesPermissionDenied")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.command.permissionDenied ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("command", "permission_denied")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.command.permissionDenied,
                    t("seriesPermissionDenied"),
                    "#F53F3F",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
            <ChartCard
              title={t("seriesInvalidCommand")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.command.invalidCommand ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("command", "command_not_found")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.command.invalidCommand,
                    t("seriesInvalidCommand"),
                    "#FF7D00",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
            <ChartCard
              title={t("seriesCommandLoop")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.command.commandLoop ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("command", "command_loop")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.command.commandLoop,
                    t("seriesCommandLoop"),
                    "#722ED1",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
            <ChartCard
              title={t("seriesSensitiveCommandTokenRisk")}
              rightSlot={
                <div className="flex items-center gap-2">
                  <TrendDeltaPill
                    label={t("trendVsPrevDay")}
                    delta={metricDayDelta(dailyRiskTrendQuery.data?.command.sensitiveCommandTokenRisk ?? [])}
                  />
                  <LocalizedLink className="text-xs text-primary hover:underline" href={buildInvestigationLink("command", "token_risk")}>
                    {t("kpiViewEvents")}
                  </LocalizedLink>
                </div>
              }
            >
              {dailyRiskTrendQuery.data ? (
                <ReactEChart
                  option={singleMetricTrendOption(
                    dailyRiskTrendQuery.data.command.sensitiveCommandTokenRisk,
                    t("seriesSensitiveCommandTokenRisk"),
                    "#165DFF",
                  )}
                  style={{ height: "220px" }}
                />
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t("noData")}</div>
              )}
            </ChartCard>
          </div>
        </section>

      </main>
    </AppPageShell>
  );
}
