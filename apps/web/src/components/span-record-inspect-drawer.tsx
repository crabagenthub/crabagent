"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  Bot,
  ChevronLeft,
  ChevronRight,
  Filter,
  Info,
  ListOrdered,
  Radio,
  Search,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InspectDrawerMetaSection } from "@/components/inspect-drawer-meta-section";
import { MessageHint } from "@/components/message-hint";
import { TraceInspectBasicHeader } from "@/components/trace-inspect-basic-header";
import { TraceSemanticTree } from "@/components/trace-semantic-tree";
import { TraceSpanRunPanel } from "@/components/trace-span-run-panel";
import { Drawer, DrawerClose } from "@/components/ui/drawer";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { buildSpanForest, filterSpanForest } from "@/lib/build-span-tree";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import { formatDurationMs } from "@/lib/trace-records";
import type { SpanRecordRow } from "@/lib/span-records";
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SpanRecordRow | null;
  /** Current page rows for prev/next in the drawer toolbar. */
  rows: SpanRecordRow[];
  onNavigate: (row: SpanRecordRow) => void;
  baseUrl: string;
  apiKey: string;
};

/** 右侧抽屉：执行步骤表行点选后查看同 trace 下语义树 + Input/Output（与消息详情 inspect 布局一致）。 */
export function SpanRecordInspectDrawer({
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
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, "span-list-inspect", baseUrl, apiKey, traceId],
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
    }
  }, [open]);

  const anchorSpanId = row?.span_id?.trim() ?? "";
  const anchorTraceId = row?.trace_id ?? "";

  useEffect(() => {
    if (!open || !anchorSpanId || !anchorTraceId) {
      return;
    }
    if (items.length === 0) {
      return;
    }
    if (items.some((s) => s.span_id === anchorSpanId)) {
      setSelectedSpanId(anchorSpanId);
      return;
    }
    if (spanForest.length > 0) {
      setSelectedSpanId(spanForest[0]!.span_id);
    }
  }, [open, anchorSpanId, anchorTraceId, items, spanForest]);

  const selectedSpan = useMemo((): SemanticSpanRow | null => {
    if (!selectedSpanId) {
      return null;
    }
    return items.find((s) => s.span_id === selectedSpanId) ?? null;
  }, [items, selectedSpanId]);

  const idx = row ? rows.findIndex((r) => r.span_id === row.span_id) : -1;
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < rows.length - 1;

  const goPrev = useCallback(() => {
    if (!canPrev) {
      return;
    }
    onNavigate(rows[idx - 1]!);
  }, [canPrev, idx, onNavigate, rows]);

  const goNext = useCallback(() => {
    if (!canNext) {
      return;
    }
    onNavigate(rows[idx + 1]!);
  }, [canNext, idx, onNavigate, rows]);

  const scrollTreeTop = useCallback(() => {
    treeScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const rowDur = row?.duration_ms ?? null;
  const listStartLabel =
    row != null && row.start_time_ms != null
      ? formatTraceDateTimeLocal(new Date(row.start_time_ms).toISOString())
      : "—";
  const listEndLabel =
    row != null && row.end_time_ms != null
      ? formatTraceDateTimeLocal(new Date(row.end_time_ms).toISOString())
      : "—";

  const spanStartLabel = selectedSpan
    ? formatTraceDateTimeLocal(new Date(selectedSpan.start_time).toISOString())
    : listStartLabel;
  const spanEndLabel =
    selectedSpan && selectedSpan.end_time != null
      ? formatTraceDateTimeLocal(new Date(selectedSpan.end_time).toISOString())
      : listEndLabel;

  const whenLine =
    selectedSpan && selectedSpan.end_time != null
      ? `${spanStartLabel} – ${spanEndLabel}`
      : spanStartLabel;

  const traceShort =
    traceId.length > 28 ? `${traceId.slice(0, 14)}…${traceId.slice(-10)}` : traceId;
  const metaDuration = rowDur != null ? formatDurationMs(rowDur) : "—";

  const contextTags = useMemo(() => {
    if (!row) {
      return [];
    }
    const out: string[] = [];
    if (row.channel_name) {
      out.push(row.channel_name);
    }
    if (row.agent_name) {
      out.push(row.agent_name);
    }
    if (row.project_name && row.project_name !== "openclaw") {
      out.push(row.project_name);
    }
    return out;
  }, [row]);

  const inspectChipTags = useMemo(() => {
    const out = [...contextTags];
    if (selectedSpan?.module && !out.includes(selectedSpan.module)) {
      out.push(selectedSpan.module);
    }
    return out;
  }, [contextTags, selectedSpan?.module]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {row ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-400">
                <ListOrdered className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              </span>
              <h2 className="text-lg font-semibold leading-tight text-foreground">
                {t("spanInspectDrawerTitle")}
              </h2>
            </div>
            <InspectDrawerMetaSection
              fields={[
                {
                  label: t("drawerMetaTraceIdLabel"),
                  value: traceId ? traceShort : "—",
                  title: traceId || undefined,
                  mono: true,
                  copyText: traceId || undefined,
                  copyAriaLabel: t("inspectCopyTraceIdAria"),
                },
                {
                  label: t("drawerMetaSpanNameLabel"),
                  value: row.name || "—",
                  title: row.name || undefined,
                },
                {
                  label: t("drawerMetaSpanTypeLabel"),
                  value: row.span_type || "—",
                },
                {
                  label: t("drawerMetaAgentLabel"),
                  value: (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Bot className="size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} aria-hidden />
                      <span className="truncate">{row.agent_name?.trim() || "—"}</span>
                    </span>
                  ),
                  title: row.agent_name?.trim() || undefined,
                },
                {
                  label: t("drawerMetaChannelLabel"),
                  value: (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Radio className="size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} aria-hidden />
                      <span className="truncate">{row.channel_name?.trim() || "—"}</span>
                    </span>
                  ),
                  title: row.channel_name?.trim() || undefined,
                },
                {
                  label: t("drawerMetaExecutionWindowLabel"),
                  value: whenLine,
                  colSpan: 4,
                },
                {
                  label: t("drawerMetaStepsInTraceLabel"),
                  value: <span className="tabular-nums">{String(items.length)}</span>,
                },
                {
                  label: t("drawerMetaDurationTotalLabel"),
                  value: <span className="tabular-nums">{metaDuration}</span>,
                },
                {
                  label: t("drawerMetaTokensLabel"),
                  value: <span className="tabular-nums">{row.total_tokens.toLocaleString()}</span>,
                },
              ]}
              highlight={{
                title: t("inspectDrawerStepSummaryTitle"),
                subtitle: t("inspectDrawerSummaryUsageHint"),
                metrics: (
                  <>
                    <span className="text-neutral-900 dark:text-neutral-100">
                      <span className="font-bold text-amber-700 dark:text-amber-500 tabular-nums">{metaDuration}</span>
                      <span className="text-neutral-600 dark:text-neutral-400"> {t("colDuration")}</span>
                    </span>
                    <span className="text-neutral-900 dark:text-neutral-100">
                      <span className="font-bold text-amber-700 dark:text-amber-500 tabular-nums">
                        {row.total_tokens.toLocaleString()}
                      </span>
                      <span className="text-neutral-600 dark:text-neutral-400"> {t("colTotalTokens")}</span>
                    </span>
                  </>
                ),
              }}
            />
          </div>
          <DrawerClose
            className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("threadDrawerCloseAria")}
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </DrawerClose>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-2">
          <button
            type="button"
            disabled={!canPrev}
            onClick={goPrev}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t("traceInspectNavPrev")}
            title={t("traceInspectNavPrev")}
          >
            <ChevronLeft className="size-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={goNext}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={t("traceInspectNavNext")}
            title={t("traceInspectNavNext")}
          >
            <ChevronRight className="size-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={scrollTreeTop}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("traceInspectNavUp")}
            title={t("traceInspectNavUp")}
          >
            <ArrowUp className="size-5" strokeWidth={1.75} />
          </button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <button
            type="button"
            onClick={() => treeSearchRef.current?.focus()}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("detailTreeSearchPlaceholder")}
            title={t("detailTreeSearchPlaceholder")}
          >
            <Search className="size-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            disabled
            aria-label={t("traceInspectFilterSoon")}
            title={t("traceInspectFilterSoon")}
          >
            <Filter className="size-5" strokeWidth={1.75} />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              title={t("traceInspectDebugSoon")}
            >
              <Sparkles className="size-4" strokeWidth={1.75} />
              {t("traceInspectDebugAi")}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 min-h-[min(520px,70dvh)] flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-[240px] w-full shrink-0 flex-col border-border lg:w-[min(100%,20rem)] lg:max-w-[38%] lg:border-r">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {t("spanInspectTreeHeading", { count: String(items.length) })}
                </h3>
                <Info className="size-4 shrink-0 text-neutral-400" aria-hidden />
              </div>
              <div className="flex items-center gap-0.5 text-neutral-400">
                <SquarePen className="size-4" strokeWidth={1.25} aria-hidden />
              </div>
            </div>
            <div className="shrink-0 border-b border-border bg-background px-2 py-2">
              <input
                ref={treeSearchRef}
                type="search"
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                placeholder={t("detailTreeSearchPlaceholder")}
                className="w-full rounded-lg border border-input bg-muted/50 px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={t("detailTreeSearchPlaceholder")}
              />
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

          <div className="flex min-h-[280px] min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <TraceInspectBasicHeader
              selectedSpan={selectedSpan}
              traceId={traceId}
              fallbackSpanId={row.span_id}
              chipTags={inspectChipTags}
              rowTokens={row.total_tokens}
              rowDurationMs={rowDur}
            />

            <div className="min-h-0 flex-1 overflow-hidden border-t border-border">
              <TraceSpanRunPanel span={selectedSpan} chrome="embedded" />
            </div>
          </div>
        </div>
      </div>
      ) : null}
    </Drawer>
  );
}
