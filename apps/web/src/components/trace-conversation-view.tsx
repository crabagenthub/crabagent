"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconBranch, IconCopy } from "@arco-design/web-react/icon";
import { LocalizedLink } from "@/components/localized-link";
import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/components/prompt-kit/chat-container";
import { Message, MessageContent } from "@/components/prompt-kit/message";
import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import {
  buildConversationTurnWindowEvents,
  buildDetailEventList,
  type UserTurnListItem,
} from "@/lib/user-turn-list";
import { buildConversationTimeline, type ConversationTimelineItem, type MemoryRefSnippet } from "@/lib/trace-conversation-timeline";
import { cn } from "@/lib/utils";

const TURN_DIVIDER = "#EEEEEE";

function userBubbleSurfaceClassNames(compact: boolean) {
  return cn(
    "!bg-[#E8EBFF] max-w-full rounded-xl [border:0] shadow-none ring-0 outline-none ring-offset-0 [box-shadow:none] text-neutral-900",
    compact ? "px-3 py-2 text-[13px] leading-snug" : "px-4 py-3 text-[15px] leading-relaxed",
  );
}

/** 与用户侧消息相同的气泡：`Message` + 浅紫底 `MessageContent`。 */
function UserConversationBubble({
  children,
  compact,
}: {
  children: ReactNode;
  compact: boolean;
}) {
  return (
    <Message className="max-w-[min(100%,70%)] flex-row-reverse">
      <MessageContent markdown={false} className={userBubbleSurfaceClassNames(compact)}>
        {children}
      </MessageContent>
    </Message>
  );
}

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
  memoryRefs: MemoryRefSnippet[];
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

/** Inline **bold** + MEMORY highlights. */
function renderInlineWithMemory(segment: string, memoryRefs: MemoryRefSnippet[]) {
  const fat = segment.split(/(\*\*[\s\S]*?\*\*)/g);
  return fat.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-neutral-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <MemoryMarkedText key={i} text={part} memoryRefs={memoryRefs} />;
  });
}

