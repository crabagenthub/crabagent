import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";
import { eventRunId } from "@/lib/trace-event-run-id";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { usageFromTracePayload } from "@/lib/trace-payload-usage";

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
  /** Ingest trace root for this turn; detail timeline filters by this id. */
  traceRootId: string | null;
  agentId: string | null;
  /** Config display name when present (collector `agent_name`). */
  agentName: string | null;
  chatTitle: string | null;
  /** Plugin correlation id: same on message_received and later hooks for one user turn. */
  msgId: string | null;
};

function rowNumericId(e: TraceTimelineEvent): number {
  const n = e.id as unknown;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  if (typeof n === "string" && n.trim() !== "") {
    const p = Number(n);
    if (Number.isFinite(p)) {
      return p;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/** Order llm_input before llm_output when ids/timestamps tie (same OpenClaw trace triplet). */
function conversationTypePhase(type: string | undefined): number {
  const t = (type ?? "").toLowerCase();
  if (t === "message_received") {
    return 0;
  }
  if (t === "llm_input") {
    return 1;
  }
  if (t === "llm_output") {
    return 2;
  }
  if (t === "agent_end") {
    return 3;
  }
  return 4;
}

function compareTimelineChrono(a: TraceTimelineEvent, b: TraceTimelineEvent): number {
  const da = rowNumericId(a);
  const db = rowNumericId(b);
  if (da !== db) {
    return da - db;
  }
  const ta = Date.parse(String(a.client_ts ?? a.created_at ?? ""));
  const tb = Date.parse(String(b.client_ts ?? b.created_at ?? ""));
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
    return ta - tb;
  }
  const pa = conversationTypePhase(a.type);
  const pb = conversationTypePhase(b.type);
  if (pa !== pb) {
    return pa - pb;
  }
  const ea = typeof a.event_id === "string" ? a.event_id : "";
  const eb = typeof b.event_id === "string" ? b.event_id : "";
  return ea.localeCompare(eb);
}

function dedupeKeyForEvent(e: TraceTimelineEvent): string {
  if (typeof e.event_id === "string" && e.event_id.trim()) {
    return `e:${e.event_id.trim()}`;
  }
  if (typeof e.id === "number" && Number.isFinite(e.id)) {
    return `i:${e.id}`;
  }
  return `u:${String(e.type ?? "")}:${String(e.client_ts ?? e.created_at ?? "")}`;
}

/** Union two event lists by stable identity (event_id or row id). */
function mergeTraceEventsDedupe(a: TraceTimelineEvent[], b: TraceTimelineEvent[]): TraceTimelineEvent[] {
  const seen = new Set<string>();
  const out: TraceTimelineEvent[] = [];
  for (const row of [...a, ...b]) {
    const k = dedupeKeyForEvent(row);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(row);
  }
  return out;
}

function previewOf(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_LEN) {
    return t || "—";
  }
  return `${t.slice(0, PREVIEW_LEN)}…`;
}

function whenOf(e: TraceTimelineEvent): string {
  return formatTraceDateTimeLocal(e.client_ts ?? e.created_at);
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Top-level `msg_id` from ingest, or `payload.msg_id` fallback. */
export function eventMsgId(e: TraceTimelineEvent): string | null {
  const top = strOrNull((e as { msg_id?: unknown }).msg_id);
  if (top) {
    return top;
  }
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  return strOrNull(payload.msg_id);
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

/** Strip metadata blocks; if body empty, use text/title/sender from Conversation info JSON. */
function displayInboundText(raw: string): string {
  const stripped = extractInboundDisplayPreview(raw).trim();
  return stripped.length > 0 ? stripped : "—";
}

/**
 * Find the first llm_input after `from` whose run_id should represent this user turn.
 * Prefer same trace_root_id (matches ingest plugin correlation); then session_key/session_id;
 * then any later llm_input.
 */
function findNextLlmRunId(
  sorted: TraceTimelineEvent[],
  from: TraceTimelineEvent,
): string | null {
  const fromId = rowNumericId(from);
  const fromTrace = strOrNull(from.trace_root_id);

  if (fromTrace) {
    for (const e of sorted) {
      if (rowNumericId(e) <= fromId) {
        continue;
      }
      if (e.type !== "llm_input") {
        continue;
      }
      if (strOrNull(e.trace_root_id) !== fromTrace) {
        continue;
      }
      const rid = eventRunId(e);
      if (rid.length > 0) {
        return rid;
      }
    }
  }

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
    const rid = eventRunId(e);
    if (rid.length > 0) {
      return rid;
    }
  }
  for (const e of sorted) {
    if (rowNumericId(e) <= fromId) {
      continue;
    }
    if (e.type !== "llm_input") {
      continue;
    }
    const rid = eventRunId(e);
    if (rid.length > 0) {
      return rid;
    }
  }
  return null;
}

/** First non-empty llm_input.run_id in chronological order (for UI when linkedRunId was not precomputed). */
export function firstLlmRunIdInEvents(events: TraceTimelineEvent[]): string | null {
  const sorted = [...events].sort((a, b) => rowNumericId(a) - rowNumericId(b));
  for (const e of sorted) {
    if (e.type !== "llm_input") {
      continue;
    }
    const rid = eventRunId(e);
    if (rid.length > 0) {
      return rid;
    }
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
        source: "message_received" as const,
        traceRootId: strOrNull(e.trace_root_id),
        agentId: strOrNull(e.agent_id),
        agentName: strOrNull(e.agent_name),
        chatTitle: strOrNull(e.chat_title),
        msgId: eventMsgId(e),
      };
    });
  }

  const llmRows = sorted.filter((e) => e.type === "llm_input");
  return llmRows.map((e) => {
    const fullText = llmPromptPlainText(e);
    const rid = eventRunId(e);
    const eid = typeof e.event_id === "string" && e.event_id ? e.event_id : `row-${e.id ?? 0}`;
    return {
      listKey: eid,
      numericId: rowNumericId(e),
      preview: previewOf(fullText),
      fullText,
      whenLabel: whenOf(e),
      linkedRunId: rid.length > 0 ? rid : null,
      source: "llm_input" as const,
      traceRootId: strOrNull(e.trace_root_id),
      agentId: strOrNull(e.agent_id),
      agentName: strOrNull(e.agent_name),
      chatTitle: strOrNull(e.chat_title),
      msgId: eventMsgId(e),
    };
  });
}

