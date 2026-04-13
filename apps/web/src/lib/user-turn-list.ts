import type { TraceTimelineEvent } from "@/features/observe/traces/components/trace-timeline-tree";
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
  /** 与主命令合并展示时的其它 trace_root_id（异步跟进等）。 */
  mergedTraceRootIds?: string[] | null;
  /** 合并进来的异步命令类 message_received 条数（左侧统计）。 */
  mergedAsyncFollowUpCount?: number;
  /** 合并进来的子代理 / system 内流类 message_received 条数（左侧统计）。 */
  mergedSubagentFollowUpCount?: number;
  /** 与 `whenLabel` 同源：`client_ts` / `created_at` 解析为毫秒，供会话列表与抽屉时间对齐。 */
  whenMs?: number | null;
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
  const raw = e.client_ts ?? e.created_at;
  if (raw == null) {
    return formatTraceDateTimeLocal(undefined);
  }
  return formatTraceDateTimeLocal(typeof raw === "number" ? String(raw) : raw);
}

/** 与抽屉时间轴 `whenLabel` 同源，用于会话列表「最新消息」时间行与抽屉一致。 */
export function traceEventWhenMs(e: TraceTimelineEvent): number | null {
  const raw = e.client_ts ?? e.created_at;
  if (raw != null) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw > 0 ? raw : null;
    }
    const s = String(raw).trim();
    if (s.length > 0) {
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (Number.isFinite(n) && n > 0) {
          return n < 1e12 ? n * 1000 : n;
        }
      }
      const parsed = Date.parse(s);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  if (typeof e.started_at_ms === "number" && Number.isFinite(e.started_at_ms) && e.started_at_ms > 0) {
    return e.started_at_ms;
  }
  if (typeof e.ended_at_ms === "number" && Number.isFinite(e.ended_at_ms) && e.ended_at_ms > 0) {
    return e.ended_at_ms;
  }
  if (typeof e.updated_at_ms === "number" && Number.isFinite(e.updated_at_ms) && e.updated_at_ms > 0) {
    return e.updated_at_ms;
  }
  return null;
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

/** Collector 合成行的 `session_id` 或 `payload.openclaw.sessionId`（与插件 `input.openclaw` 对齐）。 */
export function eventSessionId(e: TraceTimelineEvent): string | null {
  const top = strOrNull((e as { session_id?: unknown }).session_id);
  if (top) {
    return top;
  }
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  const oc = payload.openclaw;
  if (oc && typeof oc === "object" && !Array.isArray(oc)) {
    const o = oc as Record<string, unknown>;
    const fromOc = strOrNull(o.sessionId) ?? strOrNull(o.session_id);
    if (fromOc) {
      return fromOc;
    }
  }
  const ut = payload.user_turn;
  if (ut && typeof ut === "object" && !Array.isArray(ut)) {
    const oc2 = (ut as Record<string, unknown>).openclaw;
    if (oc2 && typeof oc2 === "object" && !Array.isArray(oc2)) {
      const o = oc2 as Record<string, unknown>;
      const fromUt = strOrNull(o.sessionId) ?? strOrNull(o.session_id);
      if (fromUt) {
        return fromUt;
      }
    }
  }
  return null;
}

/** OpenClaw 模型超时 / 失败后注入的续跑提示（与 `isMergedChildFollowupMessage` 互补）。 */
function looksLikeOpenClawModelRecoveryMessage(e: TraceTimelineEvent): boolean {
  if ((e.type ?? "") !== "message_received") {
    return false;
  }
  const full = plainTextFromMessagePayload(payloadRecord(e)).toLowerCase();
  if (!full || full === "—") {
    return false;
  }
  if (full.includes("continue where you left off")) {
    return true;
  }
  if (full.includes("the previous model attempt failed or timed out")) {
    return true;
  }
  if (full.includes("previous model attempt") && (full.includes("failed") || full.includes("timed out"))) {
    return true;
  }
  return false;
}

/**
 * 可与「上一条主用户 message_received」并入同组：须与 {@link eventSessionId} 一致才生效（见 buildMergedMessageReceivedTurnList）。
 * 避免仅凭正文误把无关消息并到上一轮。
 */
function isSessionScopedContinuationMergeCandidate(e: TraceTimelineEvent): boolean {
  return looksLikeOpenClawModelRecoveryMessage(e);
}

/** Collector / 插件在 synthetic 事件上标记的异步跟进回合。 */
export function eventAsyncCommand(e: TraceTimelineEvent): boolean {
  if ((e as { async_command?: unknown }).async_command === true) {
    return true;
  }
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  if (payload.async_command === true) {
    return true;
  }
  const md =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {};
  return md.async_command === true || md.is_async === true;
}

function chatTitleLooksAsync(title: string | null | undefined): boolean {
  const t = (title ?? "").toLowerCase();
  return (
    t.includes("异步") ||
    /\basync\b/.test(t) ||
    t.includes("follow-up") ||
    t.includes("followup") ||
    t.includes("async_command")
  );
}

function payloadLooksAsyncFollowup(e: TraceTimelineEvent): boolean {
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  const md =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {};
  if (typeof payload.command_kind === "string" && /async/i.test(payload.command_kind)) {
    return true;
  }
  if (typeof md.command_kind === "string" && /async/i.test(md.command_kind)) {
    return true;
  }
  if (typeof payload.trace_kind === "string" && /async/i.test(payload.trace_kind)) {
    return true;
  }
  return false;
}

