"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Pagination, Space, Spin, Table, Tag, Typography } from "@arco-design/web-react";
import { IconApps, IconList, IconRefresh } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactEChart } from "@/shared/components/react-echart";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint } from "@/shared/components/message-hint";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { usePathname, useRouter } from "@/i18n/navigation";
import { buildAuditLink } from "@/lib/audit-linkage";
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
  securityHitPieOption,
  securityTopSourcesBarOption,
  securityTrendBarOption,
} from "@/lib/security-audit-echarts-options";
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
/** Collector 对内容审计列表的 limit 上限 */
const ANALYTICS_LIMIT = 200;
const cardShellClass =
  "overflow-hidden rounded-lg border border-solid border-[#E5E6EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[box-shadow] duration-200 ease-out hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] dark:border-border dark:bg-card dark:shadow-sm dark:hover:shadow-md";

type SecurityAuditViewKind = "metrics" | "details";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const traceFromUrl = searchParams.get("trace_id")?.trim() ?? "";
  const spanFromUrl = searchParams.get("span_id")?.trim() ?? "";
  const policyIdFromUrl = searchParams.get("policy_id")?.trim() ?? "";
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewKind, setViewKind] = useState<SecurityAuditViewKind>("metrics");

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
      traceId: traceFromUrl || undefined,
      spanId: spanFromUrl || undefined,
      policyId: policyIdFromUrl || undefined,
    }),
    [page, pageSize, sinceMs, untilMs, traceFromUrl, spanFromUrl, policyIdFromUrl],
  );

  const analyticsParams = useMemo(
    () => ({
      limit: ANALYTICS_LIMIT,
      offset: 0,
      order: "desc" as const,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      traceId: traceFromUrl || undefined,
      spanId: spanFromUrl || undefined,
      policyId: policyIdFromUrl || undefined,
    }),
    [sinceMs, untilMs, traceFromUrl, spanFromUrl, policyIdFromUrl],
  );

  const clearTraceSpanFilters = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("trace_id");
    p.delete("span_id");
    p.delete("policy_id");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    setPage(1);
  }, [pathname, router, searchParams]);

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

  const analyticsRows = useMemo(() => analyticsQ.data?.items ?? [], [analyticsQ.data?.items]);
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

  const riskTrendOpt = useMemo(
    () => securityTrendBarOption(trendData, t("seriesAction"), t("seriesAuditOnly")),
    [trendData, t],
  );

  const hitTypeOpt = useMemo(() => securityHitPieOption(pieChartData), [pieChartData]);

  const sourcesOpt = useMemo(
    () =>
      securityTopSourcesBarOption(
        topSources.map((s) => s.label),
        topSources.map((s) => s.count),
        t("chartTopSources"),
      ),
    [topSources, t],
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
      {
        title: t("colLink"),
        width: 120,
        render: (_: unknown, row: SecurityAuditEventRow) => {
          const findings = parseSecurityAuditFindings(row.findings_json);
          const first = findings[0];
          return (
            <Button
              type="text"
              size="mini"
              className="!h-auto !px-0 text-xs text-primary"
              onClick={() =>
                router.push(
                  buildAuditLink("/resource-access", {
                    source: "policy",
                    trace_id: row.trace_id,
                    span_id: row.span_id ?? undefined,
                    policy_id: first?.policy_id || undefined,
                  }),
                )
              }
            >
              {t("securityToResource")}
            </Button>
          );
        },
      },
    ],
    [t, router],
  );

  const riskTrendChart =
    trendData.length > 0 ? (
      <div className="h-[220px] w-full min-w-0">
        <ReactEChart option={riskTrendOpt} />
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        —
      </Typography.Text>
    );

  const hitTypeChart =
    pieChartData.length > 0 ? (
      <div className="mx-auto h-[220px] w-full max-w-[280px] min-w-0">
        <ReactEChart option={hitTypeOpt} />
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        —
      </Typography.Text>
    );

  const sourcesChart =
    topSources.length > 0 ? (
      <div className="h-[220px] w-full min-w-0">
        <ReactEChart option={sourcesOpt} />
      </div>
    ) : (
      <Typography.Text type="secondary" className="text-sm">
        —
      </Typography.Text>
    );
  const total = eventsQ.data?.total ?? 0;
  const viewCounts = useMemo(
    () => ({
      metrics: analyticsRows.length,
      details: total,
    }),
    [analyticsRows.length, total],
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

  const items = eventsQ.data?.items ?? [];

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-6 pb-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ca-page-title">{t("title")}</h1>
            {traceFromUrl || spanFromUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                {traceFromUrl ? (
                  <Tag color="arcoblue" size="small">
                    {t("filterChipTrace", { id: formatShortId(traceFromUrl) })}
                  </Tag>
                ) : null}
                {spanFromUrl ? (
                  <Tag color="cyan" size="small">
                    {t("filterChipSpan", { id: formatShortId(spanFromUrl) })}
                  </Tag>
                ) : null}
                <Button type="outline" size="mini" onClick={clearTraceSpanFilters}>
                  {t("clearTraceSpanFilters")}
                </Button>
              </div>
            ) : null}
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

        <section aria-label={t("viewSwitcherAria")} className="space-y-3">
          <div role="radiogroup" aria-label={t("viewSwitcherAria")} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {([
              { id: "metrics" as const, label: t("viewMetrics"), Icon: IconApps },
              { id: "details" as const, label: t("viewDetails"), Icon: IconList },
            ] satisfies Array<{ id: SecurityAuditViewKind; label: string; Icon: typeof IconList }>).map((opt) => {
              const selected = viewKind === opt.id;
              const count = viewCounts[opt.id];
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
                  <span
                    className={cn(
                      "tabular-nums text-[13px]",
                      selected ? "text-neutral-700 dark:text-zinc-300" : "text-neutral-500 dark:text-zinc-500",
                    )}
                  >
                    {`(${count.toLocaleString()})`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {viewKind === "metrics" ? (
          <section aria-label={t("timelineSectionTitle")} className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{t("timelineSectionTitle")}</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title={t("chartRiskTrend")} bordered={false} className={cardShellClass} bodyStyle={{ paddingBottom: 8 }}>
                {analyticsQ.isFetching && !analyticsQ.data ? <Spin className="py-8" /> : riskTrendChart}
              </Card>
              <Card title={t("chartHitTypes")} bordered={false} className={cardShellClass} bodyStyle={{ paddingBottom: 8 }}>
                {analyticsQ.isFetching && !analyticsQ.data ? <Spin className="py-8" /> : hitTypeChart}
              </Card>
              <Card title={t("chartTopSources")} bordered={false} className={cardShellClass} bodyStyle={{ paddingBottom: 8 }}>
                {analyticsQ.isFetching && !analyticsQ.data ? <Spin className="py-8" /> : sourcesChart}
                <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
                  {t("sourceFootnote")}
                </p>
              </Card>
            </div>
          </section>
        ) : null}

        {viewKind === "details" ? (
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
        ) : null}
      </main>
    </AppPageShell>
  );
}
