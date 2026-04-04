"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconInfoCircle, IconMessage, IconSearch, IconClose } from "@arco-design/web-react/icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageHint } from "@/components/message-hint";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { ExecutionTraceFlow } from "@/components/execution-trace-flow";
import { TraceSemanticTree } from "@/components/trace-semantic-tree";
import { TraceSpanRunPanel } from "@/components/trace-span-run-panel";
import { Drawer, DrawerClose } from "@/components/ui/drawer";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { buildSpanForest, filterSpanForest } from "@/lib/build-span-tree";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import {
  formatDurationMs,
  traceRecordAgentName,
  traceRecordChannel,
  traceRecordDurationMs,
  type TraceRecordRow,
} from "@/lib/trace-records";
import { spanTokenTotals } from "@/lib/span-token-display";
import { collectSkillsUsedFromSemanticSpans } from "@/lib/trace-skills-used";
import { cn, formatShortId } from "@/lib/utils";
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: TraceRecordRow | null;
  initialSpanId?: string | null;
  /** Same table page rows, for prev/next navigation in the dialog header. */
  rows: TraceRecordRow[];
  onNavigate: (row: TraceRecordRow) => void;
  baseUrl: string;
  apiKey: string;
};

function SidebarMetricRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
      <span className={cn("tabular-nums font-semibold text-neutral-800 dark:text-neutral-100", accent && "text-amber-700 dark:text-amber-500")}>
        {value}
      </span>
    </div>
  );
}