function payloadContentLooksAsyncFollowup(e: TraceTimelineEvent): boolean {
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};

  // Reuse the same "best-effort text extraction" used by previews, so we
  // match async templates even when payload shape varies.
  const full = plainTextFromMessagePayload(payload).toLowerCase();
  if (!full || full === "—") {
    return false;
  }

  // English template (OpenClaw common):
  // "An async command the user already approved has completed. Do not run the command again."
  const looksEn =
    full.includes("async command") &&
    (full.includes("already approved") || full.includes("approved")) &&
    (full.includes("has completed") || full.includes("completed")) &&
    (full.includes("do not run the command again") || full.includes("do not run"));

  // Chinese template (best-effort).
  const looksZh =
    (full.includes("异步") || full.includes("async")) &&
    (full.includes("已批准") || full.includes("批准") || full.includes("already approved")) &&
    (full.includes("完成") || full.includes("completed")) &&
    (full.includes("不要") || full.includes("do not run"));

  // Some templates may only include the tail.
  const looksTail =
    full.includes("do not run the command again") ||
    full.includes("do not run the command") ||
    full.includes("do not run");

  return looksEn || looksZh || (looksTail && full.includes("async command"));
}

/**
 * 是否应视为「主消息之后的异步跟进」，合并到上一条左侧会话项（不单独占一行）。
 * 含 collector 标记、标题/元数据启发式。
 */
export function isAsyncFollowupMessage(e: TraceTimelineEvent): boolean {
  return eventAsyncCommand(e) || chatTitleLooksAsync(e.chat_title) || payloadLooksAsyncFollowup(e) || payloadContentLooksAsyncFollowup(e);
}

type MessageReceivedPrelim = {
  e: TraceTimelineEvent;
  msgId: string | null;
};

function primarySessionIdForGroup(group: MessageReceivedPrelim[]): string | null {
  const g = [...group].sort((a, b) => rowNumericId(a.e) - rowNumericId(b.e));
  for (const x of g) {
    if (!isMergedChildFollowupMessage(x.e)) {
      const s = eventSessionId(x.e);
      if (s) {
        return s;
      }
    }
  }
  return eventSessionId(g[0]!.e);
}

function turnFromMessageReceived(
  primary: TraceTimelineEvent,
  sorted: TraceTimelineEvent[],
  anchorForNextRun: TraceTimelineEvent,
  mergedTraceRootIds: string[] | null,
): UserTurnListItem {
  const payload =
    primary.payload && typeof primary.payload === "object" && !Array.isArray(primary.payload)
      ? (primary.payload as Record<string, unknown>)
      : {};
  const fullText = displayInboundText(plainTextFromMessagePayload(payload));
  const eid = typeof primary.event_id === "string" && primary.event_id ? primary.event_id : `row-${primary.id ?? 0}`;
  return {
    listKey: eid,
    numericId: rowNumericId(primary),
    preview: previewOf(fullText),
    fullText,
    whenLabel: whenOf(primary),
    linkedRunId: findNextLlmRunId(sorted, anchorForNextRun),
    source: "message_received",
    traceRootId: strOrNull(primary.trace_root_id),
    agentId: strOrNull(primary.agent_id),
    agentName: strOrNull(primary.agent_name),
    chatTitle: strOrNull(primary.chat_title),
    msgId: eventMsgId(primary),
    mergedTraceRootIds: mergedTraceRootIds && mergedTraceRootIds.length > 0 ? mergedTraceRootIds : null,
    whenMs: traceEventWhenMs(primary),
  };
}

function mergeMessageReceivedPrelims(
  group: MessageReceivedPrelim[],
  sorted: TraceTimelineEvent[],
): UserTurnListItem {
  const g = [...group].sort((a, b) => rowNumericId(a.e) - rowNumericId(b.e));
  const primaryIdx = g.findIndex((x) => !isMergedChildFollowupMessage(x.e));
  const primary = g[primaryIdx >= 0 ? primaryIdx : 0]!;
  const primaryRoot = strOrNull(primary.e.trace_root_id);
  const extraRoots = [...new Set(g.map((x) => strOrNull(x.e.trace_root_id)).filter((r): r is string => Boolean(r)))].filter(
    (r) => r !== primaryRoot,
  );
  const anchorForNextRun = g[g.length - 1]!.e;
  const merged = turnFromMessageReceived(primary.e, sorted, anchorForNextRun, extraRoots.length > 0 ? extraRoots : null);
  if (extraRoots.length === 0) {
    return merged;
  }
  let asyncFollowUps = 0;
  let subagentFollowUps = 0;
  for (const x of g) {
    if (x.e === primary.e) {
      continue;
    }
    if (isSubagentOrSystemFollowupMessage(x.e)) {
      subagentFollowUps += 1;
    } else if (isAsyncFollowupMessage(x.e)) {
      asyncFollowUps += 1;
    } else if (isMergedChildFollowupMessage(x.e)) {
      asyncFollowUps += 1;
    }
  }
  const out: UserTurnListItem = { ...merged };
  if (asyncFollowUps > 0) {
    out.mergedAsyncFollowUpCount = asyncFollowUps;
  }
  if (subagentFollowUps > 0) {
    out.mergedSubagentFollowUpCount = subagentFollowUps;
  }
  return out;
}

