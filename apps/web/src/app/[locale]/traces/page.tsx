"use client";

import { useTranslations } from "next-intl";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint, TitleHintIcon } from "@/components/message-hint";
import { loadCollectorUrl, loadApiKey } from "@/lib/collector";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import {
  formatDurationMs,
  formatOptimizationRate,
  loadTraceRecords,
  statusBandLabel,
  statusBandPillClass,
  traceRecordAgentName,
  traceRecordChannel,
  traceRecordDurationMs,
  traceRecordStatusBand,
  traceRecordTaskSummary,
  type TraceRecordRow,
} from "@/lib/trace-records";

const PAGE_LIMIT = 80;
/** Loops strictly greater than 5 → at least 6 AGENT_LOOP spans */
const ANOMALY_MIN_LOOPS = 6;
/** Tokens strictly greater than 5000 */
const ANOMALY_MIN_TOKENS = 5001;
/** Many tool calls */
const ANOMALY_MIN_TOOLS = 15;
const DEFAULT_TOKEN_WARN = 8000;

function detailHref(row: TraceRecordRow): string {
  return `/traces/${encodeURIComponent(row.thread_key)}`;
}

function sessionLine(row: TraceRecordRow): string {
  const sid = row.session_id?.trim();
  if (sid) {
    return sid.length > 40 ? `${sid.slice(0, 18)}…${sid.slice(-10)}` : sid;
  }
  const tk = row.thread_key?.trim();
  if (tk) {
    return tk.length > 44 ? `${tk.slice(0, 20)}…${tk.slice(-12)}` : tk;
  }
  return "—";
}