export function TraceRecordInspectDialog({
  open,
  onOpenChange,
  row,
  initialSpanId = null,
  rows,
  onNavigate,
  baseUrl,
  apiKey,
}: Props) {
  const t = useTranslations("Traces");
  const traceId = row?.trace_id ?? "";
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeSearchRef = useRef<HTMLInputElement>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [leftPanel, setLeftPanel] = useState<"tree" | "execution">("tree");

  const listEnabled = open && baseUrl.trim().length > 0 && traceId.length > 0;

  const spansQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, "inspect", baseUrl, apiKey, traceId],
    queryFn: () => loadSemanticSpans(baseUrl, apiKey, traceId),
    enabled: listEnabled,
  });

  const items = useMemo(() => spansQuery.data?.items ?? [], [spansQuery.data?.items]);
  const skillsUsed = useMemo(() => collectSkillsUsedFromSemanticSpans(items), [items]);
  const spanForest = useMemo(() => buildSpanForest(items), [items]);
  const filteredSpanForest = useMemo(() => filterSpanForest(spanForest, treeFilter), [spanForest, treeFilter]);

  const traceTimeRange = useMemo((): { start: number; end: number } | null => {
    if (items.length === 0) {
      return null;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of items) {
      if (Number.isFinite(s.start_time)) {
        lo = Math.min(lo, s.start_time);
      }
      const e = s.end_time ?? s.start_time;
      if (Number.isFinite(e)) {
        hi = Math.max(hi, e);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      return null;
    }
    return { start: lo, end: hi };
  }, [items]);

  useEffect(() => {
    if (!open) {
      setTreeFilter("");
      setSelectedSpanId(null);
      setLeftPanel("tree");
      return;
    }
  }, [open]);

  useEffect(() => {
    setLeftPanel("tree");
  }, [traceId]);

  useEffect(() => {
    if (spanForest.length === 0) {
      setSelectedSpanId(null);
      return;
    }
    setSelectedSpanId((prev) => {
      if (initialSpanId && items.some((s) => s.span_id === initialSpanId)) {
        return initialSpanId;
      }
      if (prev && items.some((s) => s.span_id === prev)) {
        return prev;
      }
      return spanForest[0]!.span_id;
    });
  }, [initialSpanId, spanForest, items, traceId]);

  const selectedSpan = useMemo((): SemanticSpanRow | null => {
    if (!selectedSpanId) {
      return null;
    }
    return items.find((s) => s.span_id === selectedSpanId) ?? null;
  }, [items, selectedSpanId]);

  const rowDur = row ? traceRecordDurationMs(row) : null;
  const rowTokens = row && typeof row.total_tokens === "number" ? row.total_tokens : null;
  const traceRowWhenLabel =
    row && row.start_time
      ? formatTraceDateTimeLocal(new Date(row.start_time).toISOString())
      : "—";

  const traceShort = formatShortId(traceId);
  const metaDuration = rowDur != null ? formatDurationMs(rowDur) : "—";
  const traceAgent = row ? traceRecordAgentName(row) : null;
  const traceChannel = row ? traceRecordChannel(row) : null;
  const spanTokens = selectedSpan ? spanTokenTotals(selectedSpan) : null;
  const tokenIn = spanTokens?.hasAny ? spanTokens.prompt : 0;
  const tokenOut = spanTokens?.hasAny ? spanTokens.completion : 0;
  const tokenCache = spanTokens?.hasAny ? spanTokens.cacheRead : 0;
  const tokenTotal =
    spanTokens?.displayTotal != null && spanTokens.displayTotal > 0
      ? spanTokens.displayTotal
      : rowTokens != null && rowTokens > 0
        ? rowTokens
        : 0;
  const serviceName =
    selectedSpan?.model_name?.trim() || selectedSpan?.name?.trim() || "—";
  const providerName =
    selectedSpan?.module?.trim() || selectedSpan?.type?.trim() || "—";
  const spanId = selectedSpan?.span_id?.trim() || "";
  const statusError = selectedSpan != null && selectedSpan.error != null;
  const statusLabel =
    selectedSpan == null
      ? "—"
      : statusError
        ? t("detailStatusError")
        : t("detailStatusSuccess");
  const statusDotClass =
    selectedSpan == null ? "bg-neutral-300" : statusError ? "bg-red-400" : "bg-emerald-400";

  const handleOpenTraceFromGraph = useCallback(
    (tid: string) => {
      const hit = rows.find((r) => r.trace_id === tid);
      if (hit) {
        onNavigate(hit);
      }
    },
    [rows, onNavigate],
  );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      wrapClassName="ca-arco-app-drawer-wrap--overlay"
      width="min(100vw - 1.5rem, 74rem)"
    >
      {row ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-400">
              <IconMessage className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="text-lg font-semibold leading-tight text-foreground">{t("traceInspectTitle")}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setLeftPanel("tree")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                leftPanel === "tree"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("messageViewTree")}
            </button>
            <button
              type="button"
              onClick={() => setLeftPanel("execution")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                leftPanel === "execution"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("threadDrawerViewCallGraph")}
            </button>
          </div>
          <DrawerClose
            className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("threadDrawerCloseAria")}
          >
            <IconClose className="size-5" aria-hidden />
          </DrawerClose>
        </div>

        {leftPanel === "execution" ? (
          <div className="flex min-h-0 min-h-[min(520px,70dvh)] flex-1 flex-row overflow-hidden">
            <ExecutionTraceFlow
              variant="trace"
              baseUrl={baseUrl}
              apiKey={apiKey}
              traceId={traceId}
              maxNodes={500}
              className="min-h-0 flex-1 bg-background"
              onOpenTrace={handleOpenTraceFromGraph}
              onSelectSpan={(id) => setSelectedSpanId(id)}
            />
          </div>
        ) : (
        <div className="flex min-h-0 min-h-[min(520px,70dvh)] flex-1 flex-col overflow-hidden lg:flex-row">
              {/* Left: trace tree */}
              <div className="flex min-h-[240px] w-full shrink-0 flex-col border-border lg:w-[min(100%,17.5rem)] lg:max-w-[min(100%,20rem)] lg:shrink-0 lg:border-r">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {t("traceInspectTreeTitle", { count: String(items.length) })}
                    </h3>
                    <IconInfoCircle className="size-4 shrink-0 text-neutral-400" aria-hidden />
                  </div>
                </div>
                <div className="shrink-0 border-b border-border bg-background px-3 py-2.5">
                  <div className="relative">
                    <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" strokeWidth={2} />
                    <input
                      ref={treeSearchRef}
                      type="search"
                      value={treeFilter}
                      onChange={(e) => setTreeFilter(e.target.value)}
                      placeholder={t("detailTreeSearchPlaceholder")}
                      className="w-full rounded-lg border border-input bg-muted/50 py-1.5 pl-8 pr-2.5 text-xs text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label={t("detailTreeSearchPlaceholder")}
                    />
                  </div>
                </div>
                <div ref={treeScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
                  {spansQuery.isError ? (
                    <p className="p-4 text-sm text-red-600">{String(spansQuery.error)}</p>
                  ) : spansQuery.isFetching && items.length === 0 ? (
                    <p className="p-4 text-sm text-neutral-500">{t("semanticSpansLoading")}</p>
                  ) : spanForest.length === 0 ? (
                    <MessageHint
                      className="p-4"
                      text={t("semanticTreeEmptyDetail")}
                      textClassName="text-sm text-neutral-500"
                      clampClass="line-clamp-5"
                    />
                  ) : filteredSpanForest.length > 0 ? (
                    <TraceSemanticTree
                      forest={filteredSpanForest}
                      selectedId={selectedSpanId}
                      onSelect={setSelectedSpanId}
                      variant="inspect"
                      traceTimeRange={traceTimeRange}
                    />
                  ) : (
                    <p className="p-4 text-sm text-neutral-500">{t("detailTreeNoMatches")}</p>
                  )}
                </div>
              </div>

              {/* Middle: span inspector */}
              <div className="flex min-h-[280px] min-w-0 flex-1 flex-col overflow-hidden bg-background">
                <div className="shrink-0 border-b border-border bg-white/90 px-4 py-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">{t("inspectInferenceServiceLabel").replace(/[:：]\s*$/, "")}</div>
                      <div className="mt-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {serviceName}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">{t("inspectModelEndpointLabel").replace(/[:：]\s*$/, "")}</div>
                      <div className="mt-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {providerName}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">{t("inspectDetailServiceId").replace(/[:：]\s*$/, "")}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100" title={spanId || undefined}>
                          {spanId ? formatShortId(spanId) : "—"}
                        </span>
                        {spanId ? (
                          <TraceCopyIconButton
                            text={spanId}
                            ariaLabel={t("traceInspectCopySpanId")}
                            tooltipLabel={t("copy")}
                            successLabel={t("copySuccessToast")}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {skillsUsed.length > 0 ? (
                    <div className="mt-3 border-t border-neutral-200/80 pt-3 dark:border-neutral-700/80">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectSkillsUsedLabel")}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {skillsUsed.map((s) => (
                          <span
                            key={`${s.skill_id ?? ""}:${s.label}`}
                            className="rounded-md border border-violet-200/80 bg-violet-50/80 px-2 py-0.5 text-xs font-medium text-violet-900 dark:border-violet-800/50 dark:bg-violet-950/40 dark:text-violet-200"
                            title={s.skill_id ? `${s.label} (${s.skill_id})` : s.label}
                          >
                            {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <TraceSpanRunPanel span={selectedSpan} chrome="embedded" />
                </div>
              </div>

              {/* Right: basic information */}
              <aside
                className="flex max-h-[min(60vh,520px)] min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-border bg-neutral-50/60 lg:max-h-none lg:w-[min(100%,24rem)] lg:min-w-[280px] lg:max-w-[26rem] lg:shrink-0 lg:border-l lg:border-t-0"
                aria-label={t("inspectBasicInfoTitle")}
              >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    <div className="col-span-2 min-w-0">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaTraceIdLabel")}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1">
                        <span className="truncate text-sm text-neutral-900 dark:text-neutral-100" title={traceId || undefined}>
                          {traceId ? traceShort : "—"}
                        </span>
                        {traceId ? (
                          <TraceCopyIconButton
                            text={traceId}
                            ariaLabel={t("inspectCopyTraceIdAria")}
                            tooltipLabel={t("copy")}
                            successLabel={t("copySuccessToast")}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaAgentLabel")}</div>
                      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={traceAgent ?? undefined}>
                        {traceAgent ?? "—"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaChannelLabel")}</div>
                      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={traceChannel ?? undefined}>
                        {traceChannel ?? "—"}
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("colStatus")}</div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className={cn("size-2 shrink-0 rounded-full", statusDotClass)} aria-hidden />
                        <span className="break-words text-sm font-normal text-neutral-900 dark:text-neutral-100">
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-neutral-200/80 pt-4 dark:border-neutral-700/80">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-50">{t("inspectTokenUsageSubtitle")}</span>
                        <IconInfoCircle className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-amber-200/40 bg-amber-50/50 px-3 py-2.5 dark:border-amber-900/35 dark:bg-amber-950/25">
                      <dl className="m-0 space-y-2 text-xs leading-relaxed">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenInput")}</dt>
                          <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{tokenIn.toLocaleString()}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenOutput")}</dt>
                          <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{tokenOut.toLocaleString()}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenTotal")}</dt>
                          <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{tokenTotal.toLocaleString()}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenCache")}</dt>
                          <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{tokenCache.toLocaleString()}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
        )}
      </div>
      ) : null}
    </Drawer>
  );
}
