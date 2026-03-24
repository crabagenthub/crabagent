import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import type { UserTurnListItem } from "@/lib/user-turn-list";

export type MemoryRefSnippet = { label: string; excerpt: string };

export type ConversationTimelineItem =
  | { kind: "user"; text: string; key: string }
  | {
      kind: "assistant";
      text: string;
      thinking: string | null;
      memoryRefs: MemoryRefSnippet[];
      key: string;
    }
  | { kind: "collapsed"; events: TraceTimelineEvent[]; key: string };

function payloadOf(e: TraceTimelineEvent): Record<string, unknown> {
  const p = e.payload;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

function isUserTurnMessage(e: TraceTimelineEvent, turn: UserTurnListItem): boolean {
  return e.type === "message_received" && e.event_id === turn.listKey;
}

export function assistantTextFromLlmOutput(e: TraceTimelineEvent): string {
  const p = payloadOf(e);
  const texts = p.assistantTexts;
  if (Array.isArray(texts)) {
    return texts.filter((x): x is string => typeof x === "string").join("\n").trim();
  }
  for (const k of ["text", "content", "message"] as const) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
}

function thinkingSummaryFromLlmInput(e: TraceTimelineEvent): string {
  if (e.type !== "llm_input") {
    return "";
  }
  const p = payloadOf(e);
  const prov = p.provider ?? "—";
  const model = p.model ?? "—";
  const hist = p.historyMessageCount;
  const img = p.imagesCount;
  const parts = [`${String(prov)} / ${String(model)}`];
  if (typeof hist === "number") {
    parts.push(`msgs ${hist}`);
  }
  if (typeof img === "number" && img > 0) {
    parts.push(`img ${img}`);
  }
  return parts.join(" · ");
}

function looksLikeMemoryRef(pathRaw: string, toolName: string, payloadJson: string): boolean {
  if (/MEMORY|memory\.md/i.test(pathRaw) || /\.md$/i.test(pathRaw)) {
    return true;
  }
  if (/memory|MEMORY\.md|read.*memory/i.test(toolName)) {
    return true;
  }
  return /MEMORY\.md|memory\.md/i.test(payloadJson.slice(0, 1200));
}

function memoryRefsFromEvents(events: TraceTimelineEvent[]): MemoryRefSnippet[] {
  const out: MemoryRefSnippet[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== "hook_contribution" && e.type !== "before_prompt_build") {
      continue;
    }
    const p = payloadOf(e);
    const pathRaw =
      (typeof p.file === "string" && p.file) ||
      (typeof p.path === "string" && p.path) ||
      (typeof p.uri === "string" && p.uri) ||
      "";
    const toolName = typeof p.toolName === "string" ? p.toolName : "";
    const payloadJson = JSON.stringify(p);
    if (!looksLikeMemoryRef(pathRaw, toolName, payloadJson)) {
      continue;
    }
    const label =
      pathRaw.trim().length > 0
        ? pathRaw.split("/").pop() ?? pathRaw
        : toolName.trim().length > 0
          ? toolName
          : "MEMORY";
    const excerpt =
      (typeof p.snippet === "string" && p.snippet) ||
      (typeof p.preview === "string" && p.preview) ||
      (typeof p.text === "string" && p.text) ||
      pathRaw ||
      payloadJson.slice(0, 280);
    const k = `${label}:${excerpt.slice(0, 48)}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push({ label, excerpt: excerpt.length > 400 ? `${excerpt.slice(0, 399)}…` : excerpt });
  }
  return out;
}

function eventKey(e: TraceTimelineEvent, i: number): string {
  if (typeof e.event_id === "string" && e.event_id.trim()) {
    return e.event_id.trim();
  }
  if (typeof e.id === "number") {
    return `id:${e.id}`;
  }
  return `idx:${i}`;
}

/** Build chat-style timeline: user message, collapsed pipeline steps, assistant turns. */
export function buildConversationTimeline(
  events: TraceTimelineEvent[],
  turn: UserTurnListItem | null,
): ConversationTimelineItem[] {
  const items: ConversationTimelineItem[] = [];
  if (turn) {
    items.push({ kind: "user", text: turn.fullText, key: `user:${turn.listKey}` });
  }

  const buffer: TraceTimelineEvent[] = [];
  let pendingLlmInput: TraceTimelineEvent | null = null;
  let seq = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }
    seq += 1;
    items.push({
      kind: "collapsed",
      events: [...buffer],
      key: `collapsed:${seq}`,
    });
    buffer.length = 0;
  };

  events.forEach((e, i) => {
    if (turn && isUserTurnMessage(e, turn)) {
      return;
    }
    const ty = typeof e.type === "string" ? e.type : "";

    if (ty === "llm_output") {
      const memRefs = memoryRefsFromEvents(buffer);
      flushBuffer();
      const thinking = pendingLlmInput && pendingLlmInput.type === "llm_input" ? thinkingSummaryFromLlmInput(pendingLlmInput) : null;
      pendingLlmInput = null;
      const text = assistantTextFromLlmOutput(e) || "—";
      items.push({
        kind: "assistant",
        text,
        thinking: thinking && thinking.length > 0 ? thinking : null,
        memoryRefs: memRefs,
        key: eventKey(e, i),
      });
      return;
    }

    if (ty === "llm_input") {
      pendingLlmInput = e;
      return;
    }

    buffer.push(e);
  });

  if (pendingLlmInput) {
    buffer.push(pendingLlmInput);
    pendingLlmInput = null;
  }
  flushBuffer();

  return items;
}
