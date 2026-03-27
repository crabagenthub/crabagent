"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ThreadDrawerMessageTranscript } from "@/components/thread-drawer-message-transcript";
import { TraceTimelineTree } from "@/components/trace-timeline-tree";
import { Drawer, DrawerClose } from "@/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { loadTraceEvents } from "@/lib/trace-events";
import { type ThreadRecordRow } from "@/lib/thread-records";
import { formatDurationMs } from "@/lib/trace-records";
import { pipelineCoverageFromEvents } from "@/lib/trace-detail-pipeline";
import {
  buildConversationTurnWindowEvents,
  buildDetailEventList,
  buildUserTurnList,
  inferTurnListStatus,
  inferTurnWindowMetrics,
  type TurnListStatus,
} from "@/lib/user-turn-list";
import { cn } from "@/lib/utils";
import { Binary, Bot, Clock, Copy, GaugeCircle, MessageSquare, Radio, Timer } from "lucide-react";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

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

/** 消息模式侧栏：竖线 + 圆圈内序号（与产品设计图一致） */
function TurnRailNumber({
  index,
  status,
  active,
  t,
}: {
  index: number;
  status: TurnListStatus;
  active: boolean;
  t: (key: string) => string;
}) {
  const title = t(turnStatusLabelKey(status));
  return (
    <div
      title={title}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums tracking-tight text-neutral-900 dark:text-neutral-50",
        active
          ? "bg-white shadow-sm ring-2 ring-primary/40 dark:bg-neutral-950 dark:ring-primary/45"
          : "bg-[#f5f5f5] dark:bg-neutral-800",
        status === "running" && "motion-safe:animate-pulse",
        status === "error" && !active && "ring-2 ring-destructive/45",
        status === "timeout" && !active && "ring-2 ring-amber-400/55",
      )}
      aria-hidden
    >
      {index + 1}
    </div>
  );
}

type TabId = "message" | "link";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ThreadRecordRow | null;
  baseUrl: string;
  apiKey: string;
};

