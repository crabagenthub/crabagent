import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import { stripInboundMetadata } from "@/lib/strip-inbound-meta";

const PREVIEW_LEN = 120;

export type UserTurnListItem = {
  /** message_received event_id or synthetic id for llm_input fallback */
  listKey: string;
  /** DB row id for ordering / linking */
  numericId: number;
  preview: string;
  fullText: string;
  /** Client or server time label */
  whenLabel: string;
  /** Next llm_input.run_id after this turn (same session when possible) */
  linkedRunId: string | null;
  /** message_received | llm_input (fallback) */
  source: "message_received" | "llm_input";
};

function rowNumericId(e: TraceTimelineEvent): number {
  const n = e.id;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  return Number.MAX_SAFE_INTEGER;
}

function previewOf(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_LEN) {
    return t || "—";
  }
  return `${t.slice(0, PREVIEW_LEN)}…`;
}

function whenOf(e: TraceTimelineEvent): string {
  return String(e.client_ts ?? e.created_at ?? "—");
}

function sessionsMatch(a: TraceTimelineEvent, b: TraceTimelineEvent): boolean {
  const ask = typeof a.session_key === "string" ? a.session_key.trim() : "";
  const bsk = typeof b.session_key === "string" ? b.session_key.trim() : "";
  if (ask && bsk && ask === bsk) {
    return true;
  }
  const asid = typeof a.session_id === "string" ? a.session_id.trim() : "";
  const bsid = typeof b.session_id === "string" ? b.session_id.trim() : "";
  if (asid && bsid && asid === bsid) {
    return true;
  }
  return !ask && !bsk && !asid && !bsid;
}

/**
 * Pull human-readable text from OpenClaw / channel message shapes (string, JSON string,
 * multimodal `content[]`, nested `{ text }`, etc.). Never returns JSON.stringify of the whole payload.
 */
function plainTextFromMessagePayload(payload: Record<string, unknown>): string {
  const fromShape = (c: unknown): string => {
    if (typeof c === "number" && Number.isFinite(c)) {
      return String(c);
    }
    if (typeof c === "string") {
      const t = c.trim();
      if (
        (t.startsWith("{") && t.endsWith("}")) ||
        (t.startsWith("[") && t.endsWith("]"))
      ) {
        try {
          const parsed = JSON.parse(t) as unknown;
          const inner = fromShape(parsed);
          if (inner.trim()) {
            return inner;
          }
        } catch {
          return c;
        }
      }
      return c;
    }
    if (!c || typeof c !== "object") {
      return "";
    }
    if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const item of c) {
        if (typeof item === "string") {
          parts.push(item);
          continue;
        }
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          if (typeof o.text === "string") {
            parts.push(o.text);
          } else if (typeof o.content === "string") {
            parts.push(o.content);
          } else if (Array.isArray(o.content)) {
            const nested = fromShape(o.content);
            if (nested.trim()) {
              parts.push(nested);
            }
          }
        }
      }
      return parts.join("\n").trim();
    }
    const o = c as Record<string, unknown>;
    if (typeof o.text === "string") {
      return o.text;
    }
    if (typeof o.content === "string" || Array.isArray(o.content)) {
      return fromShape(o.content);
    }
    if (typeof o.body === "string") {
      return o.body;
    }
    if (typeof o.message === "string") {
      return o.message;
    }
    if (o.message && typeof o.message === "object") {
      return fromShape(o.message);
    }
    return "";
  };

  const direct = fromShape(payload.content);
  if (direct.trim()) {
    return direct.trim();
  }

  const keys = ["text", "body", "message", "bodyForAgent", "prompt"] as const;
  for (const key of keys) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
    if (v && typeof v === "object") {
      const inner = fromShape(v);
      if (inner.trim()) {
        return inner.trim();
      }
    }
  }

  return "—";
}

/** Strip OpenClaw AI-facing metadata prefixes/suffixes, then normalize empty → em dash. */
function displayInboundText(raw: string): string {
  const stripped = stripInboundMetadata(raw).trim();
  return stripped.length > 0 ? stripped : "—";
}

/**
 * Find the first llm_input after `from` that matches session fields when possible.
 */
function findNextLlmRunId(
  sorted: TraceTimelineEvent[],
  from: TraceTimelineEvent,
): string | null {
  const fromId = rowNumericId(from);
  for (const e of sorted) {
    if (rowNumericId(e) <= fromId) {
      continue;
    }
    if (e.type !== "llm_input") {
      continue;
    }
    if (!sessionsMatch(from, e)) {
      continue;
    }
    const rid = typeof e.run_id === "string" ? e.run_id.trim() : "";
    return rid.length > 0 ? rid : null;
  }
  for (const e of sorted) {
    if (rowNumericId(e) <= fromId) {
      continue;
    }
    if (e.type !== "llm_input") {
      continue;
    }
    const rid = typeof e.run_id === "string" ? e.run_id.trim() : "";
    return rid.length > 0 ? rid : null;
  }
  return null;
}

function llmPromptPlainText(e: TraceTimelineEvent): string {
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (prompt.trim()) {
    return displayInboundText(prompt);
  }
  return displayInboundText(plainTextFromMessagePayload(payload));
}

/**
 * Left-nav items: prefer `message_received` rows; if none, one row per `llm_input` (prompt preview).
 */
export function buildUserTurnList(events: TraceTimelineEvent[]): UserTurnListItem[] {
  const sorted = [...events].sort((a, b) => rowNumericId(a) - rowNumericId(b));

  const received = sorted.filter((e) => e.type === "message_received");
  if (received.length > 0) {
    return received.map((e) => {
      const payload =
        e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
          ? (e.payload as Record<string, unknown>)
          : {};
      const fullText = displayInboundText(plainTextFromMessagePayload(payload));
      const eid = typeof e.event_id === "string" && e.event_id ? e.event_id : `row-${e.id ?? 0}`;
      return {
        listKey: eid,
        numericId: rowNumericId(e),
        preview: previewOf(fullText),
        fullText,
        whenLabel: whenOf(e),
        linkedRunId: findNextLlmRunId(sorted, e),
        source: "message_received",
      };
    });
  }

  const llmRows = sorted.filter((e) => e.type === "llm_input");
  return llmRows.map((e) => {
    const fullText = llmPromptPlainText(e);
    const rid = typeof e.run_id === "string" ? e.run_id.trim() : "";
    const eid = typeof e.event_id === "string" && e.event_id ? e.event_id : `row-${e.id ?? 0}`;
    return {
      listKey: eid,
      numericId: rowNumericId(e),
      preview: previewOf(fullText),
      fullText,
      whenLabel: whenOf(e),
      linkedRunId: rid.length > 0 ? rid : null,
      source: "llm_input",
    };
  });
}

export function filterEventsForRun(
  events: TraceTimelineEvent[],
  runId: string | null,
): TraceTimelineEvent[] {
  if (!runId?.trim()) {
    return [];
  }
  const r = runId.trim();
  return events.filter((e) => typeof e.run_id === "string" && e.run_id.trim() === r);
}
