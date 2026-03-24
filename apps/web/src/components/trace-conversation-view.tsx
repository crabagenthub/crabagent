"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import type { UserTurnListItem } from "@/lib/user-turn-list";
import { buildConversationTimeline, type ConversationTimelineItem } from "@/lib/trace-conversation-timeline";

function rowNumericId(e: TraceTimelineEvent): number {
  const n = e.id;
  return typeof n === "number" && Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function sortChronological(events: TraceTimelineEvent[]): TraceTimelineEvent[] {
  return [...events].sort((a, b) => {
    const da = rowNumericId(a);
    const db = rowNumericId(b);
    if (da !== db) {
      return da - db;
    }
    const ta = String(a.client_ts ?? a.created_at ?? "");
    const tb = String(b.client_ts ?? b.created_at ?? "");
    return ta.localeCompare(tb);
  });
}

function estimateStepsDurationMs(events: TraceTimelineEvent[]): number | null {
  if (events.length < 2) {
    return null;
  }
  const ts = events
    .map((e) => Date.parse(String(e.created_at ?? e.client_ts ?? "")))
    .filter((n) => Number.isFinite(n));
  if (ts.length < 2) {
    return null;
  }
  const d = Math.max(...ts) - Math.min(...ts);
  if (!Number.isFinite(d) || d < 0 || d > 3_600_000) {
    return null;
  }
  return d;
}

function typeSummary(events: TraceTimelineEvent[], max = 4): string {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const ty = typeof e.type === "string" && e.type.length > 0 ? e.type : "?";
    if (!seen.has(ty)) {
      seen.add(ty);
      order.push(ty);
      if (order.length >= max) {
        break;
      }
    }
  }
  return order.join(" · ");
}

function MemoryMarkedText({
  text,
  memoryRefs,
}: {
  text: string;
  memoryRefs: { label: string; excerpt: string }[];
}) {
  const parts = text.split(/(MEMORY\.md|memory\.md)/gi);
  const defaultTitle = memoryRefs[0]?.excerpt ?? "";
  return (
    <>
      {parts.map((part, i) => {
        if (/^MEMORY\.md$/i.test(part) || /^memory\.md$/i.test(part)) {
          const hit = memoryRefs.find((r) => /memory/i.test(r.label)) ?? memoryRefs[0];
          const title = hit?.excerpt ?? defaultTitle;
          return (
            <mark
              key={i}
              className="cursor-help rounded-sm bg-fuchsia-200/90 px-0.5 text-fuchsia-950 ring-1 ring-fuchsia-400/40"
              title={title || undefined}
            >
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function CollapsedPipelineBlock({
  item,
}: {
  item: Extract<ConversationTimelineItem, { kind: "collapsed" }>;
}) {
  const t = useTranslations("Traces");
  const events = useMemo(() => sortChronological(item.events), [item.events]);
  const ms = estimateStepsDurationMs(events);
  const typesShort = typeSummary(events);
  const hookish = events.filter((e) => {
    const ty = e.type ?? "";
    return ty.includes("tool") || ty === "hook_contribution" || ty === "before_tool" || ty === "after_tool";
  }).length;

  const summary =
    ms != null
      ? t("convCollapsedSummaryWithMs", { count: events.length, ms: String(Math.round(ms)) })
      : t("convCollapsedSummary", { count: events.length });

  return (
    <details className="group max-w-[min(100%,42rem)] rounded-xl border border-neutral-200/90 bg-neutral-50/80 px-3 py-2 text-left shadow-sm">
      <summary className="cursor-pointer list-none select-none text-[11px] text-neutral-600 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-neutral-700">{summary}</span>
        {hookish > 0 ? (
          <span className="ml-2 text-neutral-500">
            {t("convCollapsedToolish", { n: String(hookish) })}
          </span>
        ) : null}
        {typesShort ? (
          <span className="mt-0.5 block font-mono text-[10px] text-neutral-500">{typesShort}</span>
        ) : null}
      </summary>
      <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t border-neutral-200/80 pt-2 text-[10px] text-neutral-700">
        {events.map((e, idx) => (
          <li key={`${item.key}-${idx}`} className="font-mono">
            <span className="text-neutral-500">{e.type ?? "—"}</span>
            {e.event_id ? <span className="ml-2 text-neutral-400">{e.event_id.slice(0, 24)}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function AssistantBubble({
  text,
  thinking,
  memoryRefs,
}: {
  text: string;
  thinking: string | null;
  memoryRefs: { label: string; excerpt: string }[];
}) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex max-w-[min(100%,42rem)] flex-col items-stretch gap-1 self-end">
      {thinking ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white text-xs text-neutral-500 shadow-sm hover:border-ca-accent hover:text-ca-accent"
            aria-expanded={open}
            aria-label={t("convThinkingToggleAria")}
            title={t("convThinkingToggleAria")}
            onClick={() => setOpen((v) => !v)}
          >
            ⚙
          </button>
        </div>
      ) : null}
      {open && thinking ? (
        <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-[11px] leading-relaxed text-amber-950">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/80">
            {t("convThinkingTitle")}
          </p>
          <p className="mt-1 font-mono text-[11px]">{thinking}</p>
        </div>
      ) : null}
      <div className="rounded-2xl rounded-br-md border border-sky-200/90 bg-sky-50/95 px-4 py-3 text-sm leading-relaxed text-neutral-900 shadow-sm">
        <p className="whitespace-pre-wrap break-words">
          <MemoryMarkedText text={text} memoryRefs={memoryRefs} />
        </p>
      </div>
    </div>
  );
}

export function TraceConversationView({
  events,
  turn,
}: {
  events: TraceTimelineEvent[];
  turn: UserTurnListItem | null;
}) {
  const t = useTranslations("Traces");
  const items = useMemo(() => buildConversationTimeline(events, turn), [events, turn]);
  const hasAssistant = items.some((i) => i.kind === "assistant");

  if (!turn && items.length === 0) {
    return <p className="p-6 text-sm text-ca-muted">{t("convNoTurn")}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
        {items.map((item) => {
          if (item.kind === "user") {
            return (
              <div key={item.key} className="flex justify-start">
                <div className="max-w-[min(100%,42rem)] rounded-2xl rounded-bl-md border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-900 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    {t("convUserLabel")}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{item.text}</p>
                </div>
              </div>
            );
          }
          if (item.kind === "collapsed") {
            return (
              <div key={item.key} className="flex justify-center">
                <CollapsedPipelineBlock item={item} />
              </div>
            );
          }
          return (
            <div key={item.key} className="flex flex-col items-end gap-1">
              <AssistantBubble text={item.text} thinking={item.thinking} memoryRefs={item.memoryRefs} />
            </div>
          );
        })}
        {!hasAssistant && items.length > 0 ? (
          <p className="text-center text-xs text-amber-800/90">{t("convEmptyAssistant")}</p>
        ) : null}
      </div>
    </div>
  );
}
