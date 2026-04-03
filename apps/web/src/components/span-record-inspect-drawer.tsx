"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconRobot, IconInfoCircle, IconList, IconLanguage, IconSearch, IconEdit, IconClose } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { InspectDrawerMetaSection } from "@/components/inspect-drawer-meta-section";
import { MessageHint } from "@/components/message-hint";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
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
import { cn, formatShortId } from "@/lib/utils";
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

  const traceShort = formatShortId(traceId);
  const metaDuration = rowDur != null ? formatDurationMs(rowDur) : "—";

  const inspectChipTags = useMemo(() => {
    const m = selectedSpan?.module?.trim();
    return m ? [m] : [];
  }, [selectedSpan?.module]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {row ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-400">
              <IconList className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="text-lg font-semibold leading-tight text-foreground">{t("spanInspectDrawerTitle")}</h2>
          </div>
          <DrawerClose
            className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("threadDrawerCloseAria")}
          >
            <IconClose className="size-5" aria-hidden />
          </DrawerClose>
        </div>

        <div className="flex min-h-0 min-h-[min(520px,70dvh)] flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-[240px] w-full shrink-0 flex-col border-border lg:w-[min(100%,17.5rem)] lg:max-w-[min(100%,20rem)] lg:shrink-0 lg:border-r">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">
                      {t("spanInspectTreeHeading", { count: String(items.length) })}
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

          <div className="flex min-h-[280px] min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="min-h-0 flex-1 overflow-hidden">
              <TraceSpanRunPanel span={selectedSpan} chrome="embedded" />
            </div>
          </div>

          <aside
            className="flex max-h-[min(60vh,520px)] min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-border bg-neutral-50/40 lg:max-h-none lg:w-[min(100%,22rem)] lg:min-w-[260px] lg:max-w-[24rem] lg:shrink-0 lg:border-l lg:border-t-0"
            aria-label={t("inspectBasicInfoTitle")}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                <div className="col-span-2 min-w-0">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectDetailServiceId")}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm text-neutral-900 dark:text-neutral-100" title={row.span_id || undefined}>
                      {formatShortId(row.span_id)}
                    </span>
                    <TraceCopyIconButton
                      text={row.span_id}
                      ariaLabel={t("inspectCopyServiceIdAria")}
                      tooltipLabel={t("copy")}
                      successLabel={t("copySuccessToast")}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectInferenceServiceLabel")}</div>
                  <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={row.name || undefined}>
                    {row.name || "—"}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectModelEndpointLabel")}</div>
                  <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={row.span_type || undefined}>
                    {row.span_type || "—"}
                  </div>
                </div>
                <div className="col-span-2 min-w-0">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectDetailRunStatus")}</div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        row.list_status === "error"
                          ? "bg-red-400"
                          : row.list_status === "timeout"
                            ? "bg-amber-400"
                            : row.list_status === "running"
                              ? "bg-sky-400"
                              : "bg-emerald-400",
                      )}
                      aria-hidden
                    />
                    <span className="break-words text-sm font-normal text-neutral-900 dark:text-neutral-100">
                      {t(
                        row.list_status === "error"
                          ? "detailStatusError"
                          : row.list_status === "timeout"
                            ? "statusTimeout"
                            : row.list_status === "running"
                              ? "statusRunning"
                              : "detailStatusSuccess",
                      )}
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
                      <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">
                        {Number.isFinite(row.prompt_tokens) ? row.prompt_tokens.toLocaleString() : "0"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenOutput")}</dt>
                      <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">
                        {Number.isFinite(row.completion_tokens) ? row.completion_tokens.toLocaleString() : "0"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenTotal")}</dt>
                      <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">
                        {row.total_tokens.toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenCache")}</dt>
                      <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">0</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
      ) : null}
    </Drawer>
  );
}
