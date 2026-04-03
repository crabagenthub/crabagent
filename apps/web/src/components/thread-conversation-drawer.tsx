"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ThreadDrawerMessageTranscript } from "@/components/thread-drawer-message-transcript";
import { Drawer, DrawerClose } from "@/components/ui/drawer";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { aggregateThreadLlmOutputUsage } from "@/lib/trace-payload-usage";
import { loadTraceEvents } from "@/lib/trace-events";
import { type ThreadRecordRow } from "@/lib/thread-records";
import { formatDurationMs } from "@/lib/trace-records";
import {
  buildConversationTurnWindowEvents,
  buildDetailEventList,
  filterEventsForRun,
  buildUserTurnList,
  inferTurnListStatus,
  inferTurnWindowMetrics,
  resolveLinkedRunIdForTurn,
  type TurnListStatus,
} from "@/lib/user-turn-list";
import { ThreadConversationInspectHeader } from "@/components/thread-conversation-inspect-header";
import { IconCode, IconDashboard, IconMessage, IconClose, IconCommon,IconClockCircle } from "@arco-design/web-react/icon";
import { Popover } from "@arco-design/web-react";
import { cn, formatShortId } from "@/lib/utils";

function turnStatusLabelKey(st: TurnListStatus): string {
  switch (st) {
    case "running":
      return "threadTurnStatusRunning";
    case "success":
      return "threadTurnStatusSuccess";
    case "error":
      return "threadTurnStatusError";
    case "timeout":
      return "threadTurnStatusTimeout";
    default:
      return "threadTurnStatusUnknown";
  }
}

/** 时间轴节点：无编号空心圆环（ref 供主轴测量圆心） */
const TurnRailMarker = forwardRef<
  HTMLDivElement,
  { status: TurnListStatus; active: boolean; t: (key: string) => string }