/**
 * 将多条 message_received 合成一条左侧会话项：
 * - 同一 msg_id 的多次上报合并为一行；
 * - 异步跟进、subagent/system 内流等合并到**上一条**主消息（含上一条为带 msg_id 的 trace），不单独成行；
 * - 同一 OpenClaw `sessionId` 下、模型超时/失败续跑等延续类消息（见 isSessionScopedContinuationMergeCandidate）并入上一条主消息组，即使 msg_id 不同。
 */
function buildMergedMessageReceivedTurnList(
  received: TraceTimelineEvent[],
  sorted: TraceTimelineEvent[],
): UserTurnListItem[] {
  const prelims: MessageReceivedPrelim[] = received.map((e) => ({
    e,
    msgId: eventMsgId(e),
  }));
  prelims.sort((a, b) => rowNumericId(a.e) - rowNumericId(b.e));

  const groups: MessageReceivedPrelim[][] = [];
  const msgIdToGroupIdx = new Map<string, number>();
  let current: MessageReceivedPrelim[] = [];
  let lastMainGroupIdx = -1;

  const noteMainGroupPushed = () => {
    lastMainGroupIdx = groups.length - 1;
  };

  for (const p of prelims) {
    if (isMergedChildFollowupMessage(p.e)) {
      if (current.length > 0) {
        current.push(p);
      } else if (groups.length > 0) {
        groups[groups.length - 1]!.push(p);
      } else {
        groups.push([p]);
        noteMainGroupPushed();
      }
      continue;
    }

    const sid = eventSessionId(p.e);
    if (
      lastMainGroupIdx >= 0 &&
      sid &&
      primarySessionIdForGroup(groups[lastMainGroupIdx]!) === sid &&
      isSessionScopedContinuationMergeCandidate(p.e)
    ) {
      groups[lastMainGroupIdx]!.push(p);
      continue;
    }

    if (p.msgId) {
      if (current.length > 0) {
        groups.push(current);
        noteMainGroupPushed();
        current = [];
      }
      const idx = msgIdToGroupIdx.get(p.msgId);
      if (idx !== undefined) {
        groups[idx]!.push(p);
        lastMainGroupIdx = idx;
      } else {
        msgIdToGroupIdx.set(p.msgId, groups.length);
        groups.push([p]);
        noteMainGroupPushed();
      }
      continue;
    }

    if (current.length > 0) {
      groups.push(current);
      noteMainGroupPushed();
      current = [];
    }
    if (
      lastMainGroupIdx >= 0 &&
      sid &&
      primarySessionIdForGroup(groups[lastMainGroupIdx]!) === sid &&
      isSessionScopedContinuationMergeCandidate(p.e)
    ) {
      groups[lastMainGroupIdx]!.push(p);
      continue;
    }
    current = [p];
  }
  if (current.length > 0) {
    groups.push(current);
    noteMainGroupPushed();
  }

  return groups
    .map((g) => mergeMessageReceivedPrelims(g, sorted))
    .sort((a, b) => a.numericId - b.numericId);
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

function payloadRecord(e: TraceTimelineEvent): Record<string, unknown> {
  return e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
    ? (e.payload as Record<string, unknown>)
    : {};
}

function payloadRunKindLower(e: TraceTimelineEvent): string {
  const payload = payloadRecord(e);
  const md =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {};
  const rk =
    (typeof payload.run_kind === "string" ? payload.run_kind : "") ||
    (typeof md.run_kind === "string" ? md.run_kind : "");
  return rk.trim().toLowerCase();
}

/** 优先合成事件顶层 `run_kind`（collector），再读 message_received payload。 */
function eventRunKindLower(e: TraceTimelineEvent): string {
  const topRaw = (e as { run_kind?: unknown }).run_kind;
  const top = typeof topRaw === "string" ? topRaw.trim().toLowerCase() : "";
  if (top) {
    return top;
  }
  return payloadRunKindLower(e);
}

/**
 * Subagent / 系统内流等：与异步跟进一样并入上一条主 `message_received`，左侧列表不占单独一行。
 */
export function isSubagentOrSystemFollowupMessage(e: TraceTimelineEvent): boolean {
  if ((e.type ?? "") !== "message_received") {
    return false;
  }
  const ttRaw = (e as { trace_type?: unknown }).trace_type;
  const tt = typeof ttRaw === "string" ? ttRaw.trim().toLowerCase() : "";
  if (tt === "system" || tt === "subagent" || tt === "async_command") {
    return true;
  }
  const rk = eventRunKindLower(e);
  if (rk === "subagent" || rk === "system") {
    return true;
  }
  const title = (e.chat_title ?? "").toLowerCase();
  if (/\bsubagent\b/.test(title) || title.includes("sub-agent")) {
    return true;
  }
  const full = plainTextFromMessagePayload(payloadRecord(e)).toLowerCase();
  if (full.includes("openclaw runtime context (internal)")) {
    return true;
  }
  if (full.includes("runtime context (internal)") && full.includes("openclaw")) {
    return true;
  }
  return false;
}

/**
 * 同 trace 上是否存在 subagent/system 运行类别（含 llm_* 行上的顶层 run_kind）。
 */
export function traceHasSubagentOrSystemRunKind(
  events: readonly TraceTimelineEvent[],
  traceRootId: string,
): boolean {
  const tr = traceRootId.trim();
  if (!tr) {
    return false;
  }
  for (const e of events) {
    const er = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    if (er !== tr) {
      continue;
    }
    if ((e.type ?? "") === "message_received" && isSubagentOrSystemFollowupMessage(e)) {
      return true;
    }
    const rk = eventRunKindLower(e);
    if (rk === "subagent" || rk === "system") {
      return true;
    }
  }
  return false;
}

/** 左侧合并：异步跟进 ∪ subagent/system 内流。 */
export function isMergedChildFollowupMessage(e: TraceTimelineEvent): boolean {
  return isAsyncFollowupMessage(e) || isSubagentOrSystemFollowupMessage(e);
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
    return buildMergedMessageReceivedTurnList(received, sorted);
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
      whenMs: traceEventWhenMs(e),
    };
  });
}

