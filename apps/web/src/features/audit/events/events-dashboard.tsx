"use client";

import "@/lib/arco-react19-setup";
import { Button, Card, Popover, Space, Spin, Table, Tag, Typography } from "@arco-design/web-react";
import { IconQuestionCircle, IconRefresh, IconSearch, IconClockCircle, IconExclamationCircle } from "@arco-design/web-react/icon";
import type { TableColumnProps } from "@arco-design/web-react";
import ArcoPagination from "@arco-design/web-react/es/Pagination";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { AppPageShell } from "@/shared/components/app-page-shell";
import { LocalizedLink } from "@/shared/components/localized-link";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import { TraceRecordInspectDialog } from "@/features/observe/traces/components/trace-record-inspect-dialog";
import { TraceCopyIconButton } from "@/shared/components/trace-copy-icon-button";
import { ObserveTableHeaderLabel } from "@/components/observe-table-header-label";
import { toast } from "@/components/ui/feedback";
import { statusBandPillClass } from "@/lib/trace-records";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { defaultObserveDateRange, readStoredObserveDateRange, resolveObserveSinceUntil, writeStoredObserveDateRange } from "@/lib/observe-date-range";
import { parseObserveDateRangeFromListUrl } from "@/lib/observe-list-deep-link";
import {
  loadShellExecList,
  type ShellExecListRow,
} from "@/lib/shell-exec-api";
import {
  loadResourceAuditEvents,
  type ResourceAuditEventRow,
} from "@/lib/resource-audit-records";
import {
  loadSecurityAuditEvents,
  type SecurityAuditEventRow,
} from "@/lib/security-audit-records";
import { getAuditEventTypeColor } from "@/lib/audit-ui-semantics";
import { resolveTraceRowForInspect } from "@/lib/observe-inspect-url";
import { buildSearchParamsString } from "@/lib/url-search-params";
import { cn } from "@/lib/utils";
import {
  OBSERVE_CONTROL_OUTLINE_CLASSNAME,
  OBSERVE_TOOLBAR_HOVER_FG_ICO,
} from "@/lib/observe-table-style";
import { PAGE_SIZE_OPTIONS, readStoredPageSize, writeStoredPageSize } from "@/lib/table-pagination";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { formatShortId } from "@/lib/utils";
import type { TraceRecordRow } from "@/lib/trace-records";
import type { ShellParsedLite } from "@/lib/shell-exec-api";

type TimelineRow = {
  key: string;
  eventType: "command" | "resource" | "policy_hit";
  timeMs: number;
  traceId: string;
  spanId?: string;
  subject: string;
  evidence: string;
  actor: string;
  target: string;
  result: string;
  whyFlagged: string;
  sourcePage: "/command-analysis" | "/resource-audit";
};

type CommandRow = ShellExecListRow & { key: string };
type ResourceRow = ResourceAuditEventRow & { key: string };
type SecurityRow = SecurityAuditEventRow & { key: string };

const EVENT_TYPE_FILTER_VALUES = new Set<TimelineRow["eventType"]>(["command", "resource", "policy_hit"]);

function applyRangeToQuery(sp: URLSearchParams, range: ReturnType<typeof defaultObserveDateRange>): void {
  if (range.kind === "preset" && range.preset === "all") {
    sp.delete("since_ms");
    sp.delete("until_ms");
    sp.set("observe_window", "all");
    return;
  }
  const { sinceMs, untilMs } = resolveObserveSinceUntil(range);
  sp.delete("observe_window");
  if (sinceMs != null && sinceMs > 0) {
    sp.set("since_ms", String(Math.floor(sinceMs)));
  } else {
    sp.delete("since_ms");
  }
  if (untilMs != null && untilMs > 0) {
    sp.set("until_ms", String(Math.floor(untilMs)));
  } else {
    sp.delete("until_ms");
  }
}

function shellRiskTagsForCommandRow(
  p: ShellParsedLite | null | undefined,
  t: (k: string) => string,
): { key: string; color: string; label: string }[] {
  if (!p) {
    return [];
  }
  const out: { key: string; color: string; label: string }[] = [];
  if (p.tokenRisk) {
    out.push({ key: "token", color: "orangered", label: t("riskTag") });
  }
  if (p.commandNotFound) {
    out.push({ key: "cnf", color: "red", label: t("riskChipNotFound") });
  }
  if (p.permissionDenied) {
    out.push({ key: "pd", color: "orangered", label: t("riskChipPerm") });
  }
  if (p.illegalArgHint) {
    out.push({ key: "arg", color: "gold", label: t("riskChipArg") });
  }
  return out;
}

function sourcePageLabel(t: ReturnType<typeof useTranslations>, sourcePage: TimelineRow["sourcePage"]): string {
  if (sourcePage === "/command-analysis") {
    return t("sourcePageCommand");
  }
  if (sourcePage === "/resource-audit") {
    return t("sourcePageResource");
  }
  return t("sourcePageSecurity");
}

function replaceUrlIfChanged(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  current: URLSearchParams,
  nextQs: string,
): void {
  const currentQs = current.toString();
  if (currentQs === nextQs) {
    return;
  }
  router.replace(nextQs ? `${pathname}?${nextQs}` : pathname);
}