>(function TurnRailMarker({ status, active, t }, ref) {
  const title = t(turnStatusLabelKey(status));
  return (
    <div
      ref={ref}
        className="relative z-[3] isolate flex shrink-0 items-center justify-center"
      title={title}
      aria-hidden
    >
      <span
        className={cn(
          /* 完全不透明填充，避免主轴在圆心处透出（半透明 /alpha 会透出灰线） */
          "relative z-10 box-border size-[11px] shrink-0 rounded-full border-[2.5px] border-neutral-300 bg-background dark:border-neutral-500 dark:bg-neutral-900",
          "transition-[border-color,transform,box-shadow] duration-200",
          active &&
            "z-10 size-[13px] border-[3px] border-primary bg-background ring-4 ring-primary/20 dark:bg-background dark:ring-primary/25",
          status === "running" && !active && "motion-safe:animate-pulse border-sky-500/90 dark:border-sky-400",
          status === "error" && !active && "border-red-500 dark:border-red-400",
          status === "timeout" && !active && "border-amber-500 dark:border-amber-400",
        )}
      />
    </div>
  );
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ThreadRecordRow | null;
  baseUrl: string;
  apiKey: string;
  onOpenTrace?: (traceId: string) => void;
};

/** 钻取子 agent 会话：沿用父行的 workspace/project，其余列表字段占位。 */
function syntheticDrillThreadRow(childThreadId: string, parent: ThreadRecordRow): ThreadRecordRow {
  return {
    thread_id: childThreadId.trim(),
    workspace_name: parent.workspace_name,
    project_name: parent.project_name,
    first_seen_ms: parent.first_seen_ms,
    last_seen_ms: parent.last_seen_ms,
    metadata: {},
    agent_name: null,
    channel_name: null,
    trace_count: 0,
    first_message_preview: null,
    last_message_preview: null,
    latest_input_preview: null,
    total_tokens: 0,
    total_cost: null,
    duration_ms: null,
    status: null,
  };
}

export function ThreadConversationDrawer({ open, onOpenChange, row, baseUrl, apiKey, onOpenTrace }: Props) {
  const t = useTranslations("Traces");
  const [drillRow, setDrillRow] = useState<ThreadRecordRow | null>(null);

  useEffect(() => {
    if (!open) {
      setDrillRow(null);
    }
  }, [open]);

  const activeRow = drillRow ?? row;
  const threadKey = activeRow?.thread_id ?? "";

  const openSubagentSession = useCallback(
    (childKey: string) => {
      const k = childKey.trim();
      if (!k || !row) {
        return;
      }
      setDrillRow(syntheticDrillThreadRow(k, row));
    },
    [row],
  );

  const eventsQuery = useQuery({
    queryKey: ["trace-events", baseUrl, apiKey, threadKey],
    queryFn: () => loadTraceEvents(baseUrl, apiKey, threadKey),
    enabled: open && baseUrl.trim().length > 0 && threadKey.length > 0,
  });

  const merged = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data?.items]);

  const userTurns = useMemo(() => buildUserTurnList(merged), [merged]);
  const turnKeysSig = useMemo(() => userTurns.map((u) => u.listKey).join("\0"), [userTurns]);

  const turnStatusByKey = useMemo(() => {
    const m = new Map<string, TurnListStatus>();
    for (const u of userTurns) {
      m.set(u.listKey, inferTurnListStatus(buildDetailEventList(merged, u)));
    }
    return m;
  }, [merged, userTurns]);

  const turnMetricsByKey = useMemo(() => {
    const m = new Map<string, ReturnType<typeof inferTurnWindowMetrics>>();
    for (const u of userTurns) {
      const linkedRunId = resolveLinkedRunIdForTurn(u, merged);
      const runEv = filterEventsForRun(merged, linkedRunId);
      const windowEv = buildConversationTurnWindowEvents(merged, u, userTurns);
      const runMetrics = runEv.length > 0 ? inferTurnWindowMetrics(runEv) : null;
      const windowMetrics = inferTurnWindowMetrics(windowEv);
      const startedAtMs = runMetrics?.startedAtMs ?? windowMetrics.startedAtMs;
      const endedAtMs = windowMetrics.endedAtMs ?? runMetrics?.endedAtMs ?? null;
      const durationMs =
        startedAtMs != null && endedAtMs != null && endedAtMs >= startedAtMs ? endedAtMs - startedAtMs : null;
      m.set(u.listKey, {
        durationMs,
        startedAtMs,
        endedAtMs,
        promptTokens: windowMetrics.promptTokens,
        completionTokens: windowMetrics.completionTokens,
        displayTotal: windowMetrics.displayTotal,
      });
    }
    return m;
  }, [merged, userTurns]);

  const [selectedListKey, setSelectedListKey] = useState("");
  /** 主轴相对此 ul 定位，并位于 ul 内部，避免被 ul 的层叠挡住 */
  const timelineUlRef = useRef<HTMLUListElement>(null);
  const dotByKeyRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [turnSpine, setTurnSpine] = useState<{ top: number; left: number; height: number } | null>(null);

  const measureTurnSpine = useCallback(() => {
    const ul = timelineUlRef.current;
    if (!ul || userTurns.length < 2) {
      setTurnSpine((prev) => (prev === null ? prev : null));
      return;
    }
    const firstKey = userTurns[0]!.listKey;
    const lastKey = userTurns[userTurns.length - 1]!.listKey;
    const firstEl = dotByKeyRef.current.get(firstKey);
    const lastEl = dotByKeyRef.current.get(lastKey);
    if (!firstEl || !lastEl) {
      setTurnSpine((prev) => (prev === null ? prev : null));
      return;
    }
    const ur = ul.getBoundingClientRect();
    const fr = firstEl.getBoundingClientRect();
    const lr = lastEl.getBoundingClientRect();
    const y1 = fr.top + fr.height / 2 - ur.top;
    const y2 = lr.top + lr.height / 2 - ur.top;
    const x = fr.left + fr.width / 2 - ur.left;
    const h = y2 - y1;
    const next = { left: Math.round(x), top: Math.round(y1), height: Math.max(0, Math.round(h)) };
    setTurnSpine((prev) => {
      if (prev && prev.left === next.left && prev.top === next.top && prev.height === next.height) {
        return prev;
      }
      return next;
    });
  }, [userTurns]);

  /** 每个 listKey 固定一个 ref 回调，避免每轮渲染内联 ref 触发「null→el」反复挂载导致死循环 */
  const dotRefCbByKeyRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());

  const getDotRefForListKey = useCallback((listKey: string) => {
    let cb = dotRefCbByKeyRef.current.get(listKey);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) dotByKeyRef.current.set(listKey, el);
        else dotByKeyRef.current.delete(listKey);
      };
      dotRefCbByKeyRef.current.set(listKey, cb);
    }
    return cb;
  }, []);

  useEffect(() => {
    const alive = new Set(userTurns.map((u) => u.listKey));
    for (const k of dotRefCbByKeyRef.current.keys()) {
      if (!alive.has(k)) dotRefCbByKeyRef.current.delete(k);
    }
  }, [userTurns]);

  useLayoutEffect(() => {
    measureTurnSpine();
    const raf1 = requestAnimationFrame(() => measureTurnSpine());
    const raf2 = requestAnimationFrame(() => {
      requestAnimationFrame(measureTurnSpine);
    });
    const to0 = window.setTimeout(measureTurnSpine, 0);
    const to1 = window.setTimeout(measureTurnSpine, 40);
    const to2 = window.setTimeout(measureTurnSpine, 160);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(to0);
      window.clearTimeout(to1);
      window.clearTimeout(to2);
    };
  }, [measureTurnSpine, selectedListKey, open, turnKeysSig, eventsQuery.dataUpdatedAt]);

  useEffect(() => {
    const el = timelineUlRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureTurnSpine());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureTurnSpine]);

  useEffect(() => {
    if (userTurns.length === 0) {
      setSelectedListKey("");
      return;
    }
    setSelectedListKey((prev) => {
      if (prev && userTurns.some((u) => u.listKey === prev)) {
        return prev;
      }
      return userTurns[0]!.listKey;
    });
  }, [userTurns]);

  const threadShort = formatShortId(threadKey);

  const listTotalTokens = activeRow != null ? activeRow.total_tokens : 0;
  const threadUsage = useMemo(() => aggregateThreadLlmOutputUsage(merged), [merged]);

  const turnRail = userTurns.map((u, turnIdx) => {
    const active = u.listKey === selectedListKey;
    const st = turnStatusByKey.get(u.listKey) ?? "unknown";
    const metrics = turnMetricsByKey.get(u.listKey);
    const durLabel =
      metrics?.durationMs != null && metrics.durationMs >= 0 ? formatDurationMs(metrics.durationMs) : "—";
    const startedLabel =
      metrics?.startedAtMs != null && metrics.startedAtMs > 0 ? formatTraceDateTimeFromMs(metrics.startedAtMs) : "—";
    const endedLabel =
      metrics?.endedAtMs != null && metrics.endedAtMs > 0 ? formatTraceDateTimeFromMs(metrics.endedAtMs) : "—";
    const tokTotal = metrics?.displayTotal;
    const tokShow =
      tokTotal != null && Number.isFinite(tokTotal) && tokTotal > 0 ? tokTotal.toLocaleString() : "—";
    const tokBreakdown =
      (metrics?.promptTokens ?? 0) > 0 || (metrics?.completionTokens ?? 0) > 0 || tokTotal != null;
    const isLast = turnIdx === userTurns.length - 1;
    const mergedAsyncCount =
      typeof u.mergedAsyncFollowUpCount === "number" && u.mergedAsyncFollowUpCount > 0
        ? u.mergedAsyncFollowUpCount
        : 0;
    const mergedSubagentCount =
      typeof u.mergedSubagentFollowUpCount === "number" && u.mergedSubagentFollowUpCount > 0
        ? u.mergedSubagentFollowUpCount
        : 0;
    const legacyMergedTotal =
      mergedAsyncCount === 0 &&
      mergedSubagentCount === 0 &&
      (u.mergedTraceRootIds?.length ?? 0) > 0
        ? u.mergedTraceRootIds!.length
        : 0;
    return (
      <li
        key={u.listKey}
        className={cn("relative flex min-h-0 min-w-0 items-stretch gap-3", !isLast && "pb-7")}
      >
        <div className="relative z-[2] h-full min-h-0 w-9 shrink-0 overflow-visible sm:w-10">
          <div className="relative mx-auto mt-[calc(1rem-5.5px)] flex justify-center">
            <TurnRailMarker ref={getDotRefForListKey(u.listKey)} status={st}
              active={active}
              t={t}
            />
          </div>
        </div>
        <button
          type="button"
          aria-label={t("threadDrawerTurnItemAria", { n: String(turnIdx + 1) })}
          onClick={() => setSelectedListKey(u.listKey)}
          className={cn(
            "min-w-0 flex-1 self-start rounded-md border px-2 py-1.5 text-left transition",
            active
              ? "border-primary bg-background shadow-sm ring-1 ring-primary/25"
              : "border-transparent bg-transparent hover:bg-muted/50",
          )}
        >
          <span className="block text-[11px] leading-5 text-muted-foreground">{u.whenLabel}</span>
          <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-foreground">
            {u.preview || "—"}
          </span>
          {mergedAsyncCount > 0 || mergedSubagentCount > 0 || legacyMergedTotal > 0 ? (
            <div className="mt-1.5 space-y-1 border-l-2 border-violet-300/90 pl-2.5 dark:border-violet-500/45">
              {mergedAsyncCount > 0 ? (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {t("threadDrawerAsyncFollowUpsHint", { count: String(mergedAsyncCount) })}
                </p>
              ) : null}
              {mergedSubagentCount > 0 ? (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {t("threadDrawerSubagentFollowUpsHint", { count: String(mergedSubagentCount) })}
                </p>
              ) : null}
              {legacyMergedTotal > 0 ? (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {t("threadDrawerAsyncFollowUpsHint", { count: String(legacyMergedTotal) })}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] tabular-nums">
            <Popover
              trigger="hover"
              position="top"
              content={
                <div className="space-y-1.5 p-1 text-xs">
                  <div className="font-medium text-foreground">{t("threadDrawerTurnExecTime")}</div>
                  <div className="text-muted-foreground">{t("threadDrawerTurnExecStart")}: {startedLabel}</div>
                  <div className="text-muted-foreground">{t("threadDrawerTurnExecEnd")}: {endedLabel}</div>
                </div>
              }
            >
              <span
                className="inline-flex items-center gap-0.5 font-medium text-amber-700 dark:text-amber-400/90"
                title={t("threadDrawerTurnExecTime")}
              >
                <IconClockCircle className="size-3.5 shrink-0" strokeWidth={3}/>
                {durLabel}
              </span>
            </Popover>
            {tokBreakdown ? (
              <Popover
                position="top"
                trigger="hover"
                content={
                  <div className="min-w-[12rem] space-y-2.5 py-1 text-left">
                    <div className="flex items-center gap-1.5 border-b border-neutral-100 pb-2">
                      <IconCommon className="size-3.5 text-violet-500" />
                      <span className="text-xs font-bold text-neutral-800">{t("semanticTokenUsageTitle")}</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-neutral-500">{t("detailAttrTokenPrompt")}</span>
                        <span className="tabular-nums text-neutral-800">{(metrics?.promptTokens ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-neutral-500">{t("detailAttrTokenCompletion")}</span>
                        <span className="tabular-nums text-neutral-800">{(metrics?.completionTokens ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-4 border-t border-neutral-100 pt-2 font-bold">
                        <span className="text-neutral-700">{t("colTotalTokens")}</span>
                        <span className="tabular-nums text-violet-600">{(metrics?.displayTotal ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                }
              >
                <span
                  className="inline-flex cursor-default items-center gap-0.5 font-medium text-violet-700 dark:text-violet-400/90"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconCode className="size-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  {tokShow}
                </span>
              </Popover>
            ) : (
              <span
                className="inline-flex items-center gap-0.5 font-medium text-muted-foreground/80"
                title={t("threadDrawerTurnTokensTotal")}
              >
                <IconCode className="size-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
                {tokShow}
              </span>
            )}
          </div>
        </button>
      </li>
    );
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {drillRow ? (
              <button
                type="button"
                className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                onClick={() => setDrillRow(null)}
              >
                {t("threadDrawerBackParentSession")}
              </button>
            ) : null}
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-400">
              <IconMessage className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="truncate text-lg font-semibold leading-tight text-foreground">
              {t("threadDrawerTitle")}
            </h2>
          </div>
          <DrawerClose
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("threadDrawerCloseAria")}
          >
            <IconClose className="size-5" aria-hidden />
          </DrawerClose>
        </div>

        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {eventsQuery.isFetching ? (
            <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              {t("loading")}
            </div>
          ) : eventsQuery.isError ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="p-6 text-sm text-destructive">{String(eventsQuery.error)}</p>
            </div>
          ) : userTurns.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="p-6 text-sm text-muted-foreground">{t("threadDrawerNoMessages")}</p>
            </div>
          ) : (
            <>
              <aside
                className="flex min-h-0 w-[min(100%,20rem)] shrink-0 flex-col border-r border-border bg-muted/15 dark:bg-neutral-900/30"
                aria-label={t("threadDrawerMessageTurnListAria")}
              >
                <div className="shrink-0 border-b border-border/80 px-3 py-2">
                  <p className="text-xs font-semibold leading-tight text-foreground">{t("threadDrawerMessagePickTurn")}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                    {t("threadDrawerMessageTurnCount", { count: String(userTurns.length) })}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
                  <div className="relative px-3 pt-3 pb-8">
                    <ul ref={timelineUlRef} className="relative list-none p-0">
                      {turnSpine != null && turnSpine.height > 0 ? (
                        <li
                          aria-hidden
                          className="pointer-events-none static m-0 block h-0 w-0 max-w-0 list-none overflow-visible p-0"
                        >
                          <span
                            className="pointer-events-none absolute z-0 block min-h-px w-px bg-neutral-300 dark:bg-neutral-600"
                            style={{
                              left: turnSpine.left,
                              top: turnSpine.top,
                              height: turnSpine.height,
                              transform: "translateX(-50%)",
                            }}
                          />
                        </li>
                      ) : null}
                      {turnRail}
                    </ul>
                  </div>
                </div>
              </aside>
              <ThreadDrawerMessageTranscript
                className="min-h-0 min-w-0 flex-1 overflow-hidden border-r border-border bg-background"
                events={merged}
                userTurns={userTurns}
                threadKey={threadKey}
                selectedListKey={selectedListKey}
                onOpenTrace={onOpenTrace}
                onOpenSubagentSession={openSubagentSession}
              />
              <aside
                className="flex min-h-0 w-[min(100%,21rem)] shrink-0 flex-col border-border bg-muted/10 dark:bg-neutral-900/25"
                aria-label={t("threadDrawerAuxInfoTitle")}
              >
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
                  <ThreadConversationInspectHeader
                    variant="sidebar"
                    row={activeRow}
                    threadKey={threadKey}
                    threadShort={threadShort}
                    listTotalTokens={listTotalTokens}
                    threadUsage={threadUsage}
                  />
                </div>
              </aside>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