/** All events sharing the same ingest `trace_root_id` (one internal trace chain). */
export function filterEventsForTraceRoot(
  events: TraceTimelineEvent[],
  traceRootId: string | null | undefined,
): TraceTimelineEvent[] {
  const tr = typeof traceRootId === "string" ? traceRootId.trim() : "";
  if (!tr) {
    return [];
  }
  return events.filter((e) => {
    const er = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    return er === tr;
  });
}

/**
 * When `message_received` has no `trace_root_id` but later rows in the same thread already do
 * (plugin assigns root on hooks before llm_input), use the first such root — same idea as
 * Collector `effective_trace_root` SQL.
 */
function firstTraceRootIdAfterMessage(events: TraceTimelineEvent[], messageEventId: string): string | null {
  const sorted = [...events].sort((a, b) => rowNumericId(a) - rowNumericId(b));
  const idx = sorted.findIndex((e) => e.event_id === messageEventId);
  if (idx < 0) {
    return null;
  }
  for (let i = idx + 1; i < sorted.length; i++) {
    const tr = strOrNull(sorted[i]!.trace_root_id);
    if (tr) {
      return tr;
    }
  }
  return null;
}

/** Prefer any event row that already carries `trace_root_id` (e.g. message_received). */
export function resolveTraceRootIdFromRunId(
  events: TraceTimelineEvent[],
  runId: string | null | undefined,
): string | null {
  const r = typeof runId === "string" ? runId.trim() : "";
  if (!r) {
    return null;
  }
  for (const e of events) {
    if (eventRunId(e) !== r) {
      continue;
    }
    const tr = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    if (tr) {
      return tr;
    }
  }
  return null;
}

function resolveRunIdForTurnDetail(turn: UserTurnListItem, events: TraceTimelineEvent[]): string {
  const direct = turn.linkedRunId?.trim();
  if (direct) {
    return direct;
  }
  return resolveLinkedRunIdForTurn(turn, events)?.trim() ?? "";
}

/**
 * Effective trace root for UI: message row may omit `trace_root_id` while later `llm_*` rows have it.
 */
export function resolveEffectiveTraceRootId(
  turn: UserTurnListItem,
  events: TraceTimelineEvent[],
): string | null {
  const fromTurn = turn.traceRootId?.trim();
  if (fromTurn) {
    return fromTurn;
  }
  const run = resolveRunIdForTurnDetail(turn, events);
  const fromRun = resolveTraceRootIdFromRunId(events, run || null);
  if (fromRun) {
    return fromRun;
  }
  return firstTraceRootIdAfterMessage(events, turn.listKey);
}

/**
 * All events for the detail timeline: same trace_root as the turn (including pre-LLM hooks without run_id).
 * Falls back to run-only slice when no trace root can be resolved.
 */