export default function TracesPage() {
  const t = useTranslations("Traces");
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [tokenWarnAt, setTokenWarnAt] = useState(DEFAULT_TOKEN_WARN);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [minLoopsFilter, setMinLoopsFilter] = useState<number | undefined>(undefined);
  const [minTokensFilter, setMinTokensFilter] = useState<number | undefined>(undefined);
  const [minToolsFilter, setMinToolsFilter] = useState<number | undefined>(undefined);
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSearchApplied(searchDraft.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      void queryClient.invalidateQueries({ queryKey: ["trace-records"] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const order = liveMode ? "asc" : "desc";

  const queryKey = useMemo(
    () =>
      [
        "trace-records",
        baseUrl,
        apiKey,
        order,
        searchApplied,
        minLoopsFilter ?? null,
        minTokensFilter ?? null,
        minToolsFilter ?? null,
      ] as const,
    [baseUrl, apiKey, order, searchApplied, minLoopsFilter, minTokensFilter, minToolsFilter],
  );

  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      loadTraceRecords(baseUrl, apiKey, {
        limit: PAGE_LIMIT,
        offset: pageParam,
        order,
        minLoopCount: minLoopsFilter,
        minTotalTokens: minTokensFilter,
        minToolCalls: minToolsFilter,
        search: searchApplied.length > 0 ? searchApplied : undefined,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.items.length < PAGE_LIMIT) {
        return undefined;
      }
      return allPages.reduce((acc, p) => acc + p.items.length, 0);
    },
    enabled: mounted && baseUrl.trim().length > 0,
    refetchInterval: liveMode ? 2800 : 12_000,
    staleTime: 0,
  });

  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data?.pages]);

  useEffect(() => {
    if (!liveMode || !q.isSuccess || rows.length === 0) {
      return;
    }
    const el = scrollBoxRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [liveMode, q.dataUpdatedAt, q.isSuccess, rows.length]);

  const rawCount = rows.length;
  const lastUpdated =
    q.dataUpdatedAt > 0 ? formatTraceDateTimeLocal(new Date(q.dataUpdatedAt).toISOString()) : null;

  const missingUrl = mounted && baseUrl.trim().length === 0;

  const clearFilters = useCallback(() => {
    setMinLoopsFilter(undefined);
    setMinTokensFilter(undefined);
    setMinToolsFilter(undefined);
    setSearchDraft("");
    setSearchApplied("");
  }, []);

  const filtersActive =
    minLoopsFilter != null ||
    minTokensFilter != null ||
    minToolsFilter != null ||
    searchApplied.length > 0;

  if (!mounted) {
    return (
      <main className="ca-page">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded-lg bg-neutral-200" />
          <div className="h-4 w-96 max-w-full rounded bg-neutral-200" />
        </div>
        <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
      </main>
    );
  }

  return (
    <main className="ca-page">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-3xl font-semibold tracking-tight text-neutral-900">
            <span>{t("title")}</span>
            <TitleHintIcon tooltipText={t("subtitle")} />
          </h1>
        </div>
        <LocalizedLink href="/settings" className="ca-btn-secondary shrink-0 no-underline">
          {t("openSettings")}
        </LocalizedLink>
      </header>

      {missingUrl && (
        <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-950">
          <MessageHint
            text={t("needCollectorUrl")}
            textClassName="text-sm leading-relaxed text-amber-950"
            clampClass="line-clamp-4"
          />
          <LocalizedLink href="/settings" className="mt-2 inline-block font-medium text-ca-accent no-underline hover:underline">
            {t("openSettings")}
          </LocalizedLink>
        </div>
      )}

      {!missingUrl && (
        <section className="mb-6 space-y-4 rounded-2xl border border-ca-border bg-white/90 px-5 py-4 shadow-ca-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[min(100%,16rem)] flex-1">
              <label htmlFor="trace-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ca-muted">
                {t("searchLabel")}
              </label>
              <input
                id="trace-search"
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full rounded-xl border border-ca-border bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none ring-ca-accent/30 placeholder:text-neutral-400 focus:ring-2"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ca-muted">{t("filterAnomalyTitle")}</span>
              <button
                type="button"
                onClick={() => setMinLoopsFilter((v) => (v === ANOMALY_MIN_LOOPS ? undefined : ANOMALY_MIN_LOOPS))}
                className={[
                  "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                  minLoopsFilter === ANOMALY_MIN_LOOPS
                    ? "border-ca-accent bg-ca-accent/10 text-ca-accent"
                    : "border-ca-border bg-white text-neutral-700 hover:bg-neutral-50",
                ].join(" ")}
              >
                {t("filterAnomalyLoops")}
              </button>
              <button
                type="button"
                onClick={() => setMinTokensFilter((v) => (v === ANOMALY_MIN_TOKENS ? undefined : ANOMALY_MIN_TOKENS))}
                className={[
                  "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                  minTokensFilter === ANOMALY_MIN_TOKENS
                    ? "border-ca-accent bg-ca-accent/10 text-ca-accent"
                    : "border-ca-border bg-white text-neutral-700 hover:bg-neutral-50",
                ].join(" ")}
              >
                {t("filterAnomalyTokens")}
              </button>
              <button
                type="button"
                onClick={() => setMinToolsFilter((v) => (v === ANOMALY_MIN_TOOLS ? undefined : ANOMALY_MIN_TOOLS))}
                className={[
                  "rounded-lg border px-3 py-2 text-xs font-semibold transition",
                  minToolsFilter === ANOMALY_MIN_TOOLS
                    ? "border-ca-accent bg-ca-accent/10 text-ca-accent"
                    : "border-ca-border bg-white text-neutral-700 hover:bg-neutral-50",
                ].join(" ")}
              >
                {t("filterAnomalyTools")}
              </button>
              {filtersActive ? (
                <button
                  type="button"
                  onClick={() => void clearFilters()}
                  className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-100"
                >
                  {t("filterClear")}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-ca-border/80 pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={liveMode}
                onChange={(e) => setLiveMode(e.target.checked)}
                className="h-4 w-4 rounded border-ca-border text-ca-accent"
              />
              <span className="font-medium">{t("liveModeLabel")}</span>
              <span className="text-xs text-ca-muted">{liveMode ? t("liveModeOnHint") : t("liveModeOffHint")}</span>
            </label>
            <div className="flex items-center gap-2">
              <label htmlFor="token-warn" className="text-xs font-semibold text-ca-muted">
                {t("tokenWarnLabel")}
              </label>
              <input
                id="token-warn"
                type="number"
                min={0}
                step={100}
                value={Number.isFinite(tokenWarnAt) ? tokenWarnAt : DEFAULT_TOKEN_WARN}
                onChange={(e) => setTokenWarnAt(Number(e.target.value) || 0)}
                className="w-24 rounded-lg border border-ca-border px-2 py-1 font-mono text-xs"
              />
            </div>
            {filtersActive ? (
              <span className="text-xs font-medium text-amber-800">{t("filtersActive")}</span>
            ) : null}
          </div>
        </section>
      )}

      {q.isSuccess && lastUpdated && !missingUrl && (
        <section className="mb-6 rounded-2xl border border-ca-border bg-white/80 px-5 py-3 shadow-ca-sm backdrop-blur-sm">
          <p className="text-sm text-neutral-700">
            <span className="font-semibold text-neutral-900">{t("lastUpdated")}:</span>{" "}
            <span className="font-mono text-ca-muted">{lastUpdated}</span>
            {liveMode ? (
              <span className="ml-2 rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
                {t("liveModeBadge")}
              </span>
            ) : null}
          </p>
          {rawCount > 0 && (
            <p className="mt-1 text-sm text-neutral-600">{t("showingLoaded", { count: rawCount })}</p>
          )}
          {rawCount === 0 && !q.isFetching && (
            <MessageHint
              text={t("probeHint")}
              className="mt-2"
              textClassName="text-sm text-ca-muted"
              clampClass="line-clamp-3"
            />
          )}
        </section>
      )}

      <section aria-label={t("title")}>
        {q.isFetching && !q.data && !missingUrl && (
          <div className="flex items-center gap-2 text-sm text-ca-muted">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ca-border border-t-ca-accent" />
            {t("fetching")}
          </div>
        )}
        {q.isError && !missingUrl && (
          <div className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 text-sm text-red-800">
            <p className="font-medium">{String(q.error)}</p>
            <div className="mt-2">
              <MessageHint text={t("probeHint")} textClassName="text-sm text-red-700/90" clampClass="line-clamp-4" />
            </div>
            <LocalizedLink href="/settings" className="mt-3 inline-block font-medium text-ca-accent no-underline hover:underline">
              {t("openSettings")}
            </LocalizedLink>
          </div>
        )}
        {q.isSuccess && rows.length === 0 && !missingUrl && !q.isFetching && (
          <div className="ca-card-pad">
            <div className="flex justify-center">
              <MessageHint
                text={filtersActive ? t("listTraceRecordsEmptyFiltered") : t("listTraceRecordsEmpty")}
                textClassName="text-sm text-ca-muted text-center"
                clampClass="line-clamp-5"
              />
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <div className="ca-table-wrap">
            <div className="border-b border-ca-border bg-neutral-50/90 px-5 py-4">
              <h2 className="text-sm font-semibold text-neutral-900">{t("tableTitle")}</h2>
              <MessageHint
                text={t("tableSubtitle")}
                className="mt-0.5"
                textClassName="text-xs text-ca-muted"
                clampClass="line-clamp-4"
              />
            </div>
            <div
              ref={scrollBoxRef}
              className={[
                "overflow-x-auto",
                liveMode ? "max-h-[min(70vh,720px)] overflow-y-auto" : "",
              ].join(" ")}
            >
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-neutral-50/95 shadow-sm backdrop-blur-sm">
                  <tr className="border-b border-ca-border text-xs uppercase tracking-wide text-ca-muted">
                    <th className="px-5 py-3 font-semibold">{t("columnSessionSummary")}</th>
                    <th className="px-5 py-3 font-semibold">{t("time")}</th>
                    <th className="px-5 py-3 font-semibold">{t("statusColumn")}</th>
                    <th className="px-5 py-3 font-semibold">{t("tokensColumn")}</th>
                    <th className="px-5 py-3 font-semibold">{t("columnOptimization")}</th>
                    <th className="px-5 py-3 font-semibold">{t("durationColumn")}</th>
                    <th className="px-5 py-3 font-semibold">{t("columnLoopsTools")}</th>
                    <th className="px-5 py-3 font-semibold">{t("threadKeyColumn")}</th>
                    <th className="px-5 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ca-border">
                  {rows.map((row) => {
                    const dur = traceRecordDurationMs(row);
                    const agent = traceRecordAgentName(row);
                    const channel = traceRecordChannel(row);
                    const band = traceRecordStatusBand(row, tokenWarnAt);
                    const rawStatus = String(row.status);
                    return (
                      <tr key={`${row.trace_id}-${row.start_time}`} className="bg-white transition-colors hover:bg-neutral-50/80">
                        <td className="max-w-[min(24rem,40vw)] px-5 py-3.5 align-top">
                          <p className="font-mono text-[11px] text-neutral-500" title={row.session_id ?? row.thread_key}>
                            {sessionLine(row)}
                          </p>
                          <p className="mt-0.5 line-clamp-2 break-words text-neutral-900">{traceRecordTaskSummary(row)}</p>
                          <p className="mt-1 text-[11px] text-neutral-400">
                            {[agent, channel].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-ca-muted align-top">
                          {formatTraceDateTimeLocal(new Date(row.start_time).toISOString())}
                        </td>
                        <td className="px-5 py-3.5 align-top">
                          <span
                            className={[
                              "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                              statusBandPillClass(band),
                            ].join(" ")}
                          >
                            {statusBandLabel(band, rawStatus, t)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs tabular-nums text-neutral-800 align-top">
                          {typeof row.total_tokens === "number" ? row.total_tokens.toLocaleString() : "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 align-top">
                          <span className="font-mono text-xs tabular-nums text-emerald-800" title={t("columnOptimizationHint")}>
                            {formatOptimizationRate(row.optimization_rate_pct)}
                          </span>
                          {row.saved_tokens_total > 0 ? (
                            <span className="ml-1 text-[10px] text-ca-muted">
                              (−{row.saved_tokens_total.toLocaleString()})
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-ca-muted align-top">
                          {formatDurationMs(dur)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs tabular-nums text-neutral-700 align-top">
                          <span title={t("loopsHint")}>{row.loop_count}</span>
                          <span className="text-neutral-300"> / </span>
                          <span title={t("toolsHint")}>{row.tool_call_count}</span>
                        </td>
                        <td className="max-w-[180px] px-5 py-3.5 align-top">
                          <IdLabeledCopy
                            kind="thread_key"
                            value={row.thread_key}
                            displayText={
                              row.thread_key.length > 32
                                ? `${row.thread_key.slice(0, 14)}…${row.thread_key.slice(-8)}`
                                : row.thread_key
                            }
                            variant="compact"
                          />
                        </td>
                        <td className="px-5 py-3.5 text-right align-top">
                          <LocalizedLink
                            href={detailHref(row)}
                            className="inline-flex rounded-lg bg-ca-accent px-3 py-1.5 text-xs font-medium text-white no-underline transition hover:bg-ca-accent-hover"
                          >
                            {t("open")}
                          </LocalizedLink>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {q.hasNextPage ? (
              <div className="border-t border-ca-border bg-neutral-50/80 px-5 py-3 text-center">
                <button
                  type="button"
                  disabled={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                  className="rounded-lg border border-ca-border bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  {q.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
