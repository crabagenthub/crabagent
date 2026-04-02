"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { TraceConversationView } from "@/components/trace-conversation-view";
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import { resolveEffectiveTraceRootId, type UserTurnListItem } from "@/lib/user-turn-list";
import { cn } from "@/lib/utils";

const INITIAL_VISIBLE = 15;
const LOAD_MORE_BATCH = 12;
const SCROLL_PADDING_TURNS = 2;

type Props = {
  className?: string;
  events: TraceTimelineEvent[];
  userTurns: UserTurnListItem[];
  threadKey: string;
  selectedListKey: string;
  onOpenTrace?: (traceId: string) => void;
};

export function ThreadDrawerMessageTranscript({
  className,
  events,
  userTurns,
  threadKey,
  selectedListKey,
  onOpenTrace,
}: Props) {
  const t = useTranslations("Traces");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevSelectedKeyRef = useRef<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(INITIAL_VISIBLE, Math.max(userTurns.length, 0)),
  );
  const prevThreadKey = useRef(threadKey);
  const turnKeysSig = useMemo(() => userTurns.map((u) => u.listKey).join("\n"), [userTurns]);

  useEffect(() => {
    if (userTurns.length === 0) {
      return;
    }
    setVisibleCount((v) => (v === 0 ? Math.min(INITIAL_VISIBLE, userTurns.length) : v));
  }, [userTurns.length]);

  useEffect(() => {
    if (prevThreadKey.current !== threadKey) {
      prevThreadKey.current = threadKey;
      prevSelectedKeyRef.current = null;
      setVisibleCount(Math.min(INITIAL_VISIBLE, userTurns.length));
    }
  }, [threadKey, userTurns.length]);

  useEffect(() => {
    if (userTurns.length === 0) {
      return;
    }
    const idx = userTurns.findIndex((u) => u.listKey === selectedListKey);
    if (idx < 0) {
      return;
    }
    const need = Math.min(userTurns.length, idx + 1 + SCROLL_PADDING_TURNS);
    setVisibleCount((v) => Math.max(v, need));

    const selectionChanged = prevSelectedKeyRef.current !== selectedListKey;
    prevSelectedKeyRef.current = selectedListKey;
    if (!selectionChanged) {
      return;
    }
    const id = `thread-conv-turn-${idx}`;
    const timer = window.setTimeout(() => {
      scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedListKey, turnKeysSig, userTurns]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || visibleCount >= userTurns.length) {
      return;
    }
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(v + LOAD_MORE_BATCH, userTurns.length));
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    );
    ob.observe(sentinel);
    return () => ob.disconnect();
  }, [userTurns.length, visibleCount]);

  const visibleTurns = userTurns.slice(0, visibleCount);
  const hasMore = visibleCount < userTurns.length;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden bg-background", className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[min(100%,48rem)] px-2 py-2 sm:px-3 sm:py-3">
          {visibleTurns.map((turn) => {
            const globalIdx = userTurns.findIndex((u) => u.listKey === turn.listKey);
            const active = turn.listKey === selectedListKey;
            return (
              <section
                key={turn.listKey}
                id={globalIdx >= 0 ? `thread-conv-turn-${globalIdx}` : undefined}
                className={cn(
                  "scroll-mt-2 rounded-xl border border-transparent py-2 sm:py-3",
                  active && "border-primary/35 bg-primary/[0.04] shadow-sm ring-1 ring-primary/20",
                )}
              >
                <TraceConversationView
                  events={events}
                  turn={turn}
                  threadKey={threadKey}
                  onViewSteps={
                    onOpenTrace
                      ? () => {
                          const traceId = resolveEffectiveTraceRootId(turn, events);
                          if (traceId) {
                            onOpenTrace(traceId);
                          }
                        }
                      : null
                  }
                  variant="turnEmbed"
                  conversationTurns={userTurns}
                  messagesOnly
                  compact
                />
              </section>
            );
          })}
          {hasMore ? (
            <div
              ref={sentinelRef}
              className="flex min-h-10 items-center justify-center py-3 text-center text-xs text-muted-foreground"
              aria-hidden
            >
              <span className="inline-flex items-center gap-2">
                <span className="inline-block size-3.5 animate-pulse rounded-full bg-muted-foreground/40" />
                {t("threadDrawerLoadingMoreTurns")}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