export function ThreadConversationDrawer({ open, onOpenChange, row, baseUrl, apiKey }: Props) {
  const t = useTranslations("Traces");
  const [tab, setTab] = useState<TabId>("message");
  const threadKey = row?.thread_id ?? "";

  const eventsQuery = useQuery({
    queryKey: ["trace-events", baseUrl, apiKey, threadKey],
    queryFn: () => loadTraceEvents(baseUrl, apiKey, threadKey),
    enabled: open && baseUrl.trim().length > 0 && threadKey.length > 0,
  });

  const merged = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data?.items]);

  const userTurns = useMemo(() => buildUserTurnList(merged), [merged]);

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
      const windowEv = buildConversationTurnWindowEvents(merged, u, userTurns);
      m.set(u.listKey, inferTurnWindowMetrics(windowEv));
    }
    return m;
  }, [merged, userTurns]);

  const linkPipeline = useMemo(() => pipelineCoverageFromEvents(merged), [merged]);

  const [selectedListKey, setSelectedListKey] = useState("");

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

  const threadShort =
    threadKey.length > 28 ? `${threadKey.slice(0, 14)}…${threadKey.slice(-10)}` : threadKey;

  const metaWhen =
    row && row.last_seen_ms > 0 ? formatTraceDateTimeLocal(new Date(row.last_seen_ms).toISOString()) : "—";
  const metaDuration =
    row?.duration_ms != null && row.duration_ms > 0 ? formatDurationMs(row.duration_ms) : "—";
  const metaMsgCount = userTurns.length > 0 ? userTurns.length : row?.trace_count ?? 0;
  const metaTokens = row != null ? row.total_tokens.toLocaleString() : "—";

  useEffect(() => {
    if (open) {
      setTab("message");
    }
  }, [open]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
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
                {t("threadDrawerTitle")}
              </Dialog.Title>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={threadKey || undefined}>
                {threadKey ? threadShort : "—"}
              </span>
              {threadKey ? (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void copyText(threadKey)}
                  aria-label={t("threadDrawerCopyThreadId")}
                >
                  <Copy className="size-3.5" strokeWidth={2} aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                {metaWhen}
              </span>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                {t("threadDrawerTurnCount", { count: String(metaMsgCount) })}
              </span>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3.5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                {t("colDuration")}: <span className="tabular-nums text-foreground">{metaDuration}</span>
              </span>
              <span className="text-border">·</span>
              <span className="inline-flex items-center gap-1">
                <Binary className="size-3.5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                {t("colTotalTokens")}: <span className="tabular-nums text-foreground">{metaTokens}</span>
              </span>
            </div>
            {row?.agent_name ? (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-foreground">
                <Bot className="size-3.5 shrink-0 text-muted-foreground opacity-80" strokeWidth={2} aria-hidden />
                <span className="text-muted-foreground">{t("threadsColAgent")}:</span>
                <span>{row.agent_name}</span>
              </p>
            ) : null}
            {row?.channel_name ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-foreground">
                <Radio className="size-3.5 shrink-0 text-muted-foreground opacity-80" strokeWidth={2} aria-hidden />
                <span className="text-muted-foreground">{t("threadsColChannel")}:</span>
                <span>{row.channel_name}</span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-0 border-b border-border px-4">
          <button
            type="button"
            className={`relative px-1 pb-3 pt-2 text-sm font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 ${
              tab === "message"
                ? "text-primary after:bg-primary"
                : "text-muted-foreground hover:text-foreground after:bg-transparent"
            }`}
            onClick={() => setTab("message")}
          >
            {t("threadDrawerTabMessageMode")}
          </button>
          <button
            type="button"
            className={`relative ml-6 px-1 pb-3 pt-2 text-sm font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 ${
              tab === "link"
                ? "text-primary after:bg-primary"
                : "text-muted-foreground hover:text-foreground after:bg-transparent"
            }`}
            onClick={() => setTab("link")}
          >
            {t("threadDrawerTabLinkMode")}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {eventsQuery.isFetching ? (
            <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              {t("loading")}
            </div>
          ) : eventsQuery.isError ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="p-6 text-sm text-destructive">{String(eventsQuery.error)}</p>
            </div>
          ) : tab === "link" ? (
            merged.length === 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <p className="p-6 text-sm text-muted-foreground">{t("threadDrawerLinkEmpty")}</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {linkPipeline.orderedTypes.length > 0 ? (
                  <div className="shrink-0 border-b border-border p-3 sm:px-4 sm:py-3">
                    <p className="mb-2 text-xs text-muted-foreground">{t("threadDrawerLinkHint")}</p>
                    <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/50 px-3 py-2.5 sm:px-4 sm:py-3">
                      <p className="text-xs font-semibold text-emerald-950">{t("threadDrawerPipelineTitle")}</p>
                      <p className="mt-1 text-[11px] text-emerald-900/80">
                        {t("threadDrawerPipelineTypeCount", {
                          count: String(linkPipeline.orderedTypes.length),
                        })}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {linkPipeline.orderedTypes.map((ty) => (
                          <span
                            key={ty}
                            className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/95 px-2 py-0.5 font-mono text-[10px] text-emerald-950 ring-1 ring-emerald-200/80"
                            title={ty}
                          >
                            <span className="truncate">{ty}</span>
                            <span className="shrink-0 tabular-nums text-emerald-700">
                              ×{linkPipeline.counts[ty] ?? 0}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
                    <p className="text-xs text-muted-foreground">{t("threadDrawerLinkHint")}</p>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                  <div className="rounded-xl border border-border bg-neutral-50/40 p-2 sm:p-3">
                    <TraceTimelineTree events={merged} />
                  </div>
                </div>
              </div>
            )
          ) : userTurns.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="p-6 text-sm text-muted-foreground">{t("threadDrawerNoMessages")}</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
              <aside
                className="flex min-h-0 w-full max-h-[min(42vh,19rem)] shrink-0 flex-col border-b border-border bg-muted/20 sm:max-h-none sm:w-[min(100%,20rem)] sm:shrink-0 sm:border-b-0 sm:border-r"
                aria-label={t("threadDrawerMessageTurnListAria")}
              >
                <div className="shrink-0 border-b border-border/80 px-2.5 py-2">
                  <p className="text-xs font-semibold leading-tight text-foreground">{t("threadDrawerMessagePickTurn")}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                    {t("threadDrawerMessageTurnCount", { count: String(userTurns.length) })}
                  </p>
                </div>
                <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 py-3">
                  <div
                    className="pointer-events-none absolute bottom-5 left-[19px] top-4 w-0.5 rounded-full bg-[#eeeeee] dark:bg-neutral-700"
                    aria-hidden
                  />
                  <ul className="relative space-y-10">
                    {userTurns.map((u, turnIdx) => {
                      const active = u.listKey === selectedListKey;
                      const st = turnStatusByKey.get(u.listKey) ?? "unknown";
                      const metrics = turnMetricsByKey.get(u.listKey);
                      const durLabel =
                        metrics?.durationMs != null && metrics.durationMs >= 0
                          ? formatDurationMs(metrics.durationMs)
                          : "—";
                      const tokTotal = metrics?.displayTotal;
                      const tokShow =
                        tokTotal != null && Number.isFinite(tokTotal) && tokTotal > 0
                          ? tokTotal.toLocaleString()
                          : "—";
                      const tokBreakdown =
                        (metrics?.promptTokens ?? 0) > 0 || (metrics?.completionTokens ?? 0) > 0 || tokTotal != null;
                      return (
                        <li key={u.listKey} className="relative flex items-start gap-3">
                          <div className="relative z-[1] flex w-10 shrink-0 justify-center pt-0.5">
                            <TurnRailNumber index={turnIdx} status={st} active={active} t={t} />
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedListKey(u.listKey)}
                            className={cn(
                              "min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left transition",
                              active
                                ? "border-primary bg-background shadow-sm ring-1 ring-primary/25"
                                : "border-transparent bg-transparent hover:bg-muted/50",
                            )}
                          >
                            <span className="block font-mono text-[11px] leading-5 text-muted-foreground">
                              {u.whenLabel}
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-foreground">
                              {u.preview || "—"}
                            </span>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] tabular-nums">
                              <span
                                className="inline-flex items-center gap-0.5 font-medium text-amber-700 dark:text-amber-400/90"
                                title={t("threadDrawerTurnExecTime")}
                              >
                                <GaugeCircle className="size-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                                {durLabel}
                              </span>
                              {tokBreakdown ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={(triggerProps) => (
                                      <span
                                        {...triggerProps}
                                        className={cn(
                                          "inline-flex cursor-default items-center gap-0.5 font-medium text-violet-700 dark:text-violet-400/90",
                                          triggerProps.className,
                                        )}
                                        title={t("threadDrawerTurnTokensTotal")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          triggerProps.onClick?.(e);
                                        }}
                                      >
                                        <Binary className="size-3 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                                        {tokShow}
                                      </span>
                                    )}
                                  />
                                  <TooltipContent
                                    side="top"
                                    sideOffset={6}
                                    className="max-w-xs border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
                                  >
                                    {(metrics?.promptTokens ?? 0) === 0 &&
                                    (metrics?.completionTokens ?? 0) === 0 &&
                                    tokTotal != null &&
                                    tokTotal > 0 ? (
                                      <span className="block text-left leading-snug">
                                        {t("threadDrawerTurnTokensUnsplit", { count: tokShow })}
                                      </span>
                                    ) : (
                                      <div className="flex flex-col gap-1">
                                        <span className="text-left">
                                          {t("threadDrawerTurnTokensIn", {
                                            count: String(metrics?.promptTokens ?? 0),
                                          })}
                                        </span>
                                        <span className="text-left">
                                          {t("threadDrawerTurnTokensOut", {
                                            count: String(metrics?.completionTokens ?? 0),
                                          })}
                                        </span>
                                      </div>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-0.5 font-medium text-muted-foreground/80"
                                  title={t("threadDrawerTurnTokensTotal")}
                                >
                                  <Binary className="size-3 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
                                  {tokShow}
                                </span>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </aside>
              <ThreadDrawerMessageTranscript
                className="min-h-0 min-w-0 flex-1 overflow-hidden sm:min-w-0"
                events={merged}
                userTurns={userTurns}
                threadKey={threadKey}
                selectedListKey={selectedListKey}
              />
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
