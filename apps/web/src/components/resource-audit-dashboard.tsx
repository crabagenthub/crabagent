"use client";

import "@/lib/arco-react19-setup";
import {
  Button,
  Card,
  Input,
  Pagination,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";
import { IconRefresh } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactEChart } from "@/components/react-echart";
import { AppPageShell } from "@/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { ObserveDateRangeTrigger } from "@/components/observe-date-range-trigger";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import {
  defaultObserveDateRange,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  writeStoredObserveDateRange,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import { resourceDailyIoOption } from "@/lib/resource-audit-echarts-options";
import {
  loadResourceAuditEvents,
  loadResourceAuditStats,
  type ResourceAuditEventRow,
  type ResourceAuditSemanticClassParam,
} from "@/lib/resource-audit-records";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";

const PAGE_SIZE = 50;

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
  if (f === "large_read") {
    return "orange";
  }
  if (f === "redundant_read") {
    return "arcoblue";
  }
  return "gray";
}

export function ResourceAuditDashboard() {
  const t = useTranslations("ResourceAudit");
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [semanticClass, setSemanticClass] = useState<ResourceAuditSemanticClassParam>("all");
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
      search: search.trim() || undefined,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      semantic_class: semanticClass,
    }),
    [page, search, sinceMs, untilMs, semanticClass],
  );

  const statsParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      semantic_class: semanticClass,
    }),
    [search, sinceMs, untilMs, semanticClass],
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

  const applySearch = useCallback(() => {
    setSearch(searchDraft);
    setPage(1);
  }, [searchDraft]);

  const columns: TableColumnProps<ResourceAuditEventRow>[] = useMemo(
    () => [
      {
        title: t("colTime"),
        dataIndex: "started_at_ms",
        width: 168,
        render: (ms: number) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatTraceDateTimeFromMs(ms)}
          </span>
        ),
      },
      {
        title: t("colUri"),
        dataIndex: "resource_uri",
        ellipsis: true,
        render: (uri: string) => (
          <Typography.Text className="text-xs" ellipsis={{ rows: 2, showTooltip: true }}>
            {uri || "—"}
          </Typography.Text>
        ),
      },
      {
        title: t("colClass"),
        dataIndex: "semantic_class",
        width: 120,
        render: (c: string) => <span className="text-xs">{classLabel(t, c)}</span>,
      },
      {
        title: t("colMode"),
        dataIndex: "access_mode",
        width: 88,
        render: (m: string | null) => <span className="text-xs font-mono">{m ?? "—"}</span>,
      },
      {
        title: t("colChars"),
        dataIndex: "chars",
        width: 100,
        render: (n: number | null) => (
          <span className="tabular-nums text-xs">{n != null ? n.toLocaleString() : "—"}</span>
        ),
      },
      {
        title: t("colDuration"),
        dataIndex: "duration_ms",
        width: 96,
        render: (n: number | null) => (
          <span className="tabular-nums text-xs">{n != null ? Math.round(n) : "—"}</span>
        ),
      },
      {
        title: t("relevance"),
        dataIndex: "relevance_max",
        width: 88,
        render: (n: number | null) => (
          <span className="tabular-nums text-xs">{n != null ? n.toFixed(3) : "—"}</span>
        ),
      },
      {
        title: t("colTrace"),
        dataIndex: "trace_id",
        width: 120,
        render: (_: unknown, row: ResourceAuditEventRow) => {
          const q = `trace=${encodeURIComponent(row.trace_id)}&span=${encodeURIComponent(row.span_id)}`;
          return (
            <LocalizedLink
              href={`/traces?${q}`}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("openTrace")} ({formatShortId(row.trace_id)})
            </LocalizedLink>
          );
        },
      },
      {
        title: t("colFlags"),
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
      {
        title: t("colSpanName"),
        dataIndex: "span_name",
        width: 120,
        ellipsis: true,
        render: (name: string) => (
          <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
            {name || "—"}
          </Typography.Text>
        ),
      },
    ],
    [t],
  );

  const dailyRows = useMemo(() => {
    const io = statsQ.data?.daily_io;
    if (!io?.length || !io.some((d) => d.day)) {
      return null;
    }
    return io.map((d) => ({
      day: d.day.slice(5),
      n: d.event_count,
      avg: d.avg_duration_ms != null ? Math.round(d.avg_duration_ms) : 0,
    }));
  }, [statsQ.data?.daily_io]);

  const dailyOpt = useMemo(
    () => (dailyRows ? resourceDailyIoOption(dailyRows, "events", "avg ms") : null),
    [dailyRows],
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
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-sm">
              {t("subtitle")}
            </Typography.Paragraph>
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

        <section aria-label={t("sectionDashboard")} className="space-y-3">
          <Typography.Title heading={6} className="!m-0 text-sm font-semibold">
            {t("sectionDashboard")}
          </Typography.Title>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={t("topResources")} bordered className="shadow-sm">
              <ul className="space-y-2 text-sm">
                {(statsQ.data?.top_resources ?? []).length === 0 ? (
                  <li className="text-muted-foreground">—</li>
                ) : (
                  statsQ.data!.top_resources.map((r) => (
                    <li key={r.uri} className="flex min-w-0 flex-col gap-0.5 border-b border-border/60 pb-2 last:border-0">
                      <Typography.Text ellipsis className="text-xs font-medium">
                        {r.uri}
                      </Typography.Text>
                      <span className="text-[11px] text-muted-foreground">
                        {r.count}×
                        {r.sum_chars != null ? ` · ${Math.round(r.sum_chars).toLocaleString()} chars` : ""}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
            <Card title={t("classDist")} bordered className="shadow-sm">
              <Space direction="vertical" size={8} className="w-full">
                {(statsQ.data?.class_distribution ?? []).map((c) => (
                  <div key={c.semantic_class} className="flex items-center justify-between text-sm">
                    <span>{classLabel(t, c.semantic_class)}</span>
                    <Tag>{c.count}</Tag>
                  </div>
                ))}
              </Space>
            </Card>
            <Card title={t("dailyTrend")} bordered className="shadow-sm" bodyStyle={{ paddingBottom: 8 }}>
              {statsQ.isFetching && !statsQ.data ? <Spin className="py-8" /> : dailyChart}
            </Card>
          </div>
        </section>

        <section aria-label={t("sectionTable")} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
            </Space>
          </div>

          {eventsQ.isError ? (
            <MessageHint text={String(eventsQ.error)} clampClass="line-clamp-6" className="text-destructive" />
          ) : null}

          {eventsQ.isFetching && !eventsQ.data ? (
            <div className="flex justify-center py-12">
              <Spin tip={t("loading")} />
            </div>
          ) : (
            <>
              <Table
                className="[&_.arco-table-th]:bg-[#f7f9fc] [&_.arco-table-th.arco-table-col-sorted]:bg-[#f7f9fc]"
                rowKey="span_id"
                columns={columns}
                data={eventsQ.data?.items ?? []}
                pagination={false}
                border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
                size="small"
                scroll={{ x: 1200 }}
              />
              <div className="flex flex-col items-center gap-2 pt-4 sm:flex-row sm:justify-between">
                <Typography.Text type="secondary" className="text-xs">
                  {t("showingOfTotal", {
                    from: String(eventsQ.data?.items.length ? (page - 1) * pageSize + 1 : 0),
                    to: String(eventsQ.data?.items.length ? (page - 1) * pageSize + eventsQ.data!.items.length : 0),
                    total: String(eventsQ.data?.total ?? 0),
                  })}
                </Typography.Text>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">
                    {t("paginationTotalPages", {
                      count: String(Math.max(1, Math.ceil((eventsQ.data?.total ?? 0) / pageSize) || 1)),
                    })}
                  </span>
                  <Pagination
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={eventsQ.data?.total ?? 0}
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
      </main>
    </AppPageShell>
  );
}
