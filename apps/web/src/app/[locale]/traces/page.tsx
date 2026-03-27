"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { AppPageShell } from "@/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { ListEmptyState } from "@/components/list-empty-state";
import { MessageHint } from "@/components/message-hint";
import { ObserveListFiltersDialog } from "@/components/observe-list-filters-dialog";
import { ObserveListKindSwitcher } from "@/components/observe-list-kind-switcher";
import { ObserveListToolbar } from "@/components/observe-list-toolbar";
import {
  defaultObserveDateRange,
  isObserveDateRangeAll,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  writeStoredObserveDateRange,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import { SpanRecordInspectDrawer } from "@/components/span-record-inspect-drawer";
import { SpansDataTable } from "@/components/spans-data-table";
import { ThreadConversationDrawer } from "@/components/thread-conversation-drawer";
import { ThreadsOpikTable } from "@/components/threads-opik-table";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { TraceRecordInspectDialog } from "@/components/trace-record-inspect-dialog";
import { TracesOpikTable } from "@/components/traces-opik-table";
import { loadCollectorUrl, loadApiKey } from "@/lib/collector";
import {
  loadObserveFacets,
  type ObserveListSortParam,
  type ObserveListStatusParam,
} from "@/lib/observe-facets";
import { loadSpanRecords, type SpanRecordRow } from "@/lib/span-records";
import { loadThreadRecords, type ThreadRecordRow } from "@/lib/thread-records";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadTraceRecords, type TraceRecordRow } from "@/lib/trace-records";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 60, 80, 100] as const;

const PAGE_SIZE_STORAGE_KEY = "crabagent-observe-list-page-size";

function readStoredPageSize(): number {
  if (typeof window === "undefined") {
    return 10;
  }
  try {
    const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const n = raw != null ? Number(raw) : Number.NaN;
    if (PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) {
      return n;
    }
  } catch {
    /* ignore */
  }
  return 10;
}

type ListKind = "threads" | "traces" | "spans";

/** 1-based page indices for shadcn-style pagination (with ellipses). */
function buildVisiblePages(current1Based: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 1) {
    return [1];
  }
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const delta = 1;
  const range = new Set<number>();
  range.add(1);
  range.add(totalPages);
  const l = Math.max(2, current1Based - delta);
  const r = Math.min(totalPages - 1, current1Based + delta);
  for (let i = l; i <= r; i++) {
    range.add(i);
  }
  const sorted = [...range].sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev > 0 && p - prev > 1) {
      out.push("ellipsis");
    }
    out.push(p);
    prev = p;
  }
  return out;
}

function invalidateObserveLists(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: [COLLECTOR_QUERY_SCOPE.traceList] });
  void queryClient.invalidateQueries({ queryKey: [COLLECTOR_QUERY_SCOPE.conversationList] });
  void queryClient.invalidateQueries({ queryKey: [COLLECTOR_QUERY_SCOPE.spanList] });
  void queryClient.invalidateQueries({ queryKey: ["observe-facets"] });
}