function SimpleMarkdownBlocks({
  text,
  memoryRefs,
  compact,
}: {
  text: string;
  memoryRefs: MemoryRefSnippet[];
  compact?: boolean;
}) {
  const bodySize = compact ? "text-[13px] leading-snug" : "text-[15px] leading-relaxed";
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]!);
        if (!m) {
          break;
        }
        items.push(m[1]!);
        i++;
      }
      blocks.push(
        <ul
          key={`ul-${blocks.length}`}
          className={cn("my-2 list-disc space-y-1.5 pl-5 text-neutral-900 marker:text-neutral-400", bodySize)}
        >
          {items.map((item, j) => (
            <li key={j}>{renderInlineWithMemory(item, memoryRefs)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (ordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(lines[i]!);
        if (!m) {
          break;
        }
        items.push(m[1]!);
        i++;
      }
      blocks.push(
        <ol
          key={`ol-${blocks.length}`}
          className={cn("my-2 list-decimal space-y-1.5 pl-5 text-neutral-900 marker:text-neutral-500", bodySize)}
        >
          {items.map((item, j) => (
            <li key={j}>{renderInlineWithMemory(item, memoryRefs)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    const para = paraLines.join("\n");
    blocks.push(
      <p key={`p-${blocks.length}`} className={cn("text-neutral-900", bodySize)}>
        {renderInlineWithMemory(para, memoryRefs)}
      </p>,
    );
  }
  return <div className="space-y-1">{blocks}</div>;
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
    <details
      className={cn(
        "group w-full max-w-[min(100%,42rem)] rounded-xl border px-3 py-2.5 text-left shadow-sm",
        "border-neutral-200/90 bg-[#F3F4F6]",
      )}
    >
      <summary className="cursor-pointer list-none select-none text-[12px] text-neutral-600 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium text-neutral-800">{summary}</span>
        {hookish > 0 ? (
          <span className="ml-2 text-neutral-500">{t("convCollapsedToolish", { n: String(hookish) })}</span>
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
  threadKey,
  msgId,
  onViewSteps,
  mergedReplyKind,
  systemInputText,
  messagesOnly,
  compact,
}: {
  text: string;
  thinking: string | null;
  memoryRefs: MemoryRefSnippet[];
  threadKey: string;
  msgId: string | null;
  onViewSteps?: (() => void) | null;
  /** 合并进本轮的助手回复类型；无则非合并主 trace 回复。 */
  mergedReplyKind?: "async" | "subagent" | null;
  systemInputText?: string | null;
  /** 会话抽屉等场景：仅展示对话正文，不展示 thinking / 查看链路。 */
  messagesOnly?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const traceHref = useMemo(() => {
    const base = `/traces?thread=${encodeURIComponent(threadKey)}`;
    const mid = (msgId ?? "").trim();
    return mid ? `${base}&msg_id=${encodeURIComponent(mid)}` : base;
  }, [threadKey, msgId]);

  const showTraceLink = threadKey.trim().length > 0;
  const canCopy = text.trim().length > 0;
  const splitAsyncUserStyleSystemInput = Boolean(
    mergedReplyKind && systemInputText && systemInputText.trim().length > 0,
  );

  const bubbleText = compact ? "text-[13px] leading-snug" : "text-[15px] leading-relaxed";
  const bubblePad = compact ? "px-3 py-2" : "px-4 py-3";

  const assistantRichBody =
    memoryRefs.length > 0 ? (
      text.trim() ? (
        <SimpleMarkdownBlocks text={text} memoryRefs={memoryRefs} compact={compact} />
      ) : (
        <p className={compact ? "text-xs" : "text-sm"}>—</p>
      )
    ) : null;

  const systemInputBody = splitAsyncUserStyleSystemInput ? (
    <pre className={cn("whitespace-pre-wrap break-words font-sans text-neutral-900 leading-relaxed", bubbleText)}>
      {systemInputText}
    </pre>
  ) : null;

  const showMergedKindBadge = mergedReplyKind != null;
  const showAssistantToolbar =
    showMergedKindBadge || canCopy || onViewSteps || (!onViewSteps && showTraceLink);

  return (
    <div className="flex w-full flex-col">
      {splitAsyncUserStyleSystemInput ? (
        <div className="mb-5 flex w-full shrink-0 justify-end">
          <UserConversationBubble compact={compact ?? false}>{systemInputBody}</UserConversationBubble>
        </div>
      ) : null}

      <div className="flex w-full max-w-[min(100%,70%)] flex-col items-stretch gap-2 self-start">
        {showAssistantToolbar ? (
          <div className="flex flex-wrap items-center gap-3 pl-0.5 text-xs text-neutral-500">
            {showMergedKindBadge ? (
              <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200/80">
                {mergedReplyKind === "subagent" ? t("convAssistantBadgeSubagent") : t("convAssistantBadgeAsync")}
              </span>
            ) : null}
            {canCopy ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-neutral-800"
                title={copied ? t("detailCopied") : t("detailCopy")}
                aria-label={t("detailCopy")}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text.trim());
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <IconCopy className="size-3.5 shrink-0" />
                {t("detailCopy")}
              </button>
            ) : null}
            {onViewSteps ? (
              <button
                type="button"
                title={t("convViewSteps")}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-neutral-800"
                onClick={onViewSteps}
              >
                <IconBranch className="size-3.5 shrink-0" />
                {t("convViewSteps")}
              </button>
            ) : showTraceLink ? (
              <LocalizedLink
                href={traceHref}
                title={t("convViewSteps")}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-neutral-800"
              >
                <IconBranch className="size-3.5 shrink-0" />
                {t("convViewSteps")}
              </LocalizedLink>
            ) : null}
          </div>
        ) : null}

      {!messagesOnly && thinking ? (
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-md border border-neutral-200/90 bg-white text-xs text-neutral-500 shadow-sm hover:border-neutral-300 hover:text-neutral-800"
          aria-expanded={open}
          aria-label={t("convThinkingToggleAria")}
          title={t("convThinkingToggleAria")}
          onClick={() => setOpen((v) => !v)}
        >
          ⚙
        </button>
      ) : null}
      {!messagesOnly && open && thinking ? (
        <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-[11px] leading-relaxed text-amber-950">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/80">
            {t("convThinkingTitle")}
          </p>
          <p className="mt-1 font-mono text-[11px]">{thinking}</p>
        </div>
      ) : null}
      {memoryRefs.length > 0 ? (
        <MessageContent
          markdown={false}
          className={cn(
            "!bg-[#F8F9FA] rounded-xl border-b border-neutral-200/90 text-neutral-900 shadow-none",
            bubbleText,
            bubblePad,
          )}
        >
          {assistantRichBody as ReactNode}
        </MessageContent>
      ) : text.trim() ? (
        <MessageContent
          markdown
          className={cn(
            "!bg-[#F8F9FA] rounded-xl border-b border-neutral-200/90 text-neutral-900 shadow-none prose-headings:my-2 prose-p:my-1.5",
            compact && "prose-sm",
            bubbleText,
            bubblePad,
          )}
        >
          {text.trim()}
        </MessageContent>
      ) : (
        <MessageContent
          markdown={false}
          className={cn(
            "!bg-[#F8F9FA] rounded-xl border-b border-neutral-200/90 text-neutral-900 shadow-none",
            bubbleText,
            bubblePad,
          )}
        >
          <p className={compact ? "text-xs" : "text-sm"}>—</p>
        </MessageContent>
      )}
      </div>
    </div>
  );
}

function ConversationTimelineBlocks({
  items,
  threadKey,
  msgId,
  onViewSteps,
  messagesOnly,
  compact,
}: {
  items: ConversationTimelineItem[];
  threadKey: string;
  msgId: string | null;
  /** 每条助手气泡对应 `llm_output` 的 `trace_root_id`；异步跟进须打开该 id，而非整轮主 trace。 */
  onViewSteps?: ((detailTraceRootId: string | null) => void) | null;
  messagesOnly?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("Traces");
  const hasAssistant = items.some((i) => i.kind === "assistant");

  return (
    <>
      <div className="w-full min-w-0">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const nextItem = !isLast ? items[idx + 1] : null;
          const dividerStyle = { borderColor: TURN_DIVIDER };
          const showDivider = (() => {
            if (isLast) {
              return false;
            }
            if (!messagesOnly) {
              return true;
            }
            if (item.kind === "user") {
              return nextItem?.kind === "user";
            }
            return nextItem?.kind === "user";
          })();

          if (item.kind === "user") {
            return (
              <div
                key={item.key}
                className={cn("flex justify-end pb-5", showDivider && "mb-5 border-b")}
                style={showDivider ? dividerStyle : undefined}
              >
                <UserConversationBubble compact={compact ?? false}>
                  <p className="whitespace-pre-wrap break-words">{item.text}</p>
                </UserConversationBubble>
              </div>
            );
          }
          if (item.kind === "collapsed") {
            return (
              <div
                key={item.key}
                className={cn("flex justify-start pb-5", showDivider && "mb-5 border-b")}
                style={showDivider ? dividerStyle : undefined}
              >
                <CollapsedPipelineBlock item={item} />
              </div>
            );
          }
          return (
            <div
              key={item.key}
              className={cn("flex flex-col pb-5", showDivider && "mb-5 border-b")}
              style={showDivider ? dividerStyle : undefined}
            >
              <AssistantBubble
                text={item.text}
                thinking={item.thinking}
                memoryRefs={item.memoryRefs}
                threadKey={threadKey}
                msgId={msgId}
                onViewSteps={
                  onViewSteps
                    ? () => {
                        onViewSteps(item.detailTraceRootId ?? null);
                      }
                    : null
                }
                mergedReplyKind={item.mergedReplyKind ?? null}
                systemInputText={item.systemInputText ?? null}
                messagesOnly={messagesOnly}
                compact={compact}
              />
            </div>
          );
        })}
        {!hasAssistant && items.length > 0 ? (
          <p className={cn("pt-2 text-center text-amber-800/90", compact ? "text-[11px]" : "text-xs")}>
            {t("convEmptyAssistant")}
          </p>
        ) : null}
      </div>
    </>
  );
}

export type TraceConversationViewVariant = "panel" | "turnEmbed";

export function TraceConversationView({
  events,
  turn,
  threadKey,
  onViewSteps,
  variant = "panel",
  /** When `variant` is `turnEmbed`, pass full ordered turns so each block can slice [anchor, next anchor) and keep `llm_output` rows. */
  conversationTurns,
  /** 仅用户输入 + 助手输出（无折叠链路、thinking、查看全链路链接）。 */
  messagesOnly = false,
  /** 缩小正文字号（如会话抽屉对话区）。 */
  compact = false,
}: {
  events: TraceTimelineEvent[];
  turn: UserTurnListItem | null;
  /** Conversation id for full-page trace link (same as route `/traces/[threadKey]`). */
  threadKey: string;
  onViewSteps?: ((detailTraceRootId: string | null) => void) | null;
  /** `turnEmbed`: no outer chat chrome; for stacking in full-session transcript. */
  variant?: TraceConversationViewVariant;
  conversationTurns?: UserTurnListItem[];
  messagesOnly?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("Traces");
  const scopedEvents = useMemo(() => {
    if (turn == null) {
      return events;
    }
    if (variant === "turnEmbed" && conversationTurns != null && conversationTurns.length > 0) {
      // In tree mode, "turnEmbed" still uses a time-window slice [anchor, nextAnchor).
      // For external parent turns we want to merge async/subagent descendants as well,
      // which is only honored by `buildDetailEventList` (via `mergedTraceRootIds`).
      if (turn.mergedTraceRootIds && turn.mergedTraceRootIds.length > 0) {
        return buildDetailEventList(events, turn);
      }
      return buildConversationTurnWindowEvents(events, turn, conversationTurns);
    }
    return buildDetailEventList(events, turn);
  }, [events, turn, variant, conversationTurns]);
  const items = useMemo(
    () => buildConversationTimeline(scopedEvents, turn, { messagesOnly }),
    [scopedEvents, turn, messagesOnly],
  );

  if (!turn && items.length === 0) {
    return (
      <p className={cn("p-6 text-ca-muted", compact ? "text-xs" : "text-sm")}>{t("convNoTurn")}</p>
    );
  }

  const msgId = turn?.msgId ?? null;

  const blocks = (
    <ConversationTimelineBlocks
      items={items}
      threadKey={threadKey}
      msgId={msgId}
      onViewSteps={onViewSteps}
      messagesOnly={messagesOnly}
      compact={compact}
    />
  );

  if (variant === "turnEmbed") {
    return <div className="min-w-0">{blocks}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <ChatContainerRoot className="min-h-0 flex-1">
        <ChatContainerContent className="gap-0 px-3 py-4 sm:px-5 sm:py-5">{blocks}</ChatContainerContent>
      </ChatContainerRoot>
    </div>
  );
}
