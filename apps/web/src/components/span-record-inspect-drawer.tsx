"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  Info,
  MessageSquare,
  Pencil,
  Search,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { buttonVariants } from "@/components/ui/button";
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
import { spanTokenTotals } from "@/lib/span-token-display";
import { cn } from "@/lib/utils";

function formatSecondsOneDecimal(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

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
  const threadKey = row?.thread_key ?? "";
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
  const rowTokens = row != null ? row.total_tokens : null;
  const spanDurMs =
    selectedSpan && selectedSpan.end_time != null && Number.isFinite(selectedSpan.start_time)
      ? Math.max(0, selectedSpan.end_time - selectedSpan.start_time)
      : null;
  const spanTokInfo = useMemo(
    () => (selectedSpan != null ? spanTokenTotals(selectedSpan) : null),
    [selectedSpan],
  );

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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {row ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
          <DrawerClose
            className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("threadDrawerCloseAria")}
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </DrawerClose>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-sm font-bold text-violet-700">
                #
              </span>
              <Dialog.Title className="text-lg font-semibold leading-tight text-foreground">
                {t("spanInspectDrawerTitle")}
              </Dialog.Title>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground" title={traceId}>
              {traceId ? traceShort : "—"}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={`${row.name} · ${row.span_type}`}>
              {[row.name, row.span_type].filter(Boolean).join(" · ") || "—"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{whenLine}</span>
              <span className="text-border">·</span>
              <span>{t("traceInspectSpanCountMeta", { count: String(items.length) })}</span>
              <span className="text-border">·</span>
              <span>
                {t("colDuration")}: {metaDuration}
              </span>
              {rowTokens != null && rowTokens > 0 ? (
                <>
                  <span className="text-border">·</span>
                  <span className="tabular-nums">
                    {t("spansColTokens")}: {rowTokens.toLocaleString()}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {threadKey ? (
              <LocalizedLink
                href={`/traces/${encodeURIComponent(threadKey)}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {t("traceInspectGoThread")}
              </LocalizedLink>
            ) : null}
          </div>
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
            <div className="shrink-0 border-b border-border bg-background px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <div
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-pink-100 text-pink-700"
                    aria-hidden
                  >
                    <span className="text-xs font-bold">{selectedSpan?.type?.slice(0, 1) ?? "·"}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-foreground">
                      {selectedSpan
                        ? [selectedSpan.name, selectedSpan.module].filter(Boolean).join(" · ")
                        : t("traceInspectNoSpan")}
                    </p>
                    {selectedSpan?.model_name ? (
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={selectedSpan.model_name}>
                        {selectedSpan.model_name}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{spanStartLabel}</span>
                      {selectedSpan?.end_time != null ? (
                        <>
                          <span className="text-border">–</span>
                          <span>{spanEndLabel}</span>
                        </>
                      ) : null}
                      <span className="text-border">·</span>
                      <span className="tabular-nums">
                        {selectedSpan ? formatSecondsOneDecimal(spanDurMs) : formatSecondsOneDecimal(rowDur)}
                      </span>
                      <span className="text-border">·</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        #
                        {selectedSpan
                          ? selectedSpan.span_id.length > 12
                            ? `${selectedSpan.span_id.slice(0, 6)}…`
                            : selectedSpan.span_id
                          : row.span_id.length > 12
                            ? `${row.span_id.slice(0, 6)}…`
                            : row.span_id}
                      </span>
                      {spanTokInfo?.hasAny && spanTokInfo.displayTotal != null ? (
                        <>
                          <span className="text-border">·</span>
                          <span className="tabular-nums font-medium text-foreground">
                            {t("detailSpanTokens", { n: spanTokInfo.displayTotal.toLocaleString() })}
                          </span>
                          <span className="text-border">·</span>
                          <span className="tabular-nums">
                            {spanTokInfo.prompt.toLocaleString()}/{spanTokInfo.completion.toLocaleString()}
                          </span>
                          {spanTokInfo.cacheRead > 0 ? (
                            <>
                              <span className="text-border">·</span>
                              <span className="tabular-nums text-muted-foreground">
                                cache {spanTokInfo.cacheRead.toLocaleString()}
                              </span>
                            </>
                          ) : null}
                        </>
                      ) : spanTokInfo?.hasAny ? (
                        <>
                          <span className="text-border">·</span>
                          <span className="tabular-nums">
                            {spanTokInfo.prompt.toLocaleString()}/{spanTokInfo.completion.toLocaleString()}
                          </span>
                        </>
                      ) : rowTokens != null && rowTokens > 0 ? (
                        <>
                          <span className="text-border">·</span>
                          <span className="tabular-nums">{rowTokens.toLocaleString()}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1 sm:gap-2">
                  <button
                    type="button"
                    disabled
                    className="hidden rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex"
                    title={t("traceInspectAddToSoon")}
                  >
                    {t("traceInspectAddTo")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                    disabled
                    title={t("traceInspectCommentSoon")}
                  >
                    <MessageSquare className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                    <span className="hidden sm:inline">{t("traceInspectComments")}</span>
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                    disabled
                    title={t("traceInspectEditSoon")}
                    aria-label={t("traceInspectEditSoon")}
                  >
                    <Pencil className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                    <span className="hidden lg:inline">{t("traceInspectTabFeedback")}</span>
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {contextTags.length === 0 && !selectedSpan?.module ? (
                  <span className="text-xs text-neutral-400">—</span>
                ) : (
                  <>
                    {contextTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex max-w-[10rem] truncate rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-900"
                        title={tag}
                      >
                        {tag}
                      </span>
                    ))}
                    {selectedSpan?.module && !contextTags.includes(selectedSpan.module) ? (
                      <span className="rounded-md bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-900">
                        {selectedSpan.module}
                      </span>
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  disabled
                  className="inline-flex size-6 items-center justify-center rounded border border-dashed border-neutral-300 text-neutral-400"
                  title={t("traceInspectAddTagSoon")}
                  aria-label={t("traceInspectAddTagSoon")}
                >
                  +
                </button>
                {selectedSpan ? (
                  <button
                    type="button"
                    onClick={() => void copyText(selectedSpan.span_id)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                  >
                    <Copy className="size-3.5" strokeWidth={2} />
                    {t("traceInspectCopySpanId")}
                  </button>
                ) : null}
              </div>
            </div>

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
