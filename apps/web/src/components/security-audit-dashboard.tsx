"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Pagination, Space, Spin, Table, Tag, Typography } from "@arco-design/web-react";
import { IconRefresh } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppPageShell } from "@/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint } from "@/components/message-hint";
import { ObserveDateRangeTrigger } from "@/components/observe-date-range-trigger";
import { useRouter } from "@/i18n/navigation";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";
import {
  defaultObserveDateRange,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  writeStoredObserveDateRange,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import {
  buildSecurityAuditHitTypeDistribution,
  buildSecurityAuditRiskTrend,
  buildSecurityAuditTopSources,
  buildTracesInspectQuery,
  type SecurityHitCategory,
} from "@/lib/security-audit-analytics";
import {
  loadSecurityAuditEvents,
  parseSecurityAuditFindings,
  type SecurityAuditEventRow,
} from "@/lib/security-audit-records";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";

const PAGE_SIZE = 50;
/** Collector 对安全审计列表的 limit 上限 */
const ANALYTICS_LIMIT = 200;

const PIE_COLORS: Record<SecurityHitCategory, string> = {
  pii: "#2563eb",
  secret: "#ea580c",
  injection: "#9333ea",
};

function hitTypeLabel(t: ReturnType<typeof useTranslations<"SecurityAudit">>, cat: SecurityHitCategory): string {
  switch (cat) {
    case "secret":
      return t("hitTypeSecret");
    case "injection":
      return t("hitTypeInjection");
    default:
      return t("hitTypePii");
  }
}

export function SecurityAuditDashboard() {
  const t = useTranslations("SecurityAudit");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

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
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      void queryClient.invalidateQueries({ queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents] });
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
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
    }),
    [page, pageSize, sinceMs, untilMs],
  );

  const analyticsParams = useMemo(
    () => ({
      limit: ANALYTICS_LIMIT,
      offset: 0,
      order: "desc" as const,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
    }),
    [sinceMs, untilMs],
  );

  const enabled = mounted && baseUrl.trim().length > 0;

  const eventsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents, baseUrl, apiKey, listParams],
    queryFn: () => loadSecurityAuditEvents(baseUrl, apiKey, listParams),
    enabled,
    staleTime: 20_000,
  });

  const analyticsQ = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents, baseUrl, apiKey, "analytics", analyticsParams],
    queryFn: () => loadSecurityAuditEvents(baseUrl, apiKey, analyticsParams),
    enabled,
    staleTime: 20_000,
  });

  const analyticsRows = analyticsQ.data?.items ?? [];
  const trendData = useMemo(() => buildSecurityAuditRiskTrend(analyticsRows), [analyticsRows]);
  const hitSlices = useMemo(() => buildSecurityAuditHitTypeDistribution(analyticsRows), [analyticsRows]);
  const topSources = useMemo(() => buildSecurityAuditTopSources(analyticsRows, 8), [analyticsRows]);

  const pieChartData = useMemo(
    () =>
      hitSlices.map((s) => ({
        name: hitTypeLabel(t, s.category),
        value: s.value,
        category: s.category,
      })),
    [hitSlices, t],
  );

  const openTraceForRow = useCallback(
    (row: SecurityAuditEventRow) => {
      router.push(`/traces?${buildTracesInspectQuery(row)}`);
    },
    [router],
  );

  const columns: TableColumnProps<SecurityAuditEventRow>[] = useMemo(
    () => [
      {
        title: t("colTime"),
        dataIndex: "created_at_ms",
        width: 168,
        render: (ms: number) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatTraceDateTimeFromMs(ms)}
          </span>
        ),
      },
      {
        title: t("colTrace"),
        dataIndex: "trace_id",
        width: 200,
        render: (tid: string) => (
          <span className="text-xs font-medium text-primary">{formatShortId(tid)}</span>
        ),
      },
      {
        title: t("colSpan"),
        dataIndex: "span_id",
        width: 120,
        render: (sid: string | null) => (
          <span className="font-mono text-xs text-muted-foreground">{sid ? formatShortId(sid) : "—"}</span>
        ),
      },
      {
        title: t("colHits"),
        dataIndex: "hit_count",
        width: 72,
        render: (n: number) => <span className="tabular-nums text-xs">{n}</span>,
      },
      {
        title: t("colIntercepted"),
        dataIndex: "intercepted",
        width: 100,
        render: (n: number) => (
          <Tag size="small" color={n === 1 ? "orange" : "gray"}>
            {n === 1 ? t("tagEnforced") : t("tagObserve")}
          </Tag>
        ),
      },
      {
        title: t("colPolicies"),
        dataIndex: "findings_json",
        ellipsis: true,
        render: (raw: string) => {
          const findings = parseSecurityAuditFindings(raw);
          const labels = findings.map((f) => `${f.policy_name}×${f.match_count}`);
          return (
            <Typography.Text className="text-xs" ellipsis={{ rows: 2, showTooltip: true }}>
              {labels.length ? labels.join(", ") : "—"}
            </Typography.Text>
          );
        },
      },
    ],
    [t],
  );

  const riskTrendChart =
    trendData.length > 0 ? (
      <div className="h-[220px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <RechartsTooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value: number, name: string) => [value, name === "enforcedHits" ? t("seriesEnforced") : t("seriesObserve")]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => (value === "enforcedHits" ? t("seriesEnforced") : t("seriesObserve"))}
            />
            <Bar dataKey="enforcedHits" stackId="hits" fill="#ea580c" name="enforcedHits" />
            <Bar dataKey="observeHits" stackId="hits" fill="#94a3b8" name="observeHits" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        —
      </Typography.Text>
    );

  const hitTypeChart =
    pieChartData.length > 0 ? (
      <div className="mx-auto h-[220px] w-full max-w-[280px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieChartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={72}
              paddingAngle={2}
            >
              {pieChartData.map((entry) => (
                <Cell key={entry.category} fill={PIE_COLORS[entry.category as SecurityHitCategory]} />
              ))}
            </Pie>
            <RechartsTooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        —
      </Typography.Text>
    );

  const sourcesChart =
    topSources.length > 0 ? (
      <div className="h-[220px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={topSources}
            margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={132} tick={{ fontSize: 9 }} interval={0} />
            <RechartsTooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name={t("chartTopSources")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        —
      </Typography.Text>
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
        <main className="ca-page relative z-[1] space-y-4">
          <h1 className="ca-page-title">{t("title")}</h1>
          <MessageHint text={t("needCollector")} />
        </main>
      </AppPageShell>
    );
  }

  const total = eventsQ.data?.total ?? 0;
  const items = eventsQ.data?.items ?? [];

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ca-page-title">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <Space>
            <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangePersist} />
            <Button
              type="outline"
              size="small"
              icon={<IconRefresh className={cn((eventsQ.isFetching || analyticsQ.isFetching) && "animate-spin")} />}
              loading={eventsQ.isFetching || analyticsQ.isFetching}
              onClick={() => {
                void eventsQ.refetch();
                void analyticsQ.refetch();
              }}
            >
              {t("refresh")}
            </Button>
          </Space>
        </header>

        <section aria-label={t("timelineSectionTitle")} className="space-y-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">{t("timelineSectionTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("timelineBlurb")}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("chartSampleNote")}</p>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={t("chartRiskTrend")} bordered className="shadow-sm" bodyStyle={{ paddingBottom: 8 }}>
              {analyticsQ.isFetching && !analyticsQ.data ? <Spin className="py-8" /> : riskTrendChart}
            </Card>
            <Card title={t("chartHitTypes")} bordered className="shadow-sm" bodyStyle={{ paddingBottom: 8 }}>
              {analyticsQ.isFetching && !analyticsQ.data ? <Spin className="py-8" /> : hitTypeChart}
            </Card>
            <Card title={t("chartTopSources")} bordered className="shadow-sm" bodyStyle={{ paddingBottom: 8 }}>
              {analyticsQ.isFetching && !analyticsQ.data ? <Spin className="py-8" /> : sourcesChart}
              <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
                {t("sourceFootnote")}
              </p>
            </Card>
          </div>
        </section>

        <section aria-label={t("eventListSection")} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t("eventListSection")}</h3>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <Table<SecurityAuditEventRow>
              size="small"
              loading={eventsQ.isLoading}
              columns={columns}
              data={items}
              rowKey="id"
              pagination={false}
              noDataElement={<div className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</div>}
              onRow={(record) => ({
                onClick: () => openTraceForRow(record),
                style: { cursor: "pointer" },
              })}
            />
            {total > pageSize ? (
              <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
                <Typography.Text type="secondary" className="text-xs">
                  {t("showingOfTotal", {
                    from: String(items.length ? (page - 1) * pageSize + 1 : 0),
                    to: String(items.length ? (page - 1) * pageSize + items.length : 0),
                    total: String(total),
                  })}
                </Typography.Text>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {t("paginationTotalPages", { count: String(Math.max(1, Math.ceil(total / pageSize) || 1)) })}
                  </span>
                  <Pagination
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={total}
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
          </div>
        </section>
      </main>
    </AppPageShell>
  );
}
