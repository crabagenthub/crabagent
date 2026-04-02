"use client";

import { Message } from "@arco-design/web-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconRobot, IconInfoCircle, IconMessage, IconLanguage, IconSearch, IconEdit, IconClose, IconCopy } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageHint } from "@/components/message-hint";
import { TraceSemanticTree } from "@/components/trace-semantic-tree";
import { TraceSpanRunPanel } from "@/components/trace-span-run-panel";
import { Drawer, DrawerClose } from "@/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { cn, formatShortId } from "@/lib/utils";
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: TraceRecordRow | null;
  /** Same table page rows, for prev/next navigation in the dialog header. */
  rows: TraceRecordRow[];
  onNavigate: (row: TraceRecordRow) => void;
  baseUrl: string;
  apiKey: string;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyValueButton({
  text,
  ariaLabel,
  tooltipLabel,
  successLabel,
}: {
  text: string;
  ariaLabel: string;
  tooltipLabel: string;
  successLabel: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() =>
              void copyText(text).then((ok) => {
                if (ok) {
                  Message.success(successLabel);
                }
              })
            }
            className="inline-flex shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            aria-label={ariaLabel}
          >
            <IconCopy className="size-3.5" />
          </button>
        }
      />
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

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

  const listEnabled = open && baseUrl.trim().length > 0 && traceId.length > 0;

  const spansQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, "inspect", baseUrl, apiKey, traceId],
    queryFn: () => loadSemanticSpans(baseUrl, apiKey, traceId),
    enabled: listEnabled,
  });

  const items = useMemo(() => spansQuery.data?.items ?? [], [spansQuery.data?.items]);
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
      return;
    }
  }, [open]);

  useEffect(() => {
    if (spanForest.length === 0) {
      setSelectedSpanId(null);
      return;
    }
    setSelectedSpanId((prev) => {
      if (prev && items.some((s) => s.span_id === prev)) {
        return prev;
      }
      return spanForest[0]!.span_id;
    });
  }, [spanForest, items, traceId]);

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
          <DrawerClose
            className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("threadDrawerCloseAria")}
          >
            <IconClose className="size-5" aria-hidden />
          </DrawerClose>
        </div>

        <div className="flex min-h-0 min-h-[min(520px,70dvh)] flex-1 flex-col overflow-hidden lg:flex-row">
              {/* Left: trace tree */}
              <div className="flex min-h-[240px] w-full shrink-0 flex-col border-border lg:w-[min(100%,17.5rem)] lg:max-w-[min(100%,20rem)] lg:shrink-0 lg:border-r">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {t("traceInspectTreeTitle", { count: String(items.length) })}
                    </h3>
                    <IconInfoCircle className="size-4 shrink-0 text-neutral-400" aria-hidden />
                  </div>
                  <div className="flex items-center gap-0.5 text-neutral-400">
                    <IconEdit className="size-4" strokeWidth={1.25} aria-hidden />
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
                          <CopyValueButton
                            text={spanId}
                            ariaLabel={t("traceInspectCopySpanId")}
                            tooltipLabel={t("copy")}
                            successLabel={t("copied")}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
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
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                  <section className="rounded-2xl border border-neutral-200/80 bg-white px-4 py-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/80">
                    <div className="text-lg font-semibold text-foreground">{t("inspectDrawerTraceSummaryTitle")}</div>
                    <div className="mt-3">
                      <div className="text-xs text-neutral-500">{t("drawerMetaTraceIdLabel").replace(/[:：]\s*$/, "")}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 truncate text-[1.05rem] font-semibold tracking-tight text-neutral-950 dark:text-neutral-50" title={traceId || undefined}>
                          {traceId ? traceShort : "—"}
                        </span>
                        {traceId ? (
                          <CopyValueButton
                            text={traceId}
                            ariaLabel={t("inspectCopyTraceIdAria")}
                            tooltipLabel={t("copy")}
                            successLabel={t("copied")}
                          />
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
                      <div className="min-w-0">
                        <div className="text-xs text-neutral-500">{t("drawerMetaAgentLabel").replace(/[:：]\s*$/, "")}</div>
                        <div className="mt-1 inline-flex min-w-0 items-center gap-1.5 text-sm text-neutral-900 dark:text-neutral-100">
                          <IconRobot className="size-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden />
                          <span className="truncate font-medium">{traceAgent ?? "—"}</span>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-neutral-500">{t("drawerMetaChannelLabel").replace(/[:：]\s*$/, "")}</div>
                        <div className="mt-1 inline-flex min-w-0 items-center gap-1.5 text-sm text-neutral-900 dark:text-neutral-100">
                          <IconLanguage className="size-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden />
                          <span className="truncate font-medium">{traceChannel ?? "—"}</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500">{t("drawerMetaDurationTotalLabel").replace(/[:：]\s*$/, "")}</div>
                        <div className="mt-1 text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{metaDuration}</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500">{t("drawerMetaFirstSeenLabel").replace(/[:：]\s*$/, "")}</div>
                        <div className="mt-1 text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{traceRowWhenLabel}</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500">{t("drawerMetaStepsInTraceLabel").replace(/[:：]\s*$/, "")}</div>
                        <div className="mt-1 text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{items.length}</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-500">{t("colStatus")}</div>
                        <div className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                          <span className={cn("size-2.5 rounded-full", statusDotClass)} aria-hidden />
                          <span>{statusLabel}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-amber-200/60 bg-white px-4 py-4 shadow-sm dark:border-amber-900/60 dark:bg-neutral-950/80">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">{t("inspectTokenUsageSubtitle")}</span>
                      <IconInfoCircle className="size-4 text-neutral-400" aria-hidden />
                    </div>
                    <div className="mt-4 rounded-xl border border-amber-200/70 bg-amber-50/35 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/10">
                      <div className="space-y-3">
                        <SidebarMetricRow label={t("threadSidebarTokenInput")} value={tokenIn.toLocaleString()} />
                        <SidebarMetricRow label={t("threadSidebarTokenOutput")} value={tokenOut.toLocaleString()} />
                        <SidebarMetricRow label={t("threadSidebarTokenTotal")} value={tokenTotal.toLocaleString()} accent />
                        <SidebarMetricRow label={t("threadSidebarTokenCache")} value={tokenCache.toLocaleString()} />
                      </div>
                    </div>
                  </section>
                </div>
              </aside>
            </div>
      </div>
      ) : null}
    </Drawer>
  );
}