/**
 * 合并展示中的 subagent 回合：`trace_root_id` 对应子 trace，其 `thread_id` 或 payload.openclaw.sessionKey
 * 常为子会话路由键；与主会话 `parentThreadKey` 不同时可打开子会话 Drawer。
 */
export function resolveSubagentSessionThreadKey(
  events: readonly TraceTimelineEvent[],
  subagentTraceRootId: string | null | undefined,
  parentThreadKey: string,
): string | null {
  const root = typeof subagentTraceRootId === "string" ? subagentTraceRootId.trim() : "";
  const parent = parentThreadKey.trim();
  if (!root || !parent) {
    return null;
  }

  for (const e of events) {
    const tr = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    if (tr !== root) {
      continue;
    }
    const tidRaw = (e as { thread_id?: unknown }).thread_id;
    const tid = typeof tidRaw === "string" ? tidRaw.trim() : "";
    if (tid && tid !== parent) {
      return tid;
    }
  }

  for (const e of events) {
    const tr = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    if (tr !== root) {
      continue;
    }
    const payload =
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : {};
    const oc = payload.openclaw;
    if (oc && typeof oc === "object" && !Array.isArray(oc)) {
      const rawSk = (oc as Record<string, unknown>).sessionKey;
      const sk = typeof rawSk === "string" ? rawSk.trim() : "";
      if (sk && sk !== parent) {
        return sk;
      }
    }
    const rout = payload.openclaw_routing;
    if (rout && typeof rout === "object" && !Array.isArray(rout)) {
      const o = rout as Record<string, unknown>;
      for (const k of ["sessionKey", "session_key", "threadKey", "thread_key"] as const) {
        const v = o[k];
        const sk = typeof v === "string" ? v.trim() : "";
        if (sk && sk !== parent) {
          return sk;
        }
      }
    }
  }

  return null;
}

/**
 * 父会话左侧消息项的 Token 汇总：计入同 thread 内本消息处理链（含合并进来的 async / 同 trace 的 subagent 等），
 * 排除「subagent 新开会话」——即 `thread_id` 已指向其它会话，或 {@link resolveSubagentSessionThreadKey} 判定为子会话路由键与父不一致的 trace。
 *
 * `alwaysIncludeTraceRootIds`：本回合 {@link UserTurnListItem.mergedTraceRootIds} 等显式并入的 trace（如子会话上的 LLM），
 * 即使 `thread_id` 与父会话不同也保留，以便 Popover / 行内 Token 与 session 合并后的处理链一致（数据仍来自各 trace 下 opik_spans 汇总进时间线的 `llm_output`）。
 */
export function filterEventsForParentThreadTokenRollup(
  events: TraceTimelineEvent[],
  parentThreadKey: string,
  options?: { alwaysIncludeTraceRootIds?: ReadonlySet<string> },
): TraceTimelineEvent[] {
  const p = parentThreadKey.trim();
  if (!p) {
    return events;
  }
  const forceRoots = options?.alwaysIncludeTraceRootIds;
  const rootToChild = new Map<string, string | null>();
  const resolveChild = (tr: string): string | null => {
    const hit = rootToChild.get(tr);
    if (hit !== undefined) {
      return hit;
    }
    const child = resolveSubagentSessionThreadKey(events, tr, p);
    rootToChild.set(tr, child);
    return child;
  };

  return events.filter((e) => {
    const tr = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    if (tr && forceRoots?.has(tr)) {
      return true;
    }
    const tid = typeof e.thread_id === "string" ? e.thread_id.trim() : "";
    if (tid && tid !== p) {
      return false;
    }
    if (!tr) {
      return true;
    }
    const child = resolveChild(tr);
    if (child && child.trim() !== p) {
      return false;
    }
    return true;
  });
}

function collectTurnTraceRootIdsForTokenRollup(turn: UserTurnListItem, events: TraceTimelineEvent[]): Set<string> {
  const s = new Set<string>();
  const eff = resolveEffectiveTraceRootId(turn, events)?.trim();
  if (eff) {
    s.add(eff);
  }
  const tr = turn.traceRootId?.trim();
  if (tr) {
    s.add(tr);
  }
  for (const r of turn.mergedTraceRootIds ?? []) {
    const x = typeof r === "string" ? r.trim() : "";
    if (x) {
      s.add(x);
    }
  }
  return s;
}

/**
 * 与 {@link buildConversationTurnWindowEvents} 同一切片：本条消息锚点（`message_received` / `llm_input`）→ 下一条消息锚点之前，
 * 再只保留 `llm_output` 且 {@link filterEventsForParentThreadTokenRollup}（与端到端耗时时间轴一致）。
 */
