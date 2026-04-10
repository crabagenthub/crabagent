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
import { ObserveListKindSwitcher } from "@/components/observe-list-kind-switcher";
import { ObserveListToolbar } from "@/components/observe-list-toolbar";
import {
  ObserveTableColumnManager,
  useObserveTableColumnVisibility,
} from "@/components/observe-table-column-manager";
import {
  defaultObserveDateRange,
  isObserveDateRangeAll,
  readStoredObserveDateRange,
  resolveObserveSinceUntil,
  writeStoredObserveDateRange,
  type ObserveDateRange,
} from "@/lib/observe-date-range";
import {
  OBSERVE_SPANS_TABLE_ID,
  SPANS_DEFAULT_HIDDEN_OPTIONAL,
  SPANS_OPTIONAL_KEYS,
  SpansDataTable,
} from "@/components/spans-data-table";
import { ThreadConversationDrawer } from "@/components/thread-conversation-drawer";
import { OBSERVE_THREADS_TABLE_ID, THREADS_OPTIONAL_KEYS, ThreadsOpikTable } from "@/components/threads-opik-table";
import { Card, CardContent } from "@/components/ui/card";
import ArcoPagination from "@arco-design/web-react/es/Pagination";
import ArcoSwitch from "@arco-design/web-react/es/Switch";

import "@/lib/arco-react19-setup";
import { TraceRecordInspectDialog } from "@/components/trace-record-inspect-dialog";
import {
  OBSERVE_TRACES_TABLE_ID,
  TRACES_DEFAULT_HIDDEN_OPTIONAL,
  TRACES_OPTIONAL_KEYS,
  TracesOpikTable,
} from "@/components/traces-opik-table";
import { loadCollectorUrl, loadApiKey } from "@/lib/collector";
import {
  loadObserveFacets,
  type ObserveListSortParam,
  type ObserveListStatusParam,
} from "@/lib/observe-facets";
import {
  buildObserveQueryForPick,
  pickObserveInspectFromSearchParams,
  resolveSpanRowForInspect,
  resolveThreadRowForInspect,
  resolveTraceRowForInspect,
} from "@/lib/observe-inspect-url";
import { loadSpanRecords, type SpanRecordRow } from "@/lib/span-records";
import { loadThreadRecords, type ThreadRecordRow } from "@/lib/thread-records";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadTraceRecords, type TraceRecordRow } from "@/lib/trace-records";
import { readObserveAutoPull, writeObserveAutoPull } from "@/lib/observe-auto-pull";
import { cn } from "@/lib/utils";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";

type ListKind = "threads" | "traces" | "spans";

type ObserveListUiState = {
  searchDraft: string;
  searchApplied: string;
  pageIndex: number;
  pageSize: number;
  dateRange: ObserveDateRange;
  filterChannel: string;
  filterAgent: string;
  filterStatus: ObserveListStatusParam | "";
  sortKey: ObserveListSortParam;
  listOrder: "asc" | "desc";
};