export function buildDetailEventList(
  events: TraceTimelineEvent[],
  turn: UserTurnListItem,
): TraceTimelineEvent[] {
  const run = resolveRunIdForTurnDetail(turn, events);
  const root =
    turn.traceRootId?.trim() ||
    resolveTraceRootIdFromRunId(events, run || null) ||
    firstTraceRootIdAfterMessage(events, turn.listKey) ||
    "";

  let slice: TraceTimelineEvent[];

  if (root) {
    slice = filterEventsForTraceRoot(events, root);
    const msgKey = turn.listKey;
    if (msgKey && !slice.some((e) => e.event_id === msgKey)) {
      const orphan = events.find((e) => e.event_id === msgKey);
      if (orphan) {
        slice = [...slice, orphan];
      }
    }
  } else if (run) {
    slice = filterEventsForRun(events, run);
  } else {
    slice = events.filter((e) => e.event_id === turn.listKey);
  }

  const mid = turn.msgId?.trim();
  if (mid) {
    const sameMsg = events.filter((e) => eventMsgId(e) === mid);
    slice = mergeTraceEventsDedupe(slice, sameMsg);
  }

  return [...slice].sort(compareTimelineChrono);
}

/**
 * Events for one chat turn by **time window**: from this turn's list anchor through the instant before
 * the next turn's anchor. Captures `llm_output` even when `trace_root_id` on model rows does not
 * match `buildDetailEventList`'s root (common with multi-ingest / alias session keys).
 *
 * Uses **slice by sorted indices**, not numeric `id` ranges — when `id` is missing on all rows,
 * `rowNumericId` collapses to `MAX_SAFE_INTEGER` and id-based windows would drop every event.
 */
export function buildConversationTurnWindowEvents(
  events: TraceTimelineEvent[],
  turn: UserTurnListItem,
  orderedTurns: UserTurnListItem[],
): TraceTimelineEvent[] {
  if (orderedTurns.length === 0) {
    return buildDetailEventList(events, turn);
  }
  const sorted = [...events].sort(compareTimelineChrono);

  const turnMatchesAnchor = (e: TraceTimelineEvent, t: UserTurnListItem): boolean => {
    const ty = (e.type ?? "").toLowerCase();
    if (t.source === "message_received") {
      return ty === "message_received" && e.event_id === t.listKey;
    }
    return ty === "llm_input" && e.event_id === t.listKey;
  };

  const anchorIdx = sorted.findIndex((e) => turnMatchesAnchor(e, turn));
  if (anchorIdx < 0) {
    return buildDetailEventList(events, turn);
  }

  const turnIdx = orderedTurns.findIndex((t) => t.listKey === turn.listKey);
  let endIdx = sorted.length;
  if (turnIdx >= 0 && turnIdx < orderedTurns.length - 1) {
    const next = orderedTurns[turnIdx + 1]!;
    const nextIdx = sorted.findIndex((e) => turnMatchesAnchor(e, next));
    if (nextIdx >= 0) {
      endIdx = nextIdx;
    }
  }

  const slice = sorted.slice(anchorIdx, endIdx);
  return slice.length > 0 ? slice : buildDetailEventList(events, turn);
}

/** Sidebar / header: prefer precomputed linkedRunId, else first llm run in the same trace_root slice. */
export function resolveLinkedRunIdForTurn(
  turn: UserTurnListItem,
  allEvents: TraceTimelineEvent[],
): string | null {
  const direct = turn.linkedRunId?.trim();
  if (direct) {
    return direct;
  }
  const root =
    turn.traceRootId?.trim() || firstTraceRootIdAfterMessage(allEvents, turn.listKey) || "";
  if (!root) {
    return null;
  }
  return firstLlmRunIdInEvents(filterEventsForTraceRoot(allEvents, root));
}

export function filterEventsForRun(
  events: TraceTimelineEvent[],
  runId: string | null,
): TraceTimelineEvent[] {
  if (!runId?.trim()) {
    return [];
  }
  const r = runId.trim();
  return events.filter((e) => eventRunId(e) === r);
}

function parseEventTimeMs(e: TraceTimelineEvent): number | null {
  const s = e.client_ts ?? e.created_at;
  if (typeof s === "string" && s.trim()) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) {
      return t;
    }
  }
  return null;
}

/** 单轮对话窗口（与 `buildConversationTurnWindowEvents` 切片一致）内的耗时与 Token 汇总。 */
export type TurnWindowMetrics = {
  durationMs: number | null;
  promptTokens: number;
  completionTokens: number;
  /** 优先 prompt+completion+cacheRead；仅有 API `total_tokens` 时为各轮之和。 */
  displayTotal: number | null;
};

/**
 * 从已切好的回合事件窗口汇总：执行耗时（首条锚点事件 → 最后一条 `llm_output` / `agent_end`）与所有 `llm_output` 的 usage。
 */