export function collectLlmOutputEventsForTurnE2E(
  windowEvents: TraceTimelineEvent[],
  parentThreadKey: string,
  alwaysIncludeTraceRootIds?: ReadonlySet<string>,
): TraceTimelineEvent[] {
  const p = parentThreadKey.trim();
  if (!p) {
    return [];
  }
  const scoped = filterEventsForParentThreadTokenRollup(windowEvents, p, {
    alwaysIncludeTraceRootIds,
  });
  return scoped
    .filter((e) => (e.type ?? "") === "llm_output")
    .sort(compareTimelineChrono);
}

/**
 * 本回合「主 trace + mergedTraceRootIds」上出现的全部 `llm_output`（同一消息端到端多段 trace 链，如 async / subagent 跟进）。
 */
export function collectLlmOutputEventsForTurnTraceRoots(
  allEvents: TraceTimelineEvent[],
  turn: UserTurnListItem,
): TraceTimelineEvent[] {
  const roots = collectTurnTraceRootIdsForTokenRollup(turn, allEvents);
  if (roots.size === 0) {
    return [];
  }
  const out: TraceTimelineEvent[] = [];
  for (const e of allEvents) {
    if ((e.type ?? "") !== "llm_output") {
      continue;
    }
    const tr = typeof e.trace_root_id === "string" ? e.trace_root_id.trim() : "";
    if (tr && roots.has(tr)) {
      out.push(e);
    }
  }
  return out.sort(compareTimelineChrono);
}

/**
 * 会话抽屉左侧 token：锚点窗口内 `llm_output` ∪ 主 trace + {@link UserTurnListItem.mergedTraceRootIds} 上全部 `llm_output`（去重）。
 * 根因：仅窗口时，若「跟进 trace」的 `message_received` 未被判为 merged child，窗口在第二条锚点处截断会漏掉后续 LLM；合并 roots 可兜底。
 */
export function mergeTurnLlmOutputEventsForTurnTokenRollup(
  allEvents: TraceTimelineEvent[],
  turn: UserTurnListItem,
  windowEv: TraceTimelineEvent[],
  parentThreadKey: string,
): TraceTimelineEvent[] {
  const roots = collectTurnTraceRootIdsForTokenRollup(turn, allEvents);
  const fromWindow = collectLlmOutputEventsForTurnE2E(windowEv, parentThreadKey, roots);
  const fromRoots = collectLlmOutputEventsForTurnTraceRoots(allEvents, turn);
  const merged = mergeTraceEventsDedupe(fromWindow, fromRoots);
  return filterEventsForParentThreadTokenRollup(merged, parentThreadKey, { alwaysIncludeTraceRootIds: roots });
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
    const merged = turn.mergedTraceRootIds;
    if (merged && merged.length > 0) {
      for (const r of merged) {
        const tr = r.trim();
        if (!tr || tr === root) {
          continue;
        }
        slice = mergeTraceEventsDedupe(slice, filterEventsForTraceRoot(events, tr));
      }
    }
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

/**
 * 会话抽屉「仅对话」：按 trace/msg_id 的 detail 列表 ∪ 用户锚点时间窗口，去重后按时间排序。
 * 单独用窗口会漏掉锚点外、但仍属同轮同 msg 的 trace 行；单独用 detail 会漏未写入 mergedTraceRootIds 的根。
 */
export function buildTranscriptEventList(
  events: TraceTimelineEvent[],
  turn: UserTurnListItem,
  orderedTurns: UserTurnListItem[],
): TraceTimelineEvent[] {
  const detail = buildDetailEventList(events, turn);
  const windowed =
    orderedTurns.length === 0
      ? detail
      : buildConversationTurnWindowEvents(events, turn, orderedTurns);
  return [...mergeTraceEventsDedupe(detail, windowed)].sort(compareTimelineChrono);
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
  if (typeof e.ended_at_ms === "number" && Number.isFinite(e.ended_at_ms) && e.ended_at_ms > 0) {
    return e.ended_at_ms;
  }
  if (typeof e.started_at_ms === "number" && Number.isFinite(e.started_at_ms) && e.started_at_ms > 0) {
    return e.started_at_ms;
  }
  if (typeof e.updated_at_ms === "number" && Number.isFinite(e.updated_at_ms) && e.updated_at_ms > 0) {
    return e.updated_at_ms;
  }
  const raw = e.client_ts ?? e.created_at;
  if (raw == null) {
    return null;
  }
  /** 与 {@link traceEventWhenMs} 一致：ingest 可能把 client_ts 存成 epoch 毫秒数字 */
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 0 ? raw : null;
  }
  const rs = typeof raw === "string" ? raw.trim() : "";
  if (rs.length > 0) {
    if (/^\d+$/.test(rs)) {
      const n = Number(rs);
      if (Number.isFinite(n) && n > 0) {
        return n < 1e12 ? n * 1000 : n;
      }
    }
    const t = Date.parse(rs);
    if (Number.isFinite(t) && t > 0) {
      return t;
    }
  }
  return null;
}

/** 单轮对话窗口（与 `buildConversationTurnWindowEvents` 切片一致）内的耗时与 Token 汇总。 */
export type TurnWindowMetrics = {
  durationMs: number | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  promptTokens: number;
  completionTokens: number;
  /** 各 `llm_output` usage 中 cache read 之和（分项展示；不计入 `displayTotal`）。 */
  cacheReadTokens: number;
  /** 优先 prompt+completion（不含 cache）；仅有各轮显式 `total_tokens` 且无分项时为累加。 */
  displayTotal: number | null;
};

