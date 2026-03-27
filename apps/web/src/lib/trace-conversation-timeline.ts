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

function normType(e: TraceTimelineEvent): string {
  return String(e.type ?? "").toLowerCase();
}

function isUserTurnMessage(e: TraceTimelineEvent, turn: UserTurnListItem): boolean {
  return normType(e) === "message_received" && e.event_id === turn.listKey;
}

/** OpenClaw agent_end often carries the final `messages` transcript when no separate llm_output row exists. */
function assistantTextFromAgentEnd(e: TraceTimelineEvent): string | null {
  const p = payloadOf(e);
  const messages = p.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      continue;
    }
    const o = m as Record<string, unknown>;
    const role = String(o.role ?? "").toLowerCase();
    const typ = String(o.type ?? "").toLowerCase();
    const isAssistant =
      role === "assistant" ||
      role === "ai" ||
      role === "model" ||
      role === "bot" ||
      typ === "ai" ||
      typ === "aimessage" ||
      typ === "assistant";
    if (!isAssistant) {
      continue;
    }
    const content = o.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((x) => {
          if (typeof x === "string") {
            return x;
          }
          if (x && typeof x === "object" && !Array.isArray(x)) {
            const t = (x as Record<string, unknown>).text;
            return typeof t === "string" ? t : "";
          }
          return "";
        })
        .filter(Boolean);
      const joined = parts.join("\n").trim();
      if (joined) {
        return joined;
      }
    }
  }
  return null;
}

export function assistantTextFromLlmOutput(e: TraceTimelineEvent): string {
  const p = payloadOf(e);
  const texts = p.assistantTexts;
  if (Array.isArray(texts)) {
    const joined = texts.filter((x): x is string => typeof x === "string").join("\n").trim();
    if (joined) {
      return joined;
    }
  }
  for (const k of ["text", "content", "message"] as const) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  const nested = p.output;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const o = nested as Record<string, unknown>;
    const at2 = o.assistantTexts;
    if (Array.isArray(at2)) {
      const joined = at2.filter((x): x is string => typeof x === "string").join("\n").trim();
      if (joined) {
        return joined;
      }
    }
    for (const k of ["text", "content", "message"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
  }
  return "";
}

function thinkingSummaryFromLlmInput(e: TraceTimelineEvent): string {
  if (normType(e) !== "llm_input") {
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

export type BuildConversationTimelineOptions = {
  /** 仅保留用户气泡与助手回复，不插入折叠链路、不附带 thinking / memoryRefs。 */
  messagesOnly?: boolean;
};

/** Build chat-style timeline: user message, collapsed pipeline steps, assistant turns. */
export function buildConversationTimeline(
  events: TraceTimelineEvent[],
  turn: UserTurnListItem | null,
  opts?: BuildConversationTimelineOptions,
): ConversationTimelineItem[] {
  const messagesOnly = opts?.messagesOnly === true;
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
    if (messagesOnly) {
      buffer.length = 0;
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
    const ty = normType(e);

    if (ty === "llm_output") {
      const memRefs = messagesOnly ? [] : memoryRefsFromEvents(buffer);
      flushBuffer();
      const thinking =
        !messagesOnly && pendingLlmInput && normType(pendingLlmInput) === "llm_input"
          ? thinkingSummaryFromLlmInput(pendingLlmInput)
          : null;
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

    if (ty === "agent_end") {
      const fromTranscript = assistantTextFromAgentEnd(e);
      if (fromTranscript) {
        const memRefs = messagesOnly ? [] : memoryRefsFromEvents(buffer);
        flushBuffer();
        pendingLlmInput = null;
        items.push({
          kind: "assistant",
          text: fromTranscript,
          thinking: null,
          memoryRefs: memRefs,
          key: eventKey(e, i),
        });
        return;
      }
      buffer.push(e);
      return;
    }

    if (ty === "llm_input") {
      pendingLlmInput = e;
      return;
    }

    buffer.push(e);
  });

  if (pendingLlmInput) {
    if (!messagesOnly) {
      buffer.push(pendingLlmInput);
    }
    pendingLlmInput = null;
  }
  flushBuffer();

  return items;
}