export function inferTurnWindowMetrics(windowEvents: TraceTimelineEvent[]): TurnWindowMetrics {
  if (windowEvents.length === 0) {
    return { durationMs: null, promptTokens: 0, completionTokens: 0, displayTotal: null };
  }
  const sorted = [...windowEvents].sort(compareTimelineChrono);
  let promptSum = 0;
  let completionSum = 0;
  let cacheSum = 0;
  let explicitTotalSum = 0;
  let explicitTotalRows = 0;

  for (const e of sorted) {
    if ((e.type ?? "") !== "llm_output") {
      continue;
    }
    const payload =
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : {};
    const u = usageFromTracePayload(payload);
    promptSum += u.prompt;
    completionSum += u.completion;
    cacheSum += u.cacheRead;
    if (u.total != null && u.total > 0) {
      explicitTotalSum += u.total;
      explicitTotalRows += 1;
    }
  }

  const sumParts = promptSum + completionSum + cacheSum;
  const displayTotal: number | null =
    sumParts > 0 ? sumParts : explicitTotalRows > 0 ? explicitTotalSum : null;

  const firstMs = parseEventTimeMs(sorted[0]!);
  let endMs: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const ty = (sorted[i]!.type ?? "").toLowerCase();
    if (ty === "llm_output" || ty === "agent_end") {
      const t = parseEventTimeMs(sorted[i]!);
      if (t != null) {
        endMs = t;
        break;
      }
    }
  }
  if (endMs == null) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const t = parseEventTimeMs(sorted[i]!);
      if (t != null) {
        endMs = t;
        break;
      }
    }
  }

  let durationMs: number | null = null;
  if (firstMs != null && endMs != null && endMs >= firstMs) {
    durationMs = endMs - firstMs;
  }

  return {
    durationMs,
    promptTokens: promptSum,
    completionTokens: completionSum,
    displayTotal,
  };
}

/** 与会话列表 / Collector API 对齐的回合状态（用于左侧时间轴节点）。 */
export type TurnListStatus = "running" | "success" | "error" | "timeout" | "unknown";

function textLooksTimeout(s: string): boolean {
  const t = s.toLowerCase();
  return t.includes("timeout") || t.includes("timed out") || t.includes("超时");
}

function appendErrorBits(target: string, p: Record<string, unknown>): string {
  let out = target;
  const err = p.error;
  if (err != null) {
    out += ` ${typeof err === "string" ? err : JSON.stringify(err)}`;
  }
  const msg = p.message;
  if (typeof msg === "string" && msg.trim()) {
    out += ` ${msg}`;
  }
  return out;
}

function llmOutputHasAssistantText(p: Record<string, unknown>): boolean {
  const at = p.assistantTexts;
  if (Array.isArray(at)) {
    return at.some((x) => String(x ?? "").trim().length > 0);
  }
  const text = p.text;
  if (typeof text === "string" && text.trim()) {
    return true;
  }
  return false;
}

/**
 * 根据当前回合详情内的事件链推断状态（不访问 DB，仅事件形态）。
 */
export function inferTurnListStatus(events: TraceTimelineEvent[]): TurnListStatus {
  if (events.length === 0) {
    return "unknown";
  }
  const sorted = [...events].sort((a, b) => rowNumericId(a) - rowNumericId(b));
  let hasLlmInput = false;
  let hasLlmOutput = false;
  let assistantOk = false;
  let agentEndSuccess: boolean | null = null;
  let errorBits = "";

  for (const e of sorted) {
    const ty = typeof e.type === "string" ? e.type : "";
    const payload =
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : {};

    if (ty === "llm_input") {
      hasLlmInput = true;
    }
    if (ty === "llm_output") {
      hasLlmOutput = true;
      if (llmOutputHasAssistantText(payload)) {
        assistantOk = true;
      }
      errorBits = appendErrorBits(errorBits, payload);
    }
    if (ty === "agent_end") {
      if (typeof payload.success === "boolean") {
        agentEndSuccess = payload.success;
      }
      errorBits = appendErrorBits(errorBits, payload);
    }
    if (ty === "after_tool_call" || ty === "after_tool") {
      if (payload.error != null) {
        errorBits = appendErrorBits(errorBits, payload);
      }
    }
    if (ty === "error" || ty.endsWith("_error")) {
      try {
        errorBits += ` ${JSON.stringify(payload)}`;
      } catch {
        errorBits += ` ${String(e.payload)}`;
      }
    }
  }

  if (textLooksTimeout(errorBits)) {
    return "timeout";
  }
  if (agentEndSuccess === false) {
    return "error";
  }
  if (agentEndSuccess === true) {
    return "success";
  }
  if (hasLlmOutput && assistantOk) {
    return "success";
  }
  if (hasLlmInput && !hasLlmOutput) {
    return "running";
  }
  if (hasLlmOutput && !assistantOk && errorBits.trim()) {
    return "error";
  }
  if (hasLlmOutput || hasLlmInput) {
    return "success";
  }
  return "unknown";
}