export default function TracesPage() {
  const t = useTranslations("Traces");
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const listKind = useMemo((): ListKind => {
    const raw = searchParams.get("kind");
    if (raw === "threads" || raw === "traces" || raw === "spans") {
      return raw;
    }
    return "threads";
  }, [searchParams]);

  const handleListKindChange = useCallback(
    (next: ListKind) => {
      const nextQuery: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        nextQuery[key] = value;
      });
      if (next === "threads") {
        delete nextQuery.kind;
      } else {
        nextQuery.kind = next;
      }
      if (Object.keys(nextQuery).length > 0) {
        router.replace({ pathname, query: nextQuery });
      } else {
        router.replace(pathname);
      }
    },
    [pathname, router, searchParams],
  );

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [jumpDraft, setJumpDraft] = useState("1");
  const [pageSize, setPageSizeState] = useState(10);
  const [dateRange, setDateRange] = useState<ObserveDateRange>(() => defaultObserveDateRange());

  const setDateRangePersist = useCallback((next: ObserveDateRange) => {
    setDateRange(next);
    writeStoredObserveDateRange(next);
  }, []);

  useEffect(() => {
    const stored = readStoredObserveDateRange();
    if (stored) {
      setDateRange(stored);
    }
  }, []);
  const [filterChannel, setFilterChannel] = useState("");
  const [filterAgent, setFilterAgent] = useState("");
  const [filterStatus, setFilterStatus] = useState<ObserveListStatusParam | "">("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftChannel, setDraftChannel] = useState("");
  const [draftAgent, setDraftAgent] = useState("");
  const [draftStatus, setDraftStatus] = useState<ObserveListStatusParam | "">("");
  const [sortKey, setSortKey] = useState<ObserveListSortParam>("time");
  const [listOrder, setListOrder] = useState<"asc" | "desc">("desc");
  const [threadDrawerRow, setThreadDrawerRow] = useState<ThreadRecordRow | null>(null);
  const [inspectTraceRow, setInspectTraceRow] = useState<TraceRecordRow | null>(null);
  const [inspectSpanRow, setInspectSpanRow] = useState<SpanRecordRow | null>(null);
  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  useEffect(() => {
    setPageSizeState(readStoredPageSize());
  }, []);

  const setPageSize = useCallback((n: number) => {
    setPageSizeState(n);
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(n));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSearchApplied(searchDraft.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      invalidateObserveLists(queryClient);
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange), [dateRange]);
  const listEnabled = mounted && baseUrl.trim().length > 0;
  const refetchInterval = 12_000;

  useEffect(() => {
    setPageIndex(0);
  }, [searchApplied, dateRange, listKind, filterChannel, filterAgent, filterStatus, sortKey, listOrder]);

  useEffect(() => {
    if (listKind !== "threads") {
      setThreadDrawerRow(null);
    }
  }, [listKind]);

  useEffect(() => {
    if (listKind !== "spans") {
      setInspectSpanRow(null);
    }
  }, [listKind]);

  const dateRangeKey = useMemo(
    () =>
      dateRange.kind === "custom"
        ? (`custom:${dateRange.startMs}-${dateRange.endMs}` as const)
        : (`preset:${dateRange.preset}` as const),
    [dateRange],
  );

  const traceQueryKey = useMemo(
    () =>
      [
        COLLECTOR_QUERY_SCOPE.traceList,
        baseUrl,
        apiKey,
        listOrder,
        sortKey,
        searchApplied,
        pageIndex,
        pageSize,
        dateRangeKey,
        sinceMs ?? 0,
        untilMs ?? 0,
        filterChannel,
        filterAgent,
        filterStatus,
      ] as const,
    [
      baseUrl,
      apiKey,
      listOrder,
      sortKey,
      searchApplied,
      pageIndex,
      pageSize,
      dateRangeKey,
      sinceMs,
      untilMs,
      filterChannel,
      filterAgent,
      filterStatus,
    ],
  );

  const threadQueryKey = useMemo(
    () =>
      [
        COLLECTOR_QUERY_SCOPE.conversationList,
        baseUrl,
        apiKey,
        listOrder,
        sortKey,
        searchApplied,
        pageIndex,
        pageSize,
        dateRangeKey,
        sinceMs ?? 0,
        untilMs ?? 0,
        filterChannel,
        filterAgent,
      ] as const,
    [
      baseUrl,
      apiKey,
      listOrder,
      sortKey,
      searchApplied,
      pageIndex,
      pageSize,
      dateRangeKey,
      sinceMs,
      untilMs,
      filterChannel,
      filterAgent,
    ],
  );

  const spanQueryKey = useMemo(
    () =>
      [
        COLLECTOR_QUERY_SCOPE.spanList,
        baseUrl,
        apiKey,
        listOrder,
        sortKey,
        searchApplied,
        pageIndex,
        pageSize,
        dateRangeKey,
        sinceMs ?? 0,
        untilMs ?? 0,
        filterChannel,
        filterAgent,
        filterStatus,
      ] as const,
    [
      baseUrl,
      apiKey,
      listOrder,
      sortKey,
      searchApplied,
      pageIndex,
      pageSize,
      dateRangeKey,
      sinceMs,
      untilMs,
      filterChannel,
      filterAgent,
      filterStatus,
    ],
  );

  const facetsQ = useQuery({
    queryKey: ["observe-facets", baseUrl, apiKey] as const,
    queryFn: () => loadObserveFacets(baseUrl, apiKey),
    enabled: listEnabled,
    staleTime: 60_000,
  });

  const channelOptions = useMemo(() => {
    const raw = facetsQ.data?.channels ?? [];
    const merged = new Set(raw);
    const add = (s: string) => {
      const x = s.trim();
      if (x) merged.add(x);
    };
    add(filterChannel);
    add(draftChannel);
    return Array.from(merged).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [facetsQ.data?.channels, filterChannel, draftChannel]);

  const agentOptions = useMemo(() => {
    const raw = facetsQ.data?.agents ?? [];
    const merged = new Set(raw);
    const add = (s: string) => {
      const x = s.trim();
      if (x) merged.add(x);
    };
    add(filterAgent);
    add(draftAgent);
    return Array.from(merged).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [facetsQ.data?.agents, filterAgent, draftAgent]);

  const handleFilterPopoverOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setDraftChannel(filterChannel);
        setDraftAgent(filterAgent);
        setDraftStatus(filterStatus);
      }
      setFiltersOpen(next);
    },
    [filterChannel, filterAgent, filterStatus],
  );

  const handleColumnSort = useCallback((sort: ObserveListSortParam, order: "asc" | "desc") => {
    setSortKey(sort);
    setListOrder(order);
  }, []);

  const applyFiltersFromDraft = useCallback(() => {
    setFilterChannel(draftChannel.trim());
    setFilterAgent(draftAgent.trim());
    setFilterStatus(draftStatus);
  }, [draftChannel, draftAgent, draftStatus]);

  const tracesQ = useQuery({
    queryKey: traceQueryKey,
    queryFn: () =>
      loadTraceRecords(baseUrl, apiKey, {
        limit: pageSize,
        offset: pageIndex * pageSize,
        order: listOrder,
        sort: sortKey === "tokens" ? "tokens" : undefined,
        search: searchApplied.length > 0 ? searchApplied : undefined,
        sinceMs,
        untilMs,
        channel: filterChannel.trim() || undefined,
        agent: filterAgent.trim() || undefined,
        status: filterStatus || undefined,
      }),
    enabled: listEnabled && listKind === "traces",
    refetchInterval,
    staleTime: 0,
  });

  const threadsQ = useQuery({
    queryKey: threadQueryKey,
    queryFn: () =>
      loadThreadRecords(baseUrl, apiKey, {
        limit: pageSize,
        offset: pageIndex * pageSize,
        order: listOrder,
        sort: sortKey === "tokens" ? "tokens" : undefined,
        search: searchApplied.length > 0 ? searchApplied : undefined,
        sinceMs,
        untilMs,
        channel: filterChannel.trim() || undefined,
        agent: filterAgent.trim() || undefined,
      }),
    enabled: listEnabled && listKind === "threads",
    refetchInterval,
    staleTime: 0,
  });

  const spansQ = useQuery({
    queryKey: spanQueryKey,
    queryFn: () =>
      loadSpanRecords(baseUrl, apiKey, {
        limit: pageSize,
        offset: pageIndex * pageSize,
        order: listOrder,
        sort: sortKey === "tokens" ? "tokens" : undefined,
        search: searchApplied.length > 0 ? searchApplied : undefined,
        sinceMs,
        untilMs,
        channel: filterChannel.trim() || undefined,
        agent: filterAgent.trim() || undefined,
        status: filterStatus || undefined,
      }),
    enabled: listEnabled && listKind === "spans",
    refetchInterval,
    staleTime: 0,
  });

  const q = listKind === "traces" ? tracesQ : listKind === "threads" ? threadsQ : spansQ;
  const traceRows = useMemo(() => tracesQ.data?.items ?? [], [tracesQ.data?.items]);
  const threadRows = useMemo(() => threadsQ.data?.items ?? [], [threadsQ.data?.items]);
  const spanRows = useMemo(() => spansQ.data?.items ?? [], [spansQ.data?.items]);
  const total = q.data?.total ?? 0;

  useEffect(() => {
    if (!q.isSuccess || total <= 0) {
      return;
    }
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (pageIndex > maxPage) {
      setPageIndex(maxPage);
    }
  }, [q.isSuccess, total, pageIndex, pageSize]);

  const lastUpdated =
    q.dataUpdatedAt > 0 ? formatTraceDateTimeLocal(new Date(q.dataUpdatedAt).toISOString()) : null;

  const missingUrl = mounted && baseUrl.trim().length === 0;

  const clearSearch = useCallback(() => {
    setSearchDraft("");
    setSearchApplied("");
  }, []);

  const clearObserveFacetFilters = useCallback(() => {
    setFilterChannel("");
    setFilterAgent("");
    setFilterStatus("");
    setDraftChannel("");
    setDraftAgent("");
    setDraftStatus("");
  }, []);

  const searchActive = searchApplied.length > 0;
  const observeFacetFilterCount =
    (filterChannel.trim() ? 1 : 0) +
    (filterAgent.trim() ? 1 : 0) +
    ((listKind === "traces" || listKind === "spans") && filterStatus ? 1 : 0);
  const filterCount =
    (!isObserveDateRangeAll(dateRange) ? 1 : 0) +
    (searchActive ? 1 : 0) +
    observeFacetFilterCount;

  const rangeFrom = total > 0 ? pageIndex * pageSize + 1 : 0;
  const rangeTo = pageIndex * pageSize + (listKind === "traces" ? traceRows.length : listKind === "threads" ? threadRows.length : spanRows.length);
  const hasNextPage = rangeTo < total;
  const hasPrevPage = pageIndex > 0;
  const maxPageIndex = Math.max(0, Math.ceil(total / pageSize) - 1);
  const hasFirstPage = pageIndex > 0;
  const hasLastPage = pageIndex < maxPageIndex;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const visiblePages = useMemo(
    () => buildVisiblePages(pageIndex + 1, totalPages),
    [pageIndex, totalPages],
  );

  useEffect(() => {
    setJumpDraft(String(pageIndex + 1));
  }, [pageIndex]);

  const applyJumpPage = useCallback(() => {
    const n = Number.parseInt(jumpDraft.trim(), 10);
    if (!Number.isFinite(n) || totalPages < 1) {
      return;
    }
    const clamped = Math.min(Math.max(1, Math.trunc(n)), totalPages);
    setPageIndex(clamped - 1);
  }, [jumpDraft, totalPages]);

  const searchPlaceholder =
    listKind === "threads"
      ? t("searchThreadsPlaceholder")
      : listKind === "spans"
        ? t("searchSpansPlaceholder")
        : t("searchTracesPlaceholder");

  const sectionAria =
    listKind === "threads" ? t("threadsTitle") : listKind === "spans" ? t("spansTitle") : t("title");

  const hasRows =
    listKind === "traces" ? traceRows.length > 0 : listKind === "threads" ? threadRows.length > 0 : spanRows.length > 0;

  const emptyTitle = (() => {
    if (searchActive || filterCount > 0) {
      return t("listEmptyHeadingFiltered");
    }
    if (listKind === "threads") {
      return t("threadsEmptyTitle");
    }
    if (listKind === "spans") {
      return t("spansEmptyTitle");
    }
    return t("listEmptyHeadingTraces");
  })();

  const emptyDescription = (() => {
    if (searchActive || filterCount > 0) {
      if (listKind === "threads") {
        return t("threadsEmptyFiltered");
      }
      if (listKind === "spans") {
        return t("spansEmptyFiltered");
      }
      return t("listTraceRecordsEmptyFiltered");
    }
    if (listKind === "threads") {
      return t("threadsEmptyBody");
    }
    if (listKind === "spans") {
      return t("spansEmptyBody");
    }
    return t("listTraceRecordsEmpty");
  })();

  if (!mounted) {
    return (
      <AppPageShell variant="traces">
        <main className="ca-page relative z-[1]">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-56 rounded-lg bg-neutral-200" />
            <div className="h-4 w-96 max-w-full rounded bg-neutral-200" />
          </div>
          <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="traces">
      <main className={cn("ca-page relative z-[1]", !missingUrl && "pb-[6rem]")}>
      <header className="mb-6">
        <h1 className="ca-page-title">
          {listKind === "threads" ? t("threadsTitle") : listKind === "spans" ? t("spansTitle") : t("title")}
        </h1>
      </header>

      {missingUrl && (
        <Card className="mb-6 border-amber-200 bg-amber-50/90 text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-50">
          <CardContent className="p-5">
            <MessageHint
              text={t("needCollectorUrl")}
              textClassName="text-sm leading-relaxed text-amber-950 dark:text-amber-50"
              clampClass="line-clamp-4"
            />
          </CardContent>
        </Card>
      )}

      {!missingUrl && (
        <ObserveListToolbar
          toolbarTop={
            <ObserveListKindSwitcher
              aria-label={t("listKindAria")}
              value={listKind}
              onChange={handleListKindChange}
              options={[
                { id: "threads", label: t("subTabThreads") },
                { id: "traces", label: t("subTabTraces") },
                { id: "spans", label: t("subTabSpans") },
              ]}
            />
          }
          filtersSlot={
            <ObserveListFiltersDialog
              open={filtersOpen}
              onOpenChange={handleFilterPopoverOpenChange}
              facetFilterCount={observeFacetFilterCount}
              listKind={listKind}
              draftChannel={draftChannel}
              setDraftChannel={setDraftChannel}
              draftAgent={draftAgent}
              setDraftAgent={setDraftAgent}
              draftStatus={draftStatus}
              setDraftStatus={setDraftStatus}
              channelOptions={channelOptions}
              agentOptions={agentOptions}
              onApply={applyFiltersFromDraft}
              onResetDraft={() => {
                setDraftChannel("");
                setDraftAgent("");
                setDraftStatus("");
              }}
            />
          }
          searchDraft={searchDraft}
          setSearchDraft={setSearchDraft}
          searchPlaceholder={searchPlaceholder}
          dateRange={dateRange}
          onDateRangeChange={setDateRangePersist}
          onRefresh={() => {
            void tracesQ.refetch();
            void threadsQ.refetch();
            void spansQ.refetch();
          }}
          isFetching={q.isFetching}
          searchActive={searchActive}
          onClearSearch={clearSearch}
        />
      )}

      {q.isSuccess && lastUpdated && !missingUrl && (
        <p className="mb-3 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">{t("lastUpdated")}:</span>{" "}
          <span className="font-mono">{lastUpdated}</span>
        </p>
      )}

      <section aria-label={sectionAria} className="space-y-4">
        <div className="space-y-4">
          {q.isFetching && !q.data && !missingUrl && (
            <div className="flex items-center gap-2 text-sm text-ca-muted">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              {t("fetching")}
            </div>
          )}
          {q.isError && !missingUrl && (
            <Card className="border-destructive/25 bg-destructive/5 text-destructive shadow-sm dark:border-destructive/40 dark:bg-destructive/10">
              <CardContent className="p-5">
                <p className="text-sm font-medium text-destructive">{String(q.error)}</p>
                <div className="mt-2">
                  <MessageHint text={t("probeHint")} textClassName="text-sm text-destructive/90" clampClass="line-clamp-4" />
                </div>
              </CardContent>
            </Card>
          )}
          {q.isSuccess && !hasRows && !missingUrl && !q.isFetching && (
            <ListEmptyState
              variant="card"
              title={emptyTitle}
              description={emptyDescription}
              footer={
                searchActive || filterCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      void clearSearch();
                      setDateRangePersist(defaultObserveDateRange());
                      clearObserveFacetFilters();
                    }}
                    className="rounded-xl border border-ca-border bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
                  >
                    {t("filterClear")}
                  </button>
                ) : undefined
              }
            />
          )}
          {hasRows ? (
            <div className="space-y-4 pb-1">
              {listKind === "traces" ? (
                <TracesOpikTable
                  rows={traceRows}
                  sortKey={sortKey}
                  listOrder={listOrder}
                  onColumnSort={handleColumnSort}
                  onRowClick={(r) => setInspectTraceRow(r)}
                />
              ) : null}
              {listKind === "threads" ? (
                <ThreadsOpikTable
                  rows={threadRows}
                  sortKey={sortKey}
                  listOrder={listOrder}
                  onColumnSort={handleColumnSort}
                  onRowClick={(row) => setThreadDrawerRow(row)}
                />
              ) : null}
              {listKind === "spans" ? (
                <SpansDataTable
                  rows={spanRows}
                  sortKey={sortKey}
                  listOrder={listOrder}
                  onColumnSort={handleColumnSort}
                  onRowClick={(r) => setInspectSpanRow(r)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {!missingUrl ? (
        <div
          className="fixed bottom-0 right-0 z-30 border-t border-border/80 bg-background/90 py-3 shadow-[0_-8px_28px_-12px_rgba(15,23,42,0.12)] backdrop-blur-md supports-[backdrop-filter]:bg-background/80 dark:border-border/55 dark:shadow-black/25"
          style={{ left: "var(--ca-content-offset-left)" }}
        >
          <div className="mx-auto flex w-full max-w-[min(100%,1600px)] flex-col gap-3 px-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5 lg:px-6">
            <p className="text-sm text-muted-foreground">
              {t("showingOfTotal", { from: String(rangeFrom), to: String(rangeTo), total: String(total) })}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {t("paginationTotalPages", { count: String(totalPages) })}
              </span>
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span>{t("paginationPerPageLabel")}</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPageIndex(0);
                  }}
                  className="h-9 rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {t("paginationPageSizeOption", { n: String(n) })}
                    </option>
                  ))}
                </select>
              </label>
              <Pagination className="mx-0 w-auto flex-initial justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationFirst
                      aria-label={t("paginationFirst")}
                      disabled={!hasFirstPage || q.isFetching}
                      onClick={() => setPageIndex(0)}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationPrevious
                      aria-label={t("paginationPrev")}
                      disabled={!hasPrevPage || q.isFetching}
                      onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                      text={t("paginationPrev")}
                    />
                  </PaginationItem>
                  {visiblePages.map((item, idx) =>
                    item === "ellipsis" ? (
                      <PaginationItem key={`ellipsis-${idx}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationLink
                          isActive={item === pageIndex + 1}
                          aria-label={t("paginationPage", { n: String(item) })}
                          disabled={q.isFetching}
                          onClick={() => setPageIndex(item - 1)}
                        >
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      aria-label={t("paginationNext")}
                      disabled={!hasNextPage || q.isFetching}
                      onClick={() => setPageIndex((p) => p + 1)}
                      text={t("paginationNext")}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLast
                      aria-label={t("paginationLast")}
                      disabled={!hasLastPage || q.isFetching}
                      onClick={() => setPageIndex(maxPageIndex)}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="whitespace-nowrap">{t("paginationJumpLabel")}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={t("paginationJumpLabel")}
                  value={jumpDraft}
                  onChange={(e) => setJumpDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyJumpPage();
                    }
                  }}
                  className="h-9 w-11 rounded-lg border border-input bg-background px-2 text-center text-sm tabular-nums text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <button
                  type="button"
                  onClick={() => applyJumpPage()}
                  className="h-9 shrink-0 rounded-lg border border-input bg-background px-2.5 text-xs font-semibold text-foreground shadow-sm hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("paginationJumpGo")}
                </button>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <ThreadConversationDrawer
        open={threadDrawerRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setThreadDrawerRow(null);
          }
        }}
        row={threadDrawerRow}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />

      <TraceRecordInspectDialog
        open={inspectTraceRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setInspectTraceRow(null);
          }
        }}
        row={inspectTraceRow}
        rows={traceRows}
        onNavigate={setInspectTraceRow}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />

      <SpanRecordInspectDrawer
        open={inspectSpanRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setInspectSpanRow(null);
          }
        }}
        row={inspectSpanRow}
        rows={spanRows}
        onNavigate={setInspectSpanRow}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />
    </main>
    </AppPageShell>
  );
}