function buildDefaultObserveListUiState(pageSize: number): ObserveListUiState {
  return {
    searchDraft: "",
    searchApplied: "",
    pageIndex: 0,
    pageSize,
    dateRange: defaultObserveDateRange(),
    filterChannel: "",
    filterAgent: "",
    filterStatus: "",
    sortKey: "time",
    listOrder: "desc",
  };
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
      setThreadDrawerRow(null);
      setInspectTraceRow(null);
      setInspectSpanRow(null);
      const nextQuery: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        if (key === "thread" || key === "trace" || key === "span") {
          return;
        }
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
  const [tracesUi, setTracesUi] = useState<ObserveListUiState>(() => buildDefaultObserveListUiState(10));
  const [threadsUi, setThreadsUi] = useState<ObserveListUiState>(() => buildDefaultObserveListUiState(10));
  const [spansUi, setSpansUi] = useState<ObserveListUiState>(() => buildDefaultObserveListUiState(10));

  useEffect(() => {
    const stored = readStoredObserveDateRange();
    if (stored) {
      setTracesUi((prev) => ({ ...prev, dateRange: stored }));
      setThreadsUi((prev) => ({ ...prev, dateRange: stored }));
      setSpansUi((prev) => ({ ...prev, dateRange: stored }));
    }
  }, []);
  const [threadDrawerRow, setThreadDrawerRow] = useState<ThreadRecordRow | null>(null);
  const [inspectTraceRow, setInspectTraceRow] = useState<TraceRecordRow | null>(null);
  const [inspectSpanRow, setInspectSpanRow] = useState<SpanRecordRow | null>(null);
  const [inspectTraceInitialSpanId, setInspectTraceInitialSpanId] = useState<string | null>(null);
  const [autoPull, setAutoPull] = useState(true);

  const inspectPick = useMemo(() => pickObserveInspectFromSearchParams(searchParams), [searchParams]);

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
    setAutoPull(readObserveAutoPull());
  }, []);

  const onAutoPullChange = useCallback((checked: boolean) => {
    setAutoPull(checked);
    writeObserveAutoPull(checked);
  }, []);

  useEffect(() => {
    const stored = readStoredPageSize(10);
    setTracesUi((prev) => ({ ...prev, pageSize: stored }));
    setThreadsUi((prev) => ({ ...prev, pageSize: stored }));
    setSpansUi((prev) => ({ ...prev, pageSize: stored }));
  }, []);

  const setPageSize = useCallback((n: number) => {
    writeStoredPageSize(n);
  }, []);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      invalidateObserveLists(queryClient);
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const currentUi = listKind === "traces" ? tracesUi : listKind === "threads" ? threadsUi : spansUi;
  const {
    searchDraft,
    searchApplied,
    pageIndex,
    pageSize,
    dateRange,
    filterChannel,
    filterAgent,
    filterStatus,
    sortKey,
    listOrder,
  } = currentUi;

  const updateCurrentUi = useCallback(
    (updater: (prev: ObserveListUiState) => ObserveListUiState) => {
      if (listKind === "traces") {
        setTracesUi(updater);
        return;
      }
      if (listKind === "threads") {
        setThreadsUi(updater);
        return;
      }
      setSpansUi(updater);
    },
    [listKind],
  );

  const setSearchDraft = useCallback((value: string) => {
    updateCurrentUi((prev) => ({ ...prev, searchDraft: value }));
  }, [updateCurrentUi]);

  const setDateRangePersist = useCallback((next: ObserveDateRange) => {
    updateCurrentUi((prev) => ({ ...prev, dateRange: next, pageIndex: 0 }));
    writeStoredObserveDateRange(next);
  }, [updateCurrentUi]);

  const setFilterChannel = useCallback((next: string) => {
    updateCurrentUi((prev) => ({ ...prev, filterChannel: next, pageIndex: 0 }));
  }, [updateCurrentUi]);

  const setFilterAgent = useCallback((next: string) => {
    updateCurrentUi((prev) => ({ ...prev, filterAgent: next, pageIndex: 0 }));
  }, [updateCurrentUi]);

  const setFilterStatus = useCallback((next: ObserveListStatusParam | "") => {
    updateCurrentUi((prev) => ({ ...prev, filterStatus: next, pageIndex: 0 }));
  }, [updateCurrentUi]);

  const handleColumnSort = useCallback((sort: ObserveListSortParam, order: "asc" | "desc") => {
    updateCurrentUi((prev) => ({ ...prev, sortKey: sort, listOrder: order, pageIndex: 0 }));
  }, [updateCurrentUi]);

  const setPageIndex = useCallback((next: number) => {
    updateCurrentUi((prev) => ({ ...prev, pageIndex: next }));
  }, [updateCurrentUi]);

  const setCurrentPageSize = useCallback((next: number) => {
    updateCurrentUi((prev) => ({ ...prev, pageSize: next, pageIndex: 0 }));
    setPageSize(next);
  }, [setPageSize, updateCurrentUi]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (listKind === "traces") {
        setTracesUi((prev) => ({ ...prev, searchApplied: prev.searchDraft.trim(), pageIndex: 0 }));
        return;
      }
      if (listKind === "threads") {
        setThreadsUi((prev) => ({ ...prev, searchApplied: prev.searchDraft.trim(), pageIndex: 0 }));
        return;
      }
      setSpansUi((prev) => ({ ...prev, searchApplied: prev.searchDraft.trim(), pageIndex: 0 }));
    }, 400);
    return () => window.clearTimeout(id);
  }, [listKind, searchDraft]);

  const { sinceMs, untilMs } = useMemo(() => resolveObserveSinceUntil(dateRange), [dateRange]);
  const tracesSinceUntil = useMemo(() => resolveObserveSinceUntil(tracesUi.dateRange), [tracesUi.dateRange]);
  const threadsSinceUntil = useMemo(() => resolveObserveSinceUntil(threadsUi.dateRange), [threadsUi.dateRange]);
  const spansSinceUntil = useMemo(() => resolveObserveSinceUntil(spansUi.dateRange), [spansUi.dateRange]);
  const listEnabled = mounted && baseUrl.trim().length > 0;
  const refetchInterval = autoPull ? 12_000 : false;

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

  const tracesDateRangeKey = useMemo(
    () =>
      tracesUi.dateRange.kind === "custom"
        ? (`custom:${tracesUi.dateRange.startMs}-${tracesUi.dateRange.endMs}` as const)
        : (`preset:${tracesUi.dateRange.preset}` as const),
    [tracesUi.dateRange],
  );
  const threadsDateRangeKey = useMemo(
    () =>
      threadsUi.dateRange.kind === "custom"
        ? (`custom:${threadsUi.dateRange.startMs}-${threadsUi.dateRange.endMs}` as const)
        : (`preset:${threadsUi.dateRange.preset}` as const),
    [threadsUi.dateRange],
  );
  const spansDateRangeKey = useMemo(
    () =>
      spansUi.dateRange.kind === "custom"
        ? (`custom:${spansUi.dateRange.startMs}-${spansUi.dateRange.endMs}` as const)
        : (`preset:${spansUi.dateRange.preset}` as const),
    [spansUi.dateRange],
  );

  const traceQueryKey = useMemo(
    () =>
      [
        COLLECTOR_QUERY_SCOPE.traceList,
        baseUrl,
        apiKey,
        tracesUi.listOrder,
        tracesUi.sortKey,
        tracesUi.searchApplied,
        tracesUi.pageIndex,
        tracesUi.pageSize,
        tracesDateRangeKey,
        tracesSinceUntil.sinceMs ?? 0,
        tracesSinceUntil.untilMs ?? 0,
        tracesUi.filterChannel,
        tracesUi.filterAgent,
        tracesUi.filterStatus,
      ] as const,
    [
      baseUrl,
      apiKey,
      tracesDateRangeKey,
      tracesSinceUntil.sinceMs,
      tracesSinceUntil.untilMs,
      tracesUi.filterAgent,
      tracesUi.filterChannel,
      tracesUi.filterStatus,
      tracesUi.listOrder,
      tracesUi.pageIndex,
      tracesUi.pageSize,
      tracesUi.searchApplied,
      tracesUi.sortKey,
    ],
  );

  const threadQueryKey = useMemo(
    () =>
      [
        COLLECTOR_QUERY_SCOPE.conversationList,
        baseUrl,
        apiKey,
        threadsUi.listOrder,
        threadsUi.sortKey,
        threadsUi.searchApplied,
        threadsUi.pageIndex,
        threadsUi.pageSize,
        threadsDateRangeKey,
        threadsSinceUntil.sinceMs ?? 0,
        threadsSinceUntil.untilMs ?? 0,
        threadsUi.filterChannel,
        threadsUi.filterAgent,
      ] as const,
    [
      baseUrl,
      apiKey,
      threadsDateRangeKey,
      threadsSinceUntil.sinceMs,
      threadsSinceUntil.untilMs,
      threadsUi.filterAgent,
      threadsUi.filterChannel,
      threadsUi.listOrder,
      threadsUi.pageIndex,
      threadsUi.pageSize,
      threadsUi.searchApplied,
      threadsUi.sortKey,
    ],
  );

  const spanQueryKey = useMemo(
    () =>
      [
        COLLECTOR_QUERY_SCOPE.spanList,
        baseUrl,
        apiKey,
        spansUi.listOrder,
        spansUi.sortKey,
        spansUi.searchApplied,
        spansUi.pageIndex,
        spansUi.pageSize,
        spansDateRangeKey,
        spansSinceUntil.sinceMs ?? 0,
        spansSinceUntil.untilMs ?? 0,
        spansUi.filterChannel,
        spansUi.filterAgent,
        spansUi.filterStatus,
      ] as const,
    [
      baseUrl,
      apiKey,
      spansDateRangeKey,
      spansSinceUntil.sinceMs,
      spansSinceUntil.untilMs,
      spansUi.filterAgent,
      spansUi.filterChannel,
      spansUi.filterStatus,
      spansUi.listOrder,
      spansUi.pageIndex,
      spansUi.pageSize,
      spansUi.searchApplied,
      spansUi.sortKey,
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
    return Array.from(merged).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [facetsQ.data?.channels, filterChannel]);

  const agentOptions = useMemo(() => {
    const raw = facetsQ.data?.agents ?? [];
    const merged = new Set(raw);
    const add = (s: string) => {
      const x = s.trim();
      if (x) merged.add(x);
    };
    add(filterAgent);
    return Array.from(merged).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [facetsQ.data?.agents, filterAgent]);


  const tracesColumns = useObserveTableColumnVisibility(
    OBSERVE_TRACES_TABLE_ID,
    TRACES_OPTIONAL_KEYS,
    TRACES_DEFAULT_HIDDEN_OPTIONAL,
  );
  const threadsColumns = useObserveTableColumnVisibility(OBSERVE_THREADS_TABLE_ID, THREADS_OPTIONAL_KEYS);
  const spansColumns = useObserveTableColumnVisibility(
    OBSERVE_SPANS_TABLE_ID,
    SPANS_OPTIONAL_KEYS,
    SPANS_DEFAULT_HIDDEN_OPTIONAL,
  );

  const tracesColumnManagerItems = useMemo(
    () => [
      { key: "trace_id", mandatory: true as const, label: t("colTableMessageId") },
      { key: "channel", mandatory: true as const, label: t("filterChannelLabel") },
      { key: "agent", mandatory: true as const, label: t("filterAgentLabel") },
      { key: "status", mandatory: true as const, label: t("colStatus") },
      { key: "duration", mandatory: true as const, label: t("colDuration") },
      { key: "openclaw_routing_kind", label: t("openclawRoutingFieldKind") },
      { key: "openclaw_routing_thinking", label: t("openclawRoutingFieldThinking") },
      { key: "openclaw_routing_fast", label: t("openclawRoutingFieldFast") },
      { key: "openclaw_routing_verbose", label: t("openclawRoutingFieldVerbose") },
      { key: "openclaw_routing_reasoning", label: t("openclawRoutingFieldReasoning") },
      { key: "input", label: t("colInput") },
      { key: "output", label: t("colOutput") },
      { key: "errors", label: t("colErrors") },
      { key: "total_tokens", label: t("colTotalTokens") },
    ],
    [t],
  );

  const threadsColumnManagerItems = useMemo(
    () => [
      { key: "thread_id", mandatory: true as const, label: t("colTableSessionId") },
      { key: "status", mandatory: true as const, label: t("colStatus") },
      { key: "last_message_preview", mandatory: true as const, label: t("threadsColLatestMessage") },
      { key: "agent_name", label: t("threadsColAgent") },
      { key: "channel_name", label: t("threadsColChannel") },
      { key: "trace_count", label: t("threadsColMessageCount") },
      { key: "total_tokens", label: t("colTotalTokens") },
    ],
    [t],
  );

  const spansColumnManagerItems = useMemo(
    () => [
      { key: "span_id", mandatory: true as const, label: t("spansColSpanId") },
      { key: "channel_name", mandatory: true as const, label: t("spansColChannel") },
      { key: "agent_name", mandatory: true as const, label: t("spansColAgent") },
      { key: "name", mandatory: true as const, label: t("spansColName") },
      { key: "list_status", mandatory: true as const, label: t("spansColStatus") },
      { key: "duration_ms", mandatory: true as const, label: t("spansColDuration") },
      { key: "input_preview", mandatory: true as const, label: t("spansColInput") },
      { key: "output_preview", mandatory: true as const, label: t("spansColOutput") },
      { key: "start_time_ms", label: t("spansColExecStart") },
      { key: "end_time_ms", label: t("spansColExecEnd") },
      { key: "total_tokens", label: t("spansColTokens") },
    ],
    [t],
  );

  const columnManagerSlot = useMemo(() => {
    if (listKind === "traces") {
      return (
        <ObserveTableColumnManager
          items={tracesColumnManagerItems}
          hiddenOptional={tracesColumns.hiddenOptional}
          onToggleOptional={tracesColumns.toggleOptional}
          onReset={tracesColumns.resetOptional}
        />
      );
    }
    if (listKind === "spans") {
      return (
        <ObserveTableColumnManager
          items={spansColumnManagerItems}
          hiddenOptional={spansColumns.hiddenOptional}
          onToggleOptional={spansColumns.toggleOptional}
          onReset={spansColumns.resetOptional}
        />
      );
    }
    return (
      <ObserveTableColumnManager
        items={threadsColumnManagerItems}
        hiddenOptional={threadsColumns.hiddenOptional}
        onToggleOptional={threadsColumns.toggleOptional}
        onReset={threadsColumns.resetOptional}
      />
    );
  }, [
    listKind,
    spansColumnManagerItems,
    spansColumns.hiddenOptional,
    spansColumns.resetOptional,
    spansColumns.toggleOptional,
    threadsColumnManagerItems,
    threadsColumns.hiddenOptional,
    threadsColumns.resetOptional,
    threadsColumns.toggleOptional,
    tracesColumnManagerItems,
    tracesColumns.hiddenOptional,
    tracesColumns.resetOptional,
    tracesColumns.toggleOptional,
  ]);

  const tracesQ = useQuery({
    queryKey: traceQueryKey,
    queryFn: () =>
      loadTraceRecords(baseUrl, apiKey, {
        limit: tracesUi.pageSize,
        offset: tracesUi.pageIndex * tracesUi.pageSize,
        order: tracesUi.listOrder,
        sort: tracesUi.sortKey === "tokens" ? "tokens" : undefined,
        search: tracesUi.searchApplied.length > 0 ? tracesUi.searchApplied : undefined,
        sinceMs: tracesSinceUntil.sinceMs,
        untilMs: tracesSinceUntil.untilMs,
        channel: tracesUi.filterChannel.trim() || undefined,
        agent: tracesUi.filterAgent.trim() || undefined,
        status: tracesUi.filterStatus || undefined,
      }),
    enabled: listEnabled,
    refetchInterval,
    staleTime: 0,
  });

  const threadsQ = useQuery({
    queryKey: threadQueryKey,
    queryFn: () =>
      loadThreadRecords(baseUrl, apiKey, {
        limit: threadsUi.pageSize,
        offset: threadsUi.pageIndex * threadsUi.pageSize,
        order: threadsUi.listOrder,
        sort: threadsUi.sortKey === "tokens" ? "tokens" : undefined,
        search: threadsUi.searchApplied.length > 0 ? threadsUi.searchApplied : undefined,
        sinceMs: threadsSinceUntil.sinceMs,
        untilMs: threadsSinceUntil.untilMs,
        channel: threadsUi.filterChannel.trim() || undefined,
        agent: threadsUi.filterAgent.trim() || undefined,
      }),
    enabled: listEnabled,
    refetchInterval,
    staleTime: 0,
  });

  const spansQ = useQuery({
    queryKey: spanQueryKey,
    queryFn: () =>
      loadSpanRecords(baseUrl, apiKey, {
        limit: spansUi.pageSize,
        offset: spansUi.pageIndex * spansUi.pageSize,
        order: spansUi.listOrder,
        sort: spansUi.sortKey === "tokens" ? "tokens" : undefined,
        search: spansUi.searchApplied.length > 0 ? spansUi.searchApplied : undefined,
        sinceMs: spansSinceUntil.sinceMs,
        untilMs: spansSinceUntil.untilMs,
        channel: spansUi.filterChannel.trim() || undefined,
        agent: spansUi.filterAgent.trim() || undefined,
        status: spansUi.filterStatus || undefined,
      }),
    enabled: listEnabled && listKind === "spans",
    refetchInterval,
    staleTime: 0,
  });

  useEffect(() => {
    const pick = pickObserveInspectFromSearchParams(searchParams);
    if (!pick) {
      return;
    }
    const hasSpan = searchParams.has("span");
    const hasTrace = searchParams.has("trace");
    const hasThread = searchParams.has("thread");
    const redundant =
      (pick.kind === "span" && (hasTrace || hasThread)) ||
      (pick.kind === "trace" && hasThread) ||
      (pick.kind === "thread" && (hasTrace || hasSpan));
    if (!redundant) {
      return;
    }
    router.replace({ pathname, query: buildObserveQueryForPick(searchParams, pick) });
  }, [pathname, router, searchParams]);

  const threadInspectResolveQ = useQuery({
    queryKey: ["observe-inspect-resolve", "thread", baseUrl, apiKey, inspectPick?.kind === "thread" ? inspectPick.id : ""] as const,
    queryFn: () => resolveThreadRowForInspect(baseUrl, apiKey, inspectPick!.id),
    enabled: listEnabled && inspectPick?.kind === "thread",
    staleTime: 60_000,
  });
  const traceInspectResolveQ = useQuery({
    queryKey: ["observe-inspect-resolve", "trace", baseUrl, apiKey, inspectPick?.kind === "trace" ? inspectPick.id : ""] as const,
    queryFn: () => resolveTraceRowForInspect(baseUrl, apiKey, inspectPick!.id),
    enabled: listEnabled && inspectPick?.kind === "trace",
    staleTime: 60_000,
  });
  const spanInspectResolveQ = useQuery({
    queryKey: ["observe-inspect-resolve", "span", baseUrl, apiKey, inspectPick?.kind === "span" ? inspectPick.id : ""] as const,
    queryFn: () => resolveSpanRowForInspect(baseUrl, apiKey, inspectPick!.id),
    enabled: listEnabled && inspectPick?.kind === "span",
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!listEnabled || !inspectPick) {
      return;
    }

    if (inspectPick.kind === "thread") {
      if (threadInspectResolveQ.isPending) {
        return;
      }
      if (threadInspectResolveQ.isError) {
        return;
      }
      const row = threadInspectResolveQ.data;
      if (row === undefined) {
        return;
      }
      if (row === null) {
        router.replace({ pathname, query: buildObserveQueryForPick(searchParams, null) });
        return;
      }
      setThreadDrawerRow(row);
      setInspectTraceRow(null);
      setInspectSpanRow(null);
      const kindOk = listKind === "threads";
      if (!kindOk) {
        const q = buildObserveQueryForPick(searchParams, inspectPick);
        delete q.kind;
        router.replace({ pathname, query: q });
      }
      return;
    }

    if (inspectPick.kind === "trace") {
      if (traceInspectResolveQ.isPending) {
        return;
      }
      if (traceInspectResolveQ.isError) {
        return;
      }
      const row = traceInspectResolveQ.data;
      if (row === undefined) {
        return;
      }
      if (row === null) {
        router.replace({ pathname, query: buildObserveQueryForPick(searchParams, null) });
        return;
      }
      setInspectTraceRow(row);
      setThreadDrawerRow(null);
      setInspectSpanRow(null);
      const kindOk = listKind === "traces";
      if (!kindOk) {
        const q = buildObserveQueryForPick(searchParams, inspectPick);
        q.kind = "traces";
        router.replace({ pathname, query: q });
      }
      return;
    }

    if (inspectPick.kind === "span") {
      if (spanInspectResolveQ.isPending) {
        return;
      }
      if (spanInspectResolveQ.isError) {
        return;
      }
      const row = spanInspectResolveQ.data;
      if (row === undefined) {
        return;
      }
      if (row === null) {
        router.replace({ pathname, query: buildObserveQueryForPick(searchParams, null) });
        return;
      }
      setThreadDrawerRow(null);
      setInspectSpanRow(row);
      const kindOk = listKind === "spans";
      if (!kindOk) {
        const q = buildObserveQueryForPick(searchParams, inspectPick);
        q.kind = "spans";
        router.replace({ pathname, query: q });
      }
    }
  }, [
    listEnabled,
    inspectPick,
    listKind,
    pathname,
    router,
    searchParams,
    threadInspectResolveQ.isPending,
    threadInspectResolveQ.isError,
    threadInspectResolveQ.data,
    traceInspectResolveQ.isPending,
    traceInspectResolveQ.isError,
    traceInspectResolveQ.data,
    spanInspectResolveQ.isPending,
    spanInspectResolveQ.isError,
    spanInspectResolveQ.data,
  ]);

  const openThreadInspect = useCallback(
    (row: ThreadRecordRow) => {
      setInspectTraceRow(null);
      setInspectSpanRow(null);
      setThreadDrawerRow(row);
      setInspectTraceInitialSpanId(null);
      const q = buildObserveQueryForPick(searchParams, { kind: "thread", id: row.thread_id });
      delete q.kind;
      router.replace({ pathname, query: q });
    },
    [pathname, router, searchParams],
  );

  const openTraceInspect = useCallback(
    (row: TraceRecordRow) => {
      setThreadDrawerRow(null);
      setInspectSpanRow(null);
      setInspectTraceInitialSpanId(null);
      setInspectTraceRow(row);
      const q = buildObserveQueryForPick(searchParams, { kind: "trace", id: row.trace_id });
      q.kind = "traces";
      router.replace({ pathname, query: q });
    },
    [pathname, router, searchParams],
  );

  const openSpanInspect = useCallback(
    (row: SpanRecordRow) => {
      setThreadDrawerRow(null);
      setInspectSpanRow(row);
      const q = buildObserveQueryForPick(searchParams, { kind: "span", id: row.span_id });
      q.kind = "spans";
      router.replace({ pathname, query: q });
    },
    [pathname, router, searchParams],
  );

  const clearObserveInspectInUrl = useCallback(() => {
    router.replace({ pathname, query: buildObserveQueryForPick(searchParams, null) });
  }, [pathname, router, searchParams]);

  const q = listKind === "traces" ? tracesQ : listKind === "threads" ? threadsQ : spansQ;
  const traceRows = useMemo(() => tracesQ.data?.items ?? [], [tracesQ.data?.items]);
  const threadRows = useMemo(() => threadsQ.data?.items ?? [], [threadsQ.data?.items]);
  const spanRows = useMemo(() => spansQ.data?.items ?? [], [spansQ.data?.items]);
  const total = q.data?.total ?? 0;

  const openTraceInspectOverlay = useCallback(
    async (traceId: string) => {
      const normalized = traceId.trim();
      if (!normalized) {
        return;
      }
      setInspectSpanRow(null);
      setInspectTraceInitialSpanId(null);
      const hit = traceRows.find((row) => row.trace_id === normalized);
      if (hit) {
        setInspectTraceRow(hit);
        return;
      }
      const resolved = await resolveTraceRowForInspect(baseUrl, apiKey, normalized);
      if (resolved) {
        setInspectTraceRow(resolved);
      }
    },
    [apiKey, baseUrl, traceRows],
  );

  useEffect(() => {
    if (!inspectSpanRow) {
      return;
    }
    const traceId = inspectSpanRow.trace_id?.trim();
    if (!traceId) {
      return;
    }
    let cancelled = false;
    const openMergedInspect = async () => {
      const hit = traceRows.find((row) => row.trace_id === traceId);
      const resolved = hit ?? (await resolveTraceRowForInspect(baseUrl, apiKey, traceId));
      if (cancelled || !resolved) {
        return;
      }
      setInspectTraceInitialSpanId(inspectSpanRow.span_id);
      setInspectTraceRow(resolved);
    };
    void openMergedInspect();
    return () => {
      cancelled = true;
    };
  }, [apiKey, baseUrl, inspectSpanRow, traceRows]);

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
    updateCurrentUi((prev) => ({ ...prev, searchDraft: "", searchApplied: "", pageIndex: 0 }));
  }, [updateCurrentUi]);

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
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  const searchPlaceholder =
    listKind === "threads"
      ? t("searchThreadsPlaceholder")
      : listKind === "spans"
        ? t("searchSpansPlaceholder")
        : t("searchTracesPlaceholder");

  const sectionAria =
    listKind === "threads" ? t("threadsTitle") : listKind === "spans" ? t("spansTitle") : t("title");

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
              counts={{
                threads:
                  threadsQ.isPending && threadsQ.data === undefined ? null : (threadsQ.data?.total ?? 0),
                traces:
                  tracesQ.isPending && tracesQ.data === undefined ? null : (tracesQ.data?.total ?? 0),
                spans: spansQ.isPending && spansQ.data === undefined ? null : (spansQ.data?.total ?? 0),
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
          isFetching={q.isFetching || q.isPending}
          searchActive={searchActive}
          onClearSearch={clearSearch}
          filtersSlot={columnManagerSlot}
        />
      )}

      {!missingUrl && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-500">
          <p className="min-w-0">
            <span className="font-medium text-neutral-700">{t("lastUpdated")}:</span>{" "}
            {q.isSuccess && lastUpdated ? (
              <span className="font-mono">{lastUpdated}</span>
            ) : (
              <span className="text-neutral-400">—</span>
            )}
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 select-none">
            <ArcoSwitch
              size="small"
              checked={autoPull}
              onChange={onAutoPullChange}
              aria-label={t("autoPullAria")}
            />
            <span className="text-neutral-600 dark:text-neutral-400">{t("autoPullLabel")}</span>
          </label>
        </div>
      )}

      <section aria-label={sectionAria} className="space-y-4">
        <div className="space-y-4">
          {q.isFetching && !q.data && !missingUrl && (
            <div className="flex items-center gap-2 text-sm text-ca-muted">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-500 dark:border-zinc-600 dark:border-t-zinc-400" />
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
          {q.isSuccess && !missingUrl && !q.isError ? (
            <div className="space-y-4 pb-1">
              {listKind === "traces" ? (
                traceRows.length === 0 ? (
                  <ListEmptyState variant="plain" className="min-h-0 py-2" title={emptyTitle} description={emptyDescription} />
                ) : (
                  <TracesOpikTable
                    rows={traceRows}
                    sortKey={sortKey}
                    listOrder={listOrder}
                    onColumnSort={handleColumnSort}
                    onRowClick={(r) => openTraceInspect(r)}
                    channelFilter={filterChannel}
                    channelOptions={channelOptions}
                    onChannelFilterChange={setFilterChannel}
                    agentFilter={filterAgent}
                    agentOptions={agentOptions}
                    onAgentFilterChange={setFilterAgent}
                    statusFilter={filterStatus}
                    onStatusFilterChange={setFilterStatus}
                    hiddenOptional={tracesColumns.hiddenOptional}
                    showColumnManager={false}
                  />
                )
              ) : null}
              {listKind === "threads" ? (
                threadRows.length === 0 ? (
                  <ListEmptyState variant="plain" className="min-h-0 py-2" title={emptyTitle} description={emptyDescription} />
                ) : (
                  <ThreadsOpikTable
                    rows={threadRows}
                    sortKey={sortKey}
                    listOrder={listOrder}
                    onColumnSort={handleColumnSort}
                    onRowClick={(row) => openThreadInspect(row)}
                    channelFilter={filterChannel}
                    channelOptions={channelOptions}
                    onChannelFilterChange={setFilterChannel}
                    agentFilter={filterAgent}
                    agentOptions={agentOptions}
                    onAgentFilterChange={setFilterAgent}
                    hiddenOptional={threadsColumns.hiddenOptional}
                    showColumnManager={false}
                  />
                )
              ) : null}
              {listKind === "spans" ? (
                spanRows.length === 0 ? (
                  <ListEmptyState variant="plain" className="min-h-0 py-2" title={emptyTitle} description={emptyDescription} />
                ) : (
                  <SpansDataTable
                    rows={spanRows}
                    sortKey={sortKey}
                    listOrder={listOrder}
                    onColumnSort={handleColumnSort}
                    onRowClick={(r) => openSpanInspect(r)}
                    channelFilter={filterChannel}
                    channelOptions={channelOptions}
                    onChannelFilterChange={setFilterChannel}
                    agentFilter={filterAgent}
                    agentOptions={agentOptions}
                    onAgentFilterChange={setFilterAgent}
                    statusFilter={filterStatus}
                    onStatusFilterChange={setFilterStatus}
                    hiddenOptional={spansColumns.hiddenOptional}
                    showColumnManager={false}
                  />
                )
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
              <ArcoPagination
                className="mx-0"
                size="small"
                current={pageIndex + 1}
                pageSize={pageSize}
                total={total}
                disabled={q.isFetching}
                bufferSize={1}
                sizeCanChange
                sizeOptions={[...PAGE_SIZE_OPTIONS]}
                showJumper
                onChange={(page, ps) => {
                  setPageIndex(page - 1);
                  if (ps !== pageSize) {
                    setCurrentPageSize(ps);
                  }
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <ThreadConversationDrawer
        open={threadDrawerRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setThreadDrawerRow(null);
            clearObserveInspectInUrl();
          }
        }}
        row={threadDrawerRow}
        baseUrl={baseUrl}
        apiKey={apiKey}
        onOpenTrace={(traceId) => {
          void openTraceInspectOverlay(traceId);
        }}
      />

      <TraceRecordInspectDialog
        open={inspectTraceRow != null}
        onOpenChange={(next) => {
          if (!next) {
            setInspectTraceRow(null);
            setInspectTraceInitialSpanId(null);
            setInspectSpanRow(null);
            if (threadDrawerRow) {
              const q = buildObserveQueryForPick(searchParams, { kind: "thread", id: threadDrawerRow.thread_id });
              delete q.kind;
              router.replace({ pathname, query: q });
              return;
            }
            clearObserveInspectInUrl();
          }
        }}
        row={inspectTraceRow}
        initialSpanId={inspectTraceInitialSpanId}
        rows={traceRows}
        onNavigate={(row) => openTraceInspect(row)}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />
    </main>
    </AppPageShell>
  );
}