/**
 * 从已切好的回合事件窗口汇总：
 * 执行耗时优先按首条 `llm_input` → 最后一条 `llm_output` / `agent_end` 计算，
 * 避免把 `message_received` 到真正开始执行之间的等待时间算进去。
 *
 * @param parentThreadKeyForTokenRollup 传入时，Token 仅汇总 {@link filterEventsForParentThreadTokenRollup} 后的事件（排除 subagent 新开会话），耗时仍用完整窗口。
 * @param options.tokenEventsOverride 传入时（{@link mergeTurnLlmOutputEventsForTurnTokenRollup}：锚点→下一条锚点窗口内的 `llm_output`）。
 */
export function inferTurnWindowMetrics(
  windowEvents: TraceTimelineEvent[],
  parentThreadKeyForTokenRollup?: string,
  options?: { tokenEventsOverride?: TraceTimelineEvent[] },
): TurnWindowMetrics {
  const emptyMetrics = (): TurnWindowMetrics => ({
    durationMs: null,
    startedAtMs: null,
    endedAtMs: null,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    displayTotal: null,
  });

  const hasWindow = windowEvents.length > 0;
  const tokenOverride = options?.tokenEventsOverride;
  const hasTokenOverride = tokenOverride != null && tokenOverride.length > 0;
  if (!hasWindow && !hasTokenOverride) {
    return emptyMetrics();
  }

  const sorted = hasWindow ? [...windowEvents].sort(compareTimelineChrono) : [];
  const rawTokenEvents = hasTokenOverride ? tokenOverride! : windowEvents;
  /** 覆盖列表已由 {@link mergeTurnLlmOutputEventsForTurnTokenRollup} 按回合 trace 根合并，勿再按父 thread 二次过滤以免丢掉子会话上的 `llm_output`。 */
  const tokenSource =
    hasTokenOverride
      ? rawTokenEvents
      : parentThreadKeyForTokenRollup && parentThreadKeyForTokenRollup.trim().length > 0
        ? filterEventsForParentThreadTokenRollup(rawTokenEvents, parentThreadKeyForTokenRollup)
        : rawTokenEvents;
  const sortedForTokens = [...tokenSource].sort(compareTimelineChrono);
  let promptSum = 0;
  let completionSum = 0;
  let cacheSum = 0;
  let explicitTotalSum = 0;
  let explicitTotalRows = 0;

  for (const e of sortedForTokens) {
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

  const sumNoCache = promptSum + completionSum;
  const displayTotal: number | null =
    sumNoCache > 0 ? sumNoCache : explicitTotalRows > 0 ? explicitTotalSum : null;

  let firstMs: number | null = null;
  for (const e of sorted) {
    if ((e.type ?? "").toLowerCase() === "llm_input") {
      const t =
        typeof e.started_at_ms === "number" && Number.isFinite(e.started_at_ms) && e.started_at_ms > 0
          ? e.started_at_ms
          : parseEventTimeMs(e);
      if (t != null) {
        firstMs = t;
        break;
      }
    }
  }
  if (firstMs == null && sorted.length > 0) {
    firstMs = parseEventTimeMs(sorted[0]!);
  }
  let endMs: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const ty = (sorted[i]!.type ?? "").toLowerCase();
    if (ty === "llm_output" || ty === "agent_end") {
      const row = sorted[i]!;
      const t =
        typeof row.ended_at_ms === "number" && Number.isFinite(row.ended_at_ms) && row.ended_at_ms > 0
          ? row.ended_at_ms
          : parseEventTimeMs(row);
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
  for (let i = sorted.length - 1; i >= 0; i--) {
    const row = sorted[i]!;
    if (
      typeof row.duration_ms === "number" &&
      Number.isFinite(row.duration_ms) &&
      row.duration_ms >= 0 &&
      ((row.type ?? "").toLowerCase() === "llm_output" || (row.type ?? "").toLowerCase() === "agent_end")
    ) {
      durationMs = row.duration_ms;
      if (firstMs == null && endMs != null) {
        firstMs = endMs - row.duration_ms;
      }
      if (endMs == null && firstMs != null) {
        endMs = firstMs + row.duration_ms;
      }
      break;
    }
  }
  if (durationMs == null && firstMs != null && endMs != null && endMs >= firstMs) {
    durationMs = endMs - firstMs;
  }

  return {
    durationMs,
    startedAtMs: firstMs,
    endedAtMs: endMs,
    promptTokens: promptSum,
    completionTokens: completionSum,
    cacheReadTokens: cacheSum,
    displayTotal,
  };
}

/**
 * 单条事件上的「消息开始」：与列表 `whenLabel` / {@link traceEventWhenMs} 一致，
 * 优先用户发送/客户端时间（`client_ts` / `created_at`），再回退到 {@link parseEventTimeMs}。
 */
function anchorMessageStartMs(e: TraceTimelineEvent): number | null {
  const client = traceEventWhenMs(e);
  if (client != null) {
    return client;
  }
  return parseEventTimeMs(e);
}

/** 用户消息锚点（接入时间）→ 用于端到端口径。 */
function inferAnchorMessageMs(turn: UserTurnListItem, sorted: TraceTimelineEvent[]): number | null {
  for (const e of sorted) {
    if ((e.type ?? "").toLowerCase() === "message_received" && e.event_id === turn.listKey) {
      const t = anchorMessageStartMs(e);
      if (t != null) {
        return t;
      }
    }
  }
  if (turn.source === "llm_input") {
    for (const e of sorted) {
      if ((e.type ?? "").toLowerCase() === "llm_input" && e.event_id === turn.listKey) {
        const t = anchorMessageStartMs(e);
        if (t != null) {
          return t;
        }
      }
    }
  }
  if (typeof turn.whenMs === "number" && turn.whenMs > 0) {
    return turn.whenMs;
  }
  if (sorted.length > 0) {
    return anchorMessageStartMs(sorted[0]!);
  }
  return null;
}

function segmentBoundaryMs(e: TraceTimelineEvent): number | null {
  if (typeof e.started_at_ms === "number" && Number.isFinite(e.started_at_ms) && e.started_at_ms > 0) {
    return e.started_at_ms;
  }
  return parseEventTimeMs(e);
}

function eventEndedAtMs(e: TraceTimelineEvent): number | null {
  if (typeof e.ended_at_ms === "number" && Number.isFinite(e.ended_at_ms) && e.ended_at_ms > 0) {
    return e.ended_at_ms;
  }
  const s = segmentBoundaryMs(e);
  if (s != null) {
    return s;
  }
  return parseEventTimeMs(e);
}

/** 与 Traces `phase*` 对齐：消息进入 OpenClaw 后常见节点类型。 */
const OPENCLAW_NODE_LABEL_KEYS: Record<string, string> = {
  message_received: "phaseUserMessage",
  session_start: "phaseSessionStart",
  before_model_resolve: "phaseBeforeModelResolve",
  before_prompt_build: "phaseBeforePromptBuild",
  before_agent_start: "phaseBeforePromptBuild",
  hook_contribution: "phaseHookContribution",
  context_prune_applied: "phaseContextPrune",
  before_compaction: "phaseCompactionBefore",
  model_stream_context: "phaseModelStreamContext",
  llm_input: "phaseLlmInput",
  llm_output: "phaseLlmOutput",
  before_tool_call: "phaseToolCall",
  after_tool_call: "phaseToolResult",
  agent_end: "phaseAgentEnd",
  after_compaction: "phaseCompactionAfter",
  subagent_spawned: "phaseSubagentSpawned",
  subagent_ended: "phaseSubagentEnded",
};

const OPENCLAW_PIPELINE_TYPES = new Set(Object.keys(OPENCLAW_NODE_LABEL_KEYS));

/** 抽屉 Popover 时间线：一句话说明该阶段含义（i18n message key） */
const OPENCLAW_NODE_BLURB_KEYS: Record<string, string> = {
  message_received: "threadDrawerPipelineBlurbMessageReceived",
  session_start: "threadDrawerPipelineBlurbSessionStart",
  before_model_resolve: "threadDrawerPipelineBlurbBeforeModelResolve",
  before_prompt_build: "threadDrawerPipelineBlurbBeforePromptBuild",
  before_agent_start: "threadDrawerPipelineBlurbBeforeAgentStart",
  hook_contribution: "threadDrawerPipelineBlurbHookContribution",
  context_prune_applied: "threadDrawerPipelineBlurbContextPrune",
  before_compaction: "threadDrawerPipelineBlurbBeforeCompaction",
  model_stream_context: "threadDrawerPipelineBlurbModelStreamContext",
  llm_input: "threadDrawerPipelineBlurbLlmInput",
  llm_output: "threadDrawerPipelineBlurbLlmOutput",
  before_tool_call: "threadDrawerPipelineBlurbBeforeToolCall",
  after_tool_call: "threadDrawerPipelineBlurbAfterToolCall",
  agent_end: "threadDrawerPipelineBlurbAgentEnd",
  after_compaction: "threadDrawerPipelineBlurbAfterCompaction",
  subagent_spawned: "threadDrawerPipelineBlurbSubagentSpawned",
  subagent_ended: "threadDrawerPipelineBlurbSubagentEnded",
};

function dashStr(v: unknown): string {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return "—";
}

function toolNameFromOpenclawPayload(p: Record<string, unknown>): string {
  const a = p.toolName;
  if (typeof a === "string" && a.trim()) {
    return a.trim();
  }
  const b = p.name;
  if (typeof b === "string" && b.trim()) {
    return b.trim();
  }
  return "";
}

/** 抽屉时间线副标题：区分多轮 LLM、工具名（与 Trace 详情 pipeline 摘要字段对齐）。 */
export type OpenclawPipelineSubtitle =
  | { kind: "llm_in"; round: number; provider: string; model: string }
  | { kind: "llm_out"; round: number; assistantCount: number }
  | { kind: "tool"; name: string };

function inferOpenclawPipelineSubtitle(
  ty: string,
  p: Record<string, unknown>,
  rounds: { llmIn: number; llmOut: number },
): OpenclawPipelineSubtitle | undefined {
  if (ty === "llm_input") {
    rounds.llmIn += 1;
    return {
      kind: "llm_in",
      round: rounds.llmIn,
      provider: dashStr(p.provider),
      model: dashStr(p.model),
    };
  }
  if (ty === "llm_output") {
    rounds.llmOut += 1;
    const texts = p.assistantTexts;
    const n = Array.isArray(texts) ? texts.length : 0;
    return { kind: "llm_out", round: rounds.llmOut, assistantCount: n };
  }
  if (ty === "before_tool_call" || ty === "after_tool_call") {
    const name = toolNameFromOpenclawPayload(p);
    if (!name) {
      return undefined;
    }
    return { kind: "tool", name };
  }
  return undefined;
}

function inferNodeDurationAndKind(
  e: TraceTimelineEvent,
  next: TraceTimelineEvent | null,
): { durationMs: number | null; durationKind: "intrinsic" | "gap_to_next" | "none" } {
  if (typeof e.duration_ms === "number" && Number.isFinite(e.duration_ms) && e.duration_ms >= 0) {
    return { durationMs: e.duration_ms, durationKind: "intrinsic" };
  }
  const s = segmentBoundaryMs(e);
  const end = typeof e.ended_at_ms === "number" && Number.isFinite(e.ended_at_ms) && e.ended_at_ms > 0 ? e.ended_at_ms : null;
  if (s != null && end != null && end >= s) {
    return { durationMs: end - s, durationKind: "intrinsic" };
  }
  if (next) {
    const ns = segmentBoundaryMs(next);
    if (s != null && ns != null && ns >= s) {
      return { durationMs: ns - s, durationKind: "gap_to_next" };
    }
  }
  return { durationMs: null, durationKind: "none" };
}


/**
 * 本回合窗口内，消息进入 OpenClaw 后的节点时间线（按事件顺序，白名单类型）。
 */
export type OpenclawPipelineNode = {
  key: string;
  labelKey: string;
  rawType: string;
  /** 阶段一句话说明（Traces i18n key） */
  blurbKey: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  durationMs: number | null;
  durationKind: "intrinsic" | "gap_to_next" | "none";
  /** 轮次、模型、工具名等，避免多段同名 phase 无法区分 */
  subtitle?: OpenclawPipelineSubtitle;
};

export function inferOpenclawPipelineNodes(turn: UserTurnListItem, sortedInput: TraceTimelineEvent[]): OpenclawPipelineNode[] {
  const sorted = [...sortedInput].sort(compareTimelineChrono);
  if (sorted.length === 0) {
    return [];
  }

  let anchorIdx = sorted.findIndex((e) => {
    if (turn.source === "message_received") {
      return (e.type ?? "").toLowerCase() === "message_received" && e.event_id === turn.listKey;
    }
    return (e.type ?? "").toLowerCase() === "llm_input" && e.event_id === turn.listKey;
  });
  if (anchorIdx < 0) {
    anchorIdx = 0;
  }

  const slice = sorted.slice(anchorIdx);
  const filtered = slice.filter((e) => OPENCLAW_PIPELINE_TYPES.has((e.type ?? "").toLowerCase()));
  if (filtered.length === 0) {
    return [];
  }

  const out: OpenclawPipelineNode[] = [];
  const rounds = { llmIn: 0, llmOut: 0 };
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i]!;
    const next = i + 1 < filtered.length ? filtered[i + 1]! : null;
    const ty = (e.type ?? "").toLowerCase();
    const labelKey = OPENCLAW_NODE_LABEL_KEYS[ty] ?? "threadDrawerStageUnknownHook";
    const blurbKey = OPENCLAW_NODE_BLURB_KEYS[ty] ?? "threadDrawerPipelineBlurbUnknown";
    const { durationMs, durationKind } = inferNodeDurationAndKind(e, next);
    const startedAtMs = segmentBoundaryMs(e) ?? traceEventWhenMs(e);
    const endedAtMs = eventEndedAtMs(e) ?? traceEventWhenMs(e);
    const p = payloadRecord(e);
    const subtitle = inferOpenclawPipelineSubtitle(ty, p, rounds);

    out.push({
      key: dedupeKeyForEvent(e),
      labelKey,
      blurbKey,
      rawType: ty,
      startedAtMs,
      endedAtMs,
      durationMs,
      durationKind,
      subtitle,
    });
  }
  return out;
}