function resFlagLabel(
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

function resFlagColor(f: string): string {
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

export function EventsDashboard() {
  const tNav = useTranslations("Nav");
  const t = useTranslations("Events");
  const tCmd = useTranslations("CommandAnalysis");
  const tRes = useTranslations("ResourceAudit");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const traceId = searchParams.get("trace_id")?.trim() ?? "";
  const eventTypeFromUrl = searchParams.get("event_type")?.trim() ?? "";
  const legacyKeywordFromUrl = searchParams.get("keyword")?.trim() ?? "";
  const commandKeywordFromUrl = searchParams.get("keyword_command")?.trim() ?? "";
  const resourceKeywordFromUrl = searchParams.get("keyword_resource")?.trim() ?? "";
  const policyKeywordFromUrl = searchParams.get("keyword_policy_hit")?.trim() ?? "";
  const timelinePageFromUrlRaw = Number.parseInt(searchParams.get("page")?.trim() ?? "1", 10);
  const timelinePageSizeFromUrlRaw = Number.parseInt(searchParams.get("page_size")?.trim() ?? "20", 10);
  const timelinePageFromUrl = Number.isFinite(timelinePageFromUrlRaw) && timelinePageFromUrlRaw > 0 ? timelinePageFromUrlRaw : 1;
  const timelinePageSizeFromUrl =
    Number.isFinite(timelinePageSizeFromUrlRaw) && PAGE_SIZE_OPTIONS.includes(timelinePageSizeFromUrlRaw as any)
      ? timelinePageSizeFromUrlRaw
      : readStoredPageSize(20);
  const fromRiskCenter = searchParams.get("from") === "risk";
  const eventTypeFilterFromQuery = useMemo<TimelineRow["eventType"]>(
    () =>
      eventTypeFromUrl && EVENT_TYPE_FILTER_VALUES.has(eventTypeFromUrl as TimelineRow["eventType"])
        ? (eventTypeFromUrl as TimelineRow["eventType"])
        : "command",
    [eventTypeFromUrl],
  );
  const activeKeywordFromUrl = useMemo(() => {
    if (eventTypeFilterFromQuery === "command") {
      return commandKeywordFromUrl || legacyKeywordFromUrl;
    }
    if (eventTypeFilterFromQuery === "resource") {
      return resourceKeywordFromUrl || legacyKeywordFromUrl;
    }
    return policyKeywordFromUrl || legacyKeywordFromUrl;
  }, [
    commandKeywordFromUrl,
    eventTypeFilterFromQuery,
    legacyKeywordFromUrl,
    policyKeywordFromUrl,
    resourceKeywordFromUrl,
  ]);
  const [mounted, setMounted] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<TimelineRow["eventType"]>(eventTypeFilterFromQuery);
  const [keyword, setKeyword] = useState(activeKeywordFromUrl);
  const [commandDateRange, setCommandDateRange] = useState(defaultObserveDateRange);
  const [resourceDateRange, setResourceDateRange] = useState(defaultObserveDateRange);
  const [policyDateRange, setPolicyDateRange] = useState(defaultObserveDateRange);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [timelinePage, setTimelinePage] = useState(timelinePageFromUrl);
  const [timelinePageSize, setTimelinePageSize] = useState(timelinePageSizeFromUrl);
  const [messageInspectTrace, setMessageInspectTrace] = useState<TraceRecordRow | null>(null);
  const [messageInspectInitialSpanId, setMessageInspectInitialSpanId] = useState<string | null>(null);

  const openMessageInspectFromShellRow = useCallback(async (row: CommandRow) => {
    const traceId = String(row.trace_id ?? "").trim();
    const spanId = String(row.span_id ?? "").trim();
    if (!traceId) {
      return;
    }
    const resolved = await resolveTraceRowForInspect(baseUrl, apiKey, traceId);
    if (!resolved) {
      toast.error(t("openMessageInspectFailed"));
      return;
    }
    setMessageInspectInitialSpanId(spanId);
    setMessageInspectTrace(resolved);
  }, [baseUrl, apiKey, t]);

  const openMessageInspectFromAuditRow = useCallback(async (row: ResourceRow) => {
    const traceId = String(row.trace_id ?? "").trim();
    const spanId = String(row.span_id ?? "").trim();
    if (!traceId) {
      return;
    }
    const resolved = await resolveTraceRowForInspect(baseUrl, apiKey, traceId);
    if (!resolved) {
      toast.error(t("openMessageInspectFailed"));
      return;
    }
    setMessageInspectInitialSpanId(spanId);
    setMessageInspectTrace(resolved);
  }, [baseUrl, apiKey, t]);
  const lastIssuedQsRef = useRef<string>("");
  const observeNowAnchorRef = useRef<number>(Date.now());
  const dateRange = useMemo(() => {
    if (eventTypeFilterFromQuery === "resource") {
      return resourceDateRange;
    }
    if (eventTypeFilterFromQuery === "policy_hit") {
      return policyDateRange;
    }
    return commandDateRange;
  }, [commandDateRange, eventTypeFilterFromQuery, policyDateRange, resourceDateRange]);
  const { sinceMs, untilMs } = useMemo(
    () => resolveObserveSinceUntil(dateRange, observeNowAnchorRef.current),
    [dateRange],
  );
  const filterResetSignature = useMemo(
    () =>
      [
        traceId,
        eventTypeFilterFromQuery,
        activeKeywordFromUrl,
        commandKeywordFromUrl,
        resourceKeywordFromUrl,
        policyKeywordFromUrl,
        dateRange.kind,
        dateRange.kind === "preset" ? dateRange.preset : `${dateRange.startMs}-${dateRange.endMs}`,
      ].join("|"),
    [
      activeKeywordFromUrl,
      eventTypeFilterFromQuery,
      commandKeywordFromUrl,
      resourceKeywordFromUrl,
      policyKeywordFromUrl,
      dateRange,
      traceId,
    ],
  );
  const lastFilterResetSignatureRef = useRef<string>("");

  useEffect(() => {
    setMounted(true);
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    const stored = readStoredObserveDateRange();
    if (stored) {
      setCommandDateRange(stored);
      setResourceDateRange(stored);
      setPolicyDateRange(stored);
    }
  }, []);
  useEffect(() => {
    setEventTypeFilter(eventTypeFilterFromQuery);
  }, [eventTypeFilterFromQuery]);
  useEffect(() => {
    setKeyword(activeKeywordFromUrl);
  }, [activeKeywordFromUrl]);
  const latestSearchParams = useCallback(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search);
    }
    return new URLSearchParams(searchParams.toString());
  }, [searchParams]);
  const getMutableBaseSearchParams = useCallback(() => {
    const pending = lastIssuedQsRef.current.trim();
    if (pending) {
      return new URLSearchParams(pending);
    }
    return latestSearchParams();
  }, [latestSearchParams]);
  useEffect(() => {
    const currentQs = searchParams.toString();
    if (lastIssuedQsRef.current === currentQs) {
      lastIssuedQsRef.current = "";
    }
  }, [searchParams]);
  const replaceUrlIfChangedDedupe = useCallback(
    (current: URLSearchParams, nextQs: string) => {
      const currentQs = current.toString();
      const lastIssued = lastIssuedQsRef.current;
      if (currentQs !== nextQs && lastIssued !== "" && lastIssued === nextQs) {
        return;
      }
      if (currentQs !== nextQs) {
        lastIssuedQsRef.current = nextQs;
      }
      replaceUrlIfChanged(router, pathname, current, nextQs);
    },
    [pathname, router],
  );
  useEffect(() => {
    const eventKeyInUrl = searchParams.get("event_key")?.trim() ?? "";
    if (!eventKeyInUrl) {
      return;
    }
    const qs = buildSearchParamsString(searchParams, {
      event_key: null,
    });
    replaceUrlIfChanged(router, pathname, searchParams, qs);
  }, [pathname, router, searchParams]);

  const setEventTypeFilterInUrl = useCallback(
    (nextType: TimelineRow["eventType"]) => {
      if (nextType === eventTypeFilterFromQuery) {
        return;
      }
      setEventTypeFilter(nextType);
      const currentSp = getMutableBaseSearchParams();
      const qs = buildSearchParamsString(currentSp, {
        event_type: nextType,
        page: null,
      });
      replaceUrlIfChangedDedupe(currentSp, qs);
    },
    [commandDateRange.kind, eventTypeFilterFromQuery, getMutableBaseSearchParams, policyDateRange.kind, replaceUrlIfChangedDedupe, resourceDateRange.kind],
  );
  const setKeywordInUrl = useCallback(
    (nextKeyword: string) => {
      setKeyword(nextKeyword);
      const currentSp = getMutableBaseSearchParams();
      const nextEventType = eventTypeFilterFromQuery;
      const qs = buildSearchParamsString(currentSp, {
        keyword: null,
        keyword_command: nextEventType === "command" ? nextKeyword : undefined,
        keyword_resource: nextEventType === "resource" ? nextKeyword : undefined,
        keyword_policy_hit: nextEventType === "policy_hit" ? nextKeyword : undefined,
        page: null,
      });
      replaceUrlIfChangedDedupe(currentSp, qs);
    },
    [eventTypeFilterFromQuery, getMutableBaseSearchParams, replaceUrlIfChangedDedupe],
  );
  const setDateRangePersist = useCallback(
    (nextRange: ReturnType<typeof defaultObserveDateRange>) => {
      if (eventTypeFilterFromQuery === "resource") {
        setResourceDateRange(nextRange);
      } else if (eventTypeFilterFromQuery === "policy_hit") {
        setPolicyDateRange(nextRange);
      } else {
        setCommandDateRange(nextRange);
      }
      writeStoredObserveDateRange(nextRange);
      const sp = new URLSearchParams(searchParams.toString());
      for (const key of [
        "observe_window",
        "since_ms",
        "until_ms",
        "observe_window_command",
        "since_ms_command",
        "until_ms_command",
        "observe_window_resource",
        "since_ms_resource",
        "until_ms_resource",
        "observe_window_policy_hit",
        "since_ms_policy_hit",
        "until_ms_policy_hit",
      ]) {
        sp.delete(key);
      }
      const qs = sp.toString();
      replaceUrlIfChangedDedupe(searchParams, qs);
    },
    [eventTypeFilterFromQuery, replaceUrlIfChangedDedupe, searchParams],
  );
  const setTimelinePaginationInUrl = useCallback(
    (nextPage: number, nextPageSize: number) => {
      const safePage = Math.max(1, Math.floor(nextPage) || 1);
      const safePageSize = [20, 50, 100].includes(nextPageSize) ? nextPageSize : 20;
      const currentSp = getMutableBaseSearchParams();
      const qs = buildSearchParamsString(currentSp, {
        page: safePage === 1 ? null : String(safePage),
        page_size: safePageSize === 20 ? null : String(safePageSize),
      });
      replaceUrlIfChangedDedupe(currentSp, qs);
    },
    [getMutableBaseSearchParams, replaceUrlIfChangedDedupe, timelinePage, timelinePageSize],
  );

  const enabled = mounted && Boolean(baseUrl.trim());
  const timelineOffset = useMemo(() => Math.max(0, (timelinePage - 1) * timelinePageSize), [timelinePage, timelinePageSize]);
  
  // Smart search detection: determine if keyword is step_id(span_id), message_id(trace_id), or generic keyword.
  const searchDetection = useMemo(() => {
    const raw = activeKeywordFromUrl.trim();
    if (!raw) {
      return { type: "none" as const, value: undefined };
    }
    const prefixedMatch = raw.match(/^(message|msg|trace|step|span|execution_step)\s*[:=]\s*(.+)$/i);
    if (prefixedMatch) {
      const prefix = prefixedMatch[1]!.toLowerCase();
      const value = prefixedMatch[2]!.trim();
      if (!value) {
        return { type: "none" as const, value: undefined };
      }
      if (prefix === "message" || prefix === "msg" || prefix === "trace") {
        return { type: "trace_id" as const, value };
      }
      return { type: "span_id" as const, value };
    }

    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
    if (looksLikeUuid) {
      return { type: "uuid_ambiguous" as const, value: raw.toLowerCase() };
    }

    const normalized = raw.replace(/-/g, "");
    if (/^[a-f0-9]{8,16}$/i.test(normalized)) {
      return { type: "span_id" as const, value: normalized };
    }
    if (/^[a-f0-9]{32,}$/i.test(normalized)) {
      return { type: "trace_id" as const, value: normalized };
    }

    return { type: "keyword" as const, value: raw };
  }, [activeKeywordFromUrl]);
  const commandTraceIdParam = traceId || (searchDetection.type === "trace_id" ? searchDetection.value : undefined) || undefined;
  const commandSpanIdParam = searchDetection.type === "span_id" ? searchDetection.value : undefined;
  const commandContainsParam = searchDetection.type === "keyword" ? searchDetection.value : undefined;
  const commandUuidAmbiguousParam = searchDetection.type === "uuid_ambiguous" ? searchDetection.value : undefined;

  const resourceTraceIdParam =
    traceId || (searchDetection.type === "trace_id" ? searchDetection.value : undefined) || undefined;
  const resourceSpanIdParam = searchDetection.type === "span_id" ? searchDetection.value : undefined;
  const resourceSearchParam = searchDetection.type === "keyword" ? searchDetection.value : undefined;
  const resourceUuidAmbiguousParam = searchDetection.type === "uuid_ambiguous" ? searchDetection.value : undefined;

  const commandQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.shellExecList, baseUrl, apiKey, { sinceMs, untilMs, traceId: commandTraceIdParam, spanId: commandSpanIdParam, commandContains: commandContainsParam, uuidAmbiguous: commandUuidAmbiguousParam, limit: timelinePageSize, offset: timelineOffset, order: "desc" as const }],
    queryFn: async () => {
      const common = {
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: timelinePageSize,
        offset: timelineOffset,
        order: "desc" as const,
      };
      if (commandUuidAmbiguousParam) {
        const traceFirst = await loadShellExecList(baseUrl, apiKey, {
          ...common,
          traceId: commandUuidAmbiguousParam,
        });
        if (traceFirst.total > 0) {
          return traceFirst;
        }
        const spanFallback = await loadShellExecList(baseUrl, apiKey, {
          ...common,
          spanId: commandUuidAmbiguousParam,
        });
        return spanFallback;
      }
      return loadShellExecList(baseUrl, apiKey, {
        ...common,
        traceId: commandTraceIdParam,
        spanId: commandSpanIdParam,
        commandContains: commandContainsParam,
      });
    },
    enabled: enabled && eventTypeFilterFromQuery === "command",
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const resourceQuery = useQuery({
    queryKey: [
      COLLECTOR_QUERY_SCOPE.resourceAuditEvents,
      baseUrl,
      apiKey,
      {
        sinceMs,
        untilMs,
        trace_id: resourceTraceIdParam,
        span_id: resourceSpanIdParam,
        search: resourceSearchParam,
        uuidAmbiguous: resourceUuidAmbiguousParam,
        limit: timelinePageSize,
        offset: timelineOffset,
        order: "desc" as const,
        semantic_class: "all" as const,
        uri_prefix: undefined,
      },
    ],
    queryFn: async () => {
      const common = {
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
        limit: timelinePageSize,
        offset: timelineOffset,
        order: "desc" as const,
        semantic_class: "all" as const,
        uri_prefix: undefined,
      };
      if (resourceUuidAmbiguousParam) {
        const traceFirst = await loadResourceAuditEvents(baseUrl, apiKey, {
          ...common,
          trace_id: resourceUuidAmbiguousParam,
        });
        if (traceFirst.total > 0) {
          return traceFirst;
        }
        return loadResourceAuditEvents(baseUrl, apiKey, {
          ...common,
          span_id: resourceUuidAmbiguousParam,
        });
      }
      return loadResourceAuditEvents(baseUrl, apiKey, {
        ...common,
        trace_id: resourceTraceIdParam,
        span_id: resourceSpanIdParam,
        search: resourceSearchParam,
      });
    },
    enabled: enabled && eventTypeFilterFromQuery === "resource",
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const securityQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.securityAuditEvents, baseUrl, apiKey, { sinceMs, untilMs, traceId: traceId || undefined, limit: timelinePageSize, offset: timelineOffset, order: "desc" as const }],
    queryFn: () => loadSecurityAuditEvents(baseUrl, apiKey, {
      sinceMs: sinceMs ?? undefined,
      untilMs: untilMs ?? undefined,
      traceId: traceId || undefined,
      limit: timelinePageSize,
      offset: timelineOffset,
      order: "desc",
    }),
    enabled: enabled && eventTypeFilterFromQuery === "policy_hit",
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (lastFilterResetSignatureRef.current === filterResetSignature) {
      return;
    }
    lastFilterResetSignatureRef.current = filterResetSignature;
    if (timelinePageFromUrl === 1) {
      return;
    }
    setTimelinePaginationInUrl(1, timelinePageSize);
  }, [filterResetSignature, timelinePageFromUrl, timelinePageSize, traceId, sinceMs, untilMs, eventTypeFilterFromQuery, activeKeywordFromUrl, setTimelinePaginationInUrl]);

  const activeQuery = useMemo(() => {
    if (eventTypeFilterFromQuery === "command") return commandQuery;
    if (eventTypeFilterFromQuery === "resource") return resourceQuery;
    return securityQuery;
  }, [eventTypeFilterFromQuery, commandQuery, resourceQuery, securityQuery]);

  const rows = useMemo(() => {
    if (eventTypeFilterFromQuery === "command") {
      return (commandQuery.data?.items ?? []).map<CommandRow>((r) => ({
        ...r,
        key: String(r.span_id ?? ""),
      }));
    }
    if (eventTypeFilterFromQuery === "resource") {
      return (resourceQuery.data?.items ?? []).map<ResourceRow>((r) => ({
        ...r,
        key: String(r.span_id ?? ""),
      }));
    }
    return (securityQuery.data?.items ?? []).map<SecurityRow>((r) => ({
      ...r,
      key: String(r.id ?? ""),
    }));
  }, [eventTypeFilterFromQuery, commandQuery.data?.items, resourceQuery.data?.items, securityQuery.data?.items]) as CommandRow[] | ResourceRow[] | SecurityRow[];
  const [selectedKey, setSelectedKey] = useState<string>("");
  useEffect(() => {
    if (rows.length === 0) {
      if (selectedKey !== "") {
        setSelectedKey("");
      }
      return;
    }
    if (selectedKey) {
      return;
    }
    const fallback = rows[0]!.key;
    setSelectedKey(fallback);
  }, [rows, selectedKey]);

  const commandColumns: TableColumnProps<CommandRow>[] = [
    {
      title: (
        <ObserveTableHeaderLabel>
          <span className="inline-flex items-center gap-1">
            {tCmd("colStepId")}
            <IconClockCircle className="size-3 shrink-0 text-neutral-400" aria-hidden />
          </span>
        </ObserveTableHeaderLabel>
      ),
      width: 230,
      fixed: "left" as const,
      dataIndex: "start_time_ms",
      key: "start_time_ms",
      sorter: (a: CommandRow, b: CommandRow) => {
        const timeA = a.start_time_ms != null && Number.isFinite(a.start_time_ms) ? Number(a.start_time_ms) : 0;
        const timeB = b.start_time_ms != null && Number.isFinite(b.start_time_ms) ? Number(b.start_time_ms) : 0;
        return timeA - timeB;
      },
      sortDirections: ["descend", "ascend"],
      render: (_: unknown, row: CommandRow) => (
        <div className="flex flex-col items-start gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="cursor-pointer text-xs text-neutral-800 hover:underline"
              onClick={() => {
                void openMessageInspectFromShellRow(row);
              }}
            >
              {formatShortId(row.span_id)}
            </span>
            <TraceCopyIconButton
              text={row.span_id || ""}
              ariaLabel={t("copy")}
              tooltipLabel={t("copy")}
              successLabel={t("copySuccessToast")}
              className="shrink-0 p-1 hover:bg-neutral-100"
              stopPropagation
            />
          </div>
          {row.start_time_ms != null && Number.isFinite(row.start_time_ms) ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <IconClockCircle className="size-3 shrink-0" aria-hidden />
              <span className="tabular-nums">{formatTraceDateTimeFromMs(Number(row.start_time_ms))}</span>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: <ObserveTableHeaderLabel>{tCmd("colCommand")}</ObserveTableHeaderLabel>,
      render: (_: unknown, row: CommandRow) => {
        const command = row.parsed?.command || "—";
        const isLong = command.length > 100 || command.split("\n").length > 2;
        const content = (
          <div
            className="text-xs"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {command}
          </div>
        );
        const riskTags = shellRiskTagsForCommandRow(row.parsed, tCmd);
        return (
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {isLong ? (
              <Popover content={<div className="max-w-md break-all text-xs">{command}</div>}>{content}</Popover>
            ) : (
              content
            )}
            {riskTags.length > 0 ? (
              <div className="flex max-w-full flex-wrap gap-1">
                {riskTags.map((rt) => (
                  <Tag key={rt.key} color={rt.color} className="!m-0 !rounded-md px-1.5 py-0.5 text-[10px] leading-tight">
                    {rt.label}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: <ObserveTableHeaderLabel>{tCmd("colCategory")}</ObserveTableHeaderLabel>,
      width: 100,
      render: (_: unknown, row: CommandRow) => {
        const raw = row.parsed?.category;
        const s = raw != null && String(raw).trim() !== "" ? String(raw) : "";
        return s || "—";
      },
    },
    {
      title: <ObserveTableHeaderLabel>{tCmd("colDur")}</ObserveTableHeaderLabel>,
      width: 88,
      dataIndex: "duration_ms",
      key: "duration_ms",
      sorter: (a: CommandRow, b: CommandRow) => {
        const durA = a.duration_ms != null && Number.isFinite(a.duration_ms) ? Number(a.duration_ms) : 0;
        const durB = b.duration_ms != null && Number.isFinite(b.duration_ms) ? Number(b.duration_ms) : 0;
        return durA - durB;
      },
      sortDirections: ["descend", "ascend"],
      render: (_: unknown, row: CommandRow) => {
        const dur = row.duration_ms != null && Number.isFinite(row.duration_ms) ? Number(row.duration_ms) : null;
        const startTimeMs = row.start_time_ms != null && Number.isFinite(row.start_time_ms) ? Number(row.start_time_ms) : null;
        const endTimeMs = startTimeMs != null && dur != null ? startTimeMs + dur : null;
        
        // Format duration with adaptive units
        const formatDuration = (ms: number | null): string => {
          if (ms == null) return "—";
          if (ms >= 60000) {
            return `${(ms / 60000).toFixed(2)} min`;
          }
          if (ms >= 1000) {
            return `${(ms / 1000).toFixed(2)} s`;
          }
          return `${ms} ms`;
        };
        
        const durationTooltipContent = (
          <div className="max-w-[22rem] space-y-2 px-3 py-2 text-left text-xs text-foreground">
            <div className="font-medium">{tCmd("colDur")}</div>
            {startTimeMs != null && endTimeMs != null ? (
              <div className="space-y-1 text-[10px] leading-snug tabular-nums">
                <p className="m-0">
                  {tCmd("colDurStart")}: {formatTraceDateTimeFromMs(startTimeMs)}
                </p>
                <p className="m-0">
                  {tCmd("colDurEnd")}: {formatTraceDateTimeFromMs(endTimeMs)}
                </p>
              </div>
            ) : (
              <p className="m-0 text-[10px] leading-snug opacity-90">—</p>
            )}
          </div>
        );
        return (
          <Popover trigger="hover" position="rt" content={durationTooltipContent}>
            <span className="inline-flex max-w-full cursor-default items-center gap-0.5 rounded-sm text-left text-neutral-600 hover:text-neutral-900 whitespace-nowrap">
              <IconClockCircle className="size-3 shrink-0 text-neutral-400" aria-hidden />
              <span className="text-xs tabular-nums">
                {formatDuration(dur)}
              </span>
            </span>
          </Popover>
        );
      },
    },
    {
      title: <ObserveTableHeaderLabel>{tCmd("colStatus")}</ObserveTableHeaderLabel>,
      width: 108,
      render: (_: unknown, row: CommandRow) => {
        const ok = row.parsed?.success;
        const ec = row.parsed?.exitCode;
        const commandNotFound = row.parsed?.commandNotFound;
        const permissionDenied = row.parsed?.permissionDenied;
        
        if (ok === true) {
          return (
            <span className="inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-900 ring-1 ring-emerald-500/25">
              {tCmd("statusSuccess")}
            </span>
          );
        }
        if (ok === false) {
          const errorDetails = [];
          if (ec != null && Number.isFinite(ec)) errorDetails.push(`Exit code: ${ec}`);
          if (commandNotFound) errorDetails.push("Command not found");
          if (permissionDenied) errorDetails.push("Permission denied");
          
          const errorTooltipContent = (
            <div className="max-w-[22rem] space-y-2 px-3 py-2 text-left text-xs text-foreground">
              <div className="font-medium">{tCmd("statusFailure")}</div>
              {errorDetails.length > 0 ? (
                <div className="space-y-1 text-[10px] leading-snug">
                  {errorDetails.map((detail, idx) => (
                    <p key={idx} className="m-0">{detail}</p>
                  ))}
                </div>
              ) : (
                <p className="m-0 text-[10px] leading-snug opacity-90">—</p>
              )}
            </div>
          );
          
          return (
            <Popover trigger="hover" position="rt" content={errorTooltipContent}>
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium bg-red-500/15 text-red-800 ring-1 ring-red-500/25">
                  {tCmd("statusFailure")}
                </span>
                <IconExclamationCircle className="size-3 shrink-0 text-red-500" aria-hidden />
              </span>
            </Popover>
          );
        }
        return "—";
      },
    },
  ];

  const resourceColumns: TableColumnProps<ResourceRow>[] = [
    {
      title: (
        <ObserveTableHeaderLabel>
          <span className="inline-flex items-center gap-1">
            {tRes("colStepId")}
            <IconClockCircle className="size-3 shrink-0 text-neutral-400" aria-hidden />
          </span>
        </ObserveTableHeaderLabel>
      ),
      dataIndex: "started_at_ms",
      key: "span_id_with_time",
      fixed: "left",
      width: 230,
      sorter: (a: ResourceRow, b: ResourceRow) => {
        const timeA = a.started_at_ms != null && Number.isFinite(a.started_at_ms) ? Number(a.started_at_ms) : 0;
        const timeB = b.started_at_ms != null && Number.isFinite(b.started_at_ms) ? Number(b.started_at_ms) : 0;
        return timeA - timeB;
      },
      sortDirections: ["descend", "ascend"],
      render: (_: unknown, row: ResourceRow) => (
        <div className="flex flex-col items-start gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="cursor-pointer text-xs text-neutral-800 hover:underline"
              onClick={() => {
                void openMessageInspectFromAuditRow(row);
              }}
            >
              {formatShortId(row.span_id)}
            </span>
            <TraceCopyIconButton
              text={row.span_id || ""}
              ariaLabel={t("copy")}
              tooltipLabel={t("copy")}
              successLabel={t("copySuccessToast")}
              className="shrink-0 p-1 hover:bg-neutral-100"
              stopPropagation
            />
          </div>
          {row.started_at_ms != null && Number.isFinite(row.started_at_ms) ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <IconClockCircle className="size-3 shrink-0" aria-hidden />
              <span className="tabular-nums">{formatTraceDateTimeFromMs(Number(row.started_at_ms))}</span>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: <ObserveTableHeaderLabel>{tRes("colUri")}</ObserveTableHeaderLabel>,
      dataIndex: "resource_uri",
      key: "resource_uri",
      width: 360,
      render: (uri: string, row: ResourceRow) => {
        const displayUri = uri || "—";
        const isLong = displayUri.length > 60 || displayUri.split('\n').length > 2;
        const flags = row.risk_flags ?? [];
        const content = (
          <div className="text-xs" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayUri}
          </div>
        );
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              {isLong ? (
                <Popover content={<div className="max-w-md break-all text-xs">{displayUri}</div>}>
                  {content}
                </Popover>
              ) : (
                content
              )}
            </div>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {flags.map((f) => (
                  <Tag key={f} size="small" color={resFlagColor(f)} className="rounded-full px-2 py-0.5 text-[10px]">
                    {resFlagLabel(tRes, f)}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: <ObserveTableHeaderLabel>{tRes("colClass")}</ObserveTableHeaderLabel>,
      dataIndex: "semantic_class",
      key: "semantic_class",
      width: 80,
      render: (c: string) => <span className="text-xs">{c}</span>,
    },
    {
      title: <ObserveTableHeaderLabel>{tRes("colExecType")}</ObserveTableHeaderLabel>,
      dataIndex: "span_name",
      key: "span_name",
      width: 80,
      ellipsis: true,
      render: (name: string) => (
        <Typography.Text className="text-xs" ellipsis={{ showTooltip: true }}>
          {name || "—"}
        </Typography.Text>
      ),
    },
    {
      title: <ObserveTableHeaderLabel>{tRes("colDuration")}</ObserveTableHeaderLabel>,
      dataIndex: "duration_ms",
      key: "duration_ms",
      width: 96,
      sorter: (a: ResourceRow, b: ResourceRow) => {
        const durA = a.duration_ms != null && Number.isFinite(a.duration_ms) ? Number(a.duration_ms) : 0;
        const durB = b.duration_ms != null && Number.isFinite(b.duration_ms) ? Number(b.duration_ms) : 0;
        return durA - durB;
      },
      sortDirections: ["descend", "ascend"],
      render: (n: number | null) => (
        <span className="inline-flex items-center gap-0.5 text-xs">
          <IconClockCircle className="size-3 shrink-0 text-neutral-400" aria-hidden />
          <span className="tabular-nums">{n != null ? `${Math.round(n)} ms` : "—"}</span>
        </span>
      ),
    },
    {
      title: <ObserveTableHeaderLabel>{tRes("colChars")}</ObserveTableHeaderLabel>,
      dataIndex: "chars",
      key: "chars",
      width: 100,
      render: (n: number | null) => (
        <span className="tabular-nums text-xs">{n != null ? n.toLocaleString() : "—"}</span>
      ),
    },
  ];

  const securityColumns: TableColumnProps<SecurityRow>[] = [
    {
      title: t("policyId"),
      dataIndex: "id",
      key: "id",
      width: 120,
      render: (_: unknown, row: SecurityRow) => (
        <span className="text-xs">{formatShortId(row.id)}</span>
      ),
    },
    {
      title: t("policySpanId"),
      dataIndex: "span_id",
      key: "span_id",
      width: 120,
      render: (_: unknown, row: SecurityRow) => (
        <span className="text-xs">{row.span_id ? formatShortId(row.span_id) : "—"}</span>
      ),
    },
    {
      title: t("policyHitTime"),
      dataIndex: "created_at_ms",
      key: "created_at_ms",
      width: 160,
      render: (_: unknown, row: SecurityRow) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatTraceDateTimeFromMs(row.created_at_ms)}
        </span>
      ),
    },
    {
      title: t("policyName"),
      dataIndex: "findings_json",
      key: "policy_name",
      width: 200,
      render: (_: unknown, row: SecurityRow) => {
        const findings = JSON.parse(row.findings_json || "[]");
        const policyName = findings[0]?.policy_name || "—";
        return <span className="text-xs">{policyName}</span>;
      },
    },
    {
      title: t("policyAction"),
      dataIndex: "findings_json",
      key: "policy_action",
      width: 120,
      render: (_: unknown, row: SecurityRow) => {
        const findings = JSON.parse(row.findings_json || "[]");
        const action = findings[0]?.policy_action || "—";
        return <span className="text-xs">{action}</span>;
      },
    },
    {
      title: t("policyScope"),
      dataIndex: "workspace_name",
      key: "workspace_name",
      width: 150,
      render: (_: unknown, row: SecurityRow) => (
        <span className="text-xs">{row.workspace_name || "—"}</span>
      ),
    },
  ];

  const columns = useMemo(() => {
    if (eventTypeFilterFromQuery === "command") return commandColumns;
    if (eventTypeFilterFromQuery === "resource") return resourceColumns;
    return securityColumns;
  }, [eventTypeFilterFromQuery, commandColumns, resourceColumns, securityColumns, tCmd, tRes]);

  return (
    <AppPageShell variant="overview">
      <main className="ca-page relative z-[1] space-y-5 pb-10">
        <header className="space-y-4">
          {fromRiskCenter ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-blue-600 dark:text-blue-400">{t("fromRiskCenterLabel")}</span>
                  <LocalizedLink href="/risk-center" className="font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                    {t("backToRiskCenter")} →
                  </LocalizedLink>
                </div>
                <Button type="text" size="mini" className="text-blue-600 dark:text-blue-400" onClick={() => router.push("/risk-center")}>
                  ✕
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Typography.Title heading={3} className="ca-page-title !m-0 text-2xl font-semibold">
                {tNav("events")}
              </Typography.Title>
              <Popover
                content={
                  <div className="max-w-md p-2">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">🧭</span>
                      {t("investigationGuideTitle")}
                    </div>
                    <div className="flex flex-wrap gap-6">
                      <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600 dark:bg-blue-900/30">1</span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t("investigationGuideStep1")}</span>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-600 dark:bg-amber-900/30">2</span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t("investigationGuideStep2")}</span>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800/50">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-600 dark:bg-green-900/30">3</span>
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t("investigationGuideStep3")}</span>
                      </div>
                    </div>
                  </div>
                }
                trigger="hover"
                position="bottom"
              >
                <IconQuestionCircle className="h-5 w-5 cursor-help text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
              </Popover>
            </div>
          </div>
        </header>

        {!enabled || activeQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spin />
          </div>
        ) : activeQuery.isError ? (
          <Card>
            <div className="space-y-2 py-2 text-sm">
              <Typography.Text>{t("loadErrorTitle")}</Typography.Text>
              <Typography.Text type="secondary">{t("loadErrorBody")}</Typography.Text>
              <div>
                <Button
                  size="small"
                  onClick={() => {
                    void activeQuery.refetch();
                  }}
                >
                  {t("retry")}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <section className="mb-4 space-y-3">
              <div role="radiogroup" aria-label={t("eventTypeFilterLabel")} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={eventTypeFilter === "command"}
                  onClick={() => setEventTypeFilterInUrl("command")}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
                    eventTypeFilter === "command"
                      ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                      : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100",
                  )}
                >
                  <span className="whitespace-nowrap">{t("eventType_command")}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={eventTypeFilter === "resource"}
                  onClick={() => setEventTypeFilterInUrl("resource")}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
                    eventTypeFilter === "resource"
                      ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                      : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100",
                  )}
                >
                  <span className="whitespace-nowrap">{t("eventType_resource")}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={eventTypeFilter === "policy_hit"}
                  onClick={() => setEventTypeFilterInUrl("policy_hit")}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
                    eventTypeFilter === "policy_hit"
                      ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                      : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100",
                  )}
                >
                  <span className="whitespace-nowrap">{t("eventType_policy_hit")}</span>
                </button>
              </div>
              <div className="rounded-xl border border-neutral-200/90 bg-neutral-50/40 p-2 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/25 sm:p-2.5">
                <div className="flex flex-wrap items-center gap-2 gap-y-3 xl:flex-nowrap">
                  <div className="flex min-w-[min(100%,18rem)] max-w-[min(80rem,94vw)] shrink flex-1 basis-[min(100%,44rem)] items-center gap-2 sm:min-w-[22rem] md:basis-[min(100%,48rem)] lg:max-w-[min(88rem,94vw)]">
                    <div className="group/sch relative min-w-[12rem] flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">
                        <IconSearch
                          className={cn(
                            "h-4 w-4 text-neutral-500 transition-colors duration-150 dark:text-zinc-500",
                            "group-focus-within/sch:text-neutral-950 dark:group-focus-within/sch:text-zinc-50",
                          )}
                          aria-hidden
                        />
                      </span>
                      <input
                        type="search"
                        value={keyword}
                        onChange={(e) => setKeywordInUrl(e.target.value)}
                        placeholder={t("keywordPlaceholder")}
                        className={cn(
                          "h-9 w-full rounded-md border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-800 shadow-sm outline-none transition-[color,box-shadow,border-color] placeholder:text-neutral-400 focus-visible:border-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-300/60 dark:border-zinc-600 dark:bg-zinc-950/50 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus-visible:border-zinc-500 dark:focus-visible:ring-zinc-600/50",
                          "group-hover/sch:placeholder:text-neutral-500 dark:group-hover/sch:placeholder:text-zinc-500",
                        )}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
                    <ObserveDateRangeTrigger value={dateRange} onChange={setDateRangePersist} />
                    <Button
                      type="outline"
                      size="small"
                      disabled={activeQuery.isFetching}
                      onClick={() => void activeQuery.refetch()}
                      title={t("refresh")}
                      aria-label={t("refresh")}
                      aria-busy={activeQuery.isFetching}
                      className={cn(
                        "group/ico rounded-md bg-white shadow-sm dark:bg-zinc-950/50",
                        OBSERVE_CONTROL_OUTLINE_CLASSNAME,
                        activeQuery.isFetching && "disabled:!opacity-100",
                      )}
                    >
                      <IconRefresh
                        className={cn(
                          "h-4 w-4 origin-center text-neutral-500 transition-colors duration-150 dark:text-zinc-400",
                          OBSERVE_TOOLBAR_HOVER_FG_ICO,
                          "will-change-transform",
                          activeQuery.isFetching && "motion-reduce:animate-none motion-reduce:opacity-80 animate-spin",
                        )}
                        aria-hidden
                      />
                    </Button>
                  </div>
                </div>
              </div>
            </section>
            {rows.length > 0 ? (
              <>
                <Table
                  rowKey="key"
                  size="small"
                  columns={columns as any}
                  data={rows as any}
                  pagination={false}
                  style={{ marginBottom: 40 }}
                  rowClassName={(record) =>
                    (record as any).key === selectedKey
                      ? "!bg-blue-50 dark:!bg-blue-900/20"
                      : ""
                  }
                  onRow={(record) => ({
                    onClick: () => {
                      const next = (record as any).key;
                      setSelectedKey(next);
                    },
                  })}
                />
                <div
                  className="fixed bottom-0 right-0 z-30 border-t border-border/80 bg-background/90 py-3 shadow-[0_-8px_28px_-12px_rgba(15,23,42,0.12)] backdrop-blur-md supports-[backdrop-filter]:bg-background/80 dark:border-border/55 dark:shadow-black/25"
                  style={{ left: "var(--ca-content-offset-left)" }}
                >
                  <div className="mx-auto flex w-full max-w-[min(100%,1600px)] flex-col gap-3 px-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5 lg:px-6">
                    <p className="text-sm text-muted-foreground">
                      {t("showingOfTotal", {
                        from: String((timelinePage - 1) * timelinePageSize + 1),
                        to: String(rows.length ? (timelinePage - 1) * timelinePageSize + rows.length : 0),
                        total: String(activeQuery.data?.total ?? 0),
                      })}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {t("paginationTotalPages", {
                          count: String(Math.max(1, Math.ceil((activeQuery.data?.total ?? 0) / timelinePageSize) || 1)),
                        })}
                      </span>
                      <ArcoPagination
                        className={cn("observe-traces-list-pagination", "mx-0")}
                        size="small"
                        current={timelinePage}
                        pageSize={timelinePageSize}
                        total={activeQuery.data?.total ?? 0}
                        disabled={activeQuery.isFetching}
                        bufferSize={1}
                        sizeCanChange
                        sizeOptions={[...PAGE_SIZE_OPTIONS]}
                        showJumper
                        onChange={(page, ps) => {
                          setTimelinePage(page);
                          if (ps && ps !== timelinePageSize) {
                            setTimelinePageSize(ps);
                            writeStoredPageSize(ps);
                          }
                          setTimelinePaginationInUrl(page, ps || timelinePageSize);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800/30">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl dark:bg-gray-800">📋</div>
                <p className="text-base font-medium text-gray-800 dark:text-gray-200 mb-2">
                  {traceId ? t("emptyTimelineForTrace") : t("emptyTimeline")}
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  {t("emptyTimelineHint")}
                </p>
              </div>
            )}
          </>
        )}
      </main>

      <TraceRecordInspectDialog
        open={messageInspectTrace != null}
        onOpenChange={(next) => {
          if (!next) {
            setMessageInspectTrace(null);
            setMessageInspectInitialSpanId(null);
          }
        }}
        row={messageInspectTrace}
        initialSpanId={messageInspectInitialSpanId}
        rows={messageInspectTrace ? [messageInspectTrace] : []}
        onNavigate={(r) => {
          setMessageInspectTrace(r);
          setMessageInspectInitialSpanId(null);
        }}
        baseUrl={baseUrl}
        apiKey={apiKey}
      />
    </AppPageShell>
  );
}