/**
 * 端到端：用户消息接入 → 最后输出；{@link inferOpenclawPipelineNodes} 为 OpenClaw 节点时间线。
 */
export type TurnE2ETimeline = {
  e2eDurationMs: number | null;
  e2eStartedAtMs: number | null;
  e2eEndedAtMs: number | null;
  pipelineNodes: OpenclawPipelineNode[];
};

export function inferTurnE2ETimeline(
  turn: UserTurnListItem,
  windowEvents: TraceTimelineEvent[],
  execution: { startedAtMs: number | null; endedAtMs: number | null; durationMs: number | null },
): TurnE2ETimeline {
  const sorted = windowEvents.length === 0 ? [] : [...windowEvents].sort(compareTimelineChrono);
  const anchorMs = inferAnchorMessageMs(turn, sorted);
  const execStart = execution.startedAtMs;
  const execEnd = execution.endedAtMs;

  const e2eStartedAtMs = anchorMs ?? execStart ?? null;
  const e2eEndedAtMs = execEnd;

  let e2eDurationMs: number | null = null;
  if (e2eStartedAtMs != null && e2eEndedAtMs != null && e2eEndedAtMs >= e2eStartedAtMs) {
    e2eDurationMs = e2eEndedAtMs - e2eStartedAtMs;
  } else if (execution.durationMs != null && execution.durationMs >= 0) {
    e2eDurationMs = execution.durationMs;
  }

  const pipelineNodes = inferOpenclawPipelineNodes(turn, sorted);

  return {
    e2eDurationMs,
    e2eStartedAtMs,
    e2eEndedAtMs,
    pipelineNodes,
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
