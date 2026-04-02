import { randomUUID } from "node:crypto";
import { extractRoutedAgentIdFromMessageMetadata } from "./inbound-mirror.js";
import { deletePendingSnapshot, loadAllPendingSnapshots, writePendingSnapshot } from "./pending-disk.js";
import {
  normalizeOpikSpanInputForStorage,
  normalizeOpikTraceInputForStorage,
  stripLeadingBracketDatePrefixes,
} from "./strip-leading-bracket-date.js";
import type { OpikBatchPayload } from "./opik-types.js";
import {
  extractRoutingFromPendingUserTurn,
  mergeOpenclawRoutingLayers,
} from "./llm-input-routing-meta.js";
import { enrichToolSpanResourceAudit } from "./resource-audit-span.js";
import { extractAgentIdFromRoutingSessionKey, parseRoutingKindFromSessionKey } from "./trace-session-key.js";

/** 与 `message_received` 正文上限对齐；Gmail/Hook 隔离路径无 inbound hook，依赖本段 prompt 预览入库。 */
export const TRACE_PROMPT_PREVIEW_MAX_CHARS = 16_384;

/** `llm_input` 入库时附加的路由/模型参数（由 index 从 hook 载荷抽取）。 */
export type LlmInputIngestExtras = {
  routingFromEvent?: Record<string, unknown>;
  modelParams?: Record<string, unknown>;
};

function threadKeyLooksOpenclawSession(threadId: string, ctx: AgentCtx): boolean {
  const candidates = [threadId, ctx.sessionKey ?? "", ctx.channelId ?? ""].map((s) => s.trim());
  return candidates.some(
    (t) =>
      t.length > 0 &&
      (/^agent:/i.test(t) ||
        /^webchat:/i.test(t) ||
        /^feishu:/i.test(t) ||
        /^hook:/i.test(t)),
  );
}

/**
 * Hook 若经 IPC 丢失 `openclawSession`，仍可从 sessionKey 解析出 kind，但四档会空。
 * OpenClaw 控制面未单独设置时等价于 inherit — 在此补齐，避免列表仅「类型」有值。
 */
function applyOpenclawRoutingInheritFallback(
  routing: Record<string, unknown>,
  threadId: string,
  ctx: AgentCtx,
): void {
  if (!threadKeyLooksOpenclawSession(threadId, ctx)) {
    return;
  }
  for (const k of ["thinking", "verbose", "reasoning", "fast"] as const) {
    if (routing[k] === undefined) {
      routing[k] = "inherit";
    }
  }
}

function buildOpenclawRoutingMetadata(
  threadId: string,
  ctx: AgentCtx,
  routingFromEvent?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const routing: Record<string, unknown> = {};
  if (routingFromEvent) {
    Object.assign(routing, routingFromEvent);
  }
  const fromKey =
    parseRoutingKindFromSessionKey(threadId) ??
    parseRoutingKindFromSessionKey(ctx.sessionKey) ??
    parseRoutingKindFromSessionKey(ctx.channelId);
  if (fromKey != null && routing.kind === undefined) {
    routing.kind = fromKey;
  }
  if (Object.keys(routing).length === 0) {
    return undefined;
  }
  applyOpenclawRoutingInheritFallback(routing, threadId, ctx);
  return routing;
}

type AgentCtx = {
  sessionId?: string;
  sessionKey?: string;
  channelId?: string;
  conversationId?: string;
  messageProvider?: string;
  agentId?: string;
  /** OpenClaw `agents.list[].name` when provided on hook ctx. */
  agentName?: string;
};

function threadAgentLabel(ctx: AgentCtx): string | undefined {
  const name = ctx.agentName?.trim();
  const id = ctx.agentId?.trim();
  return name || id || undefined;
}

function threadChannelLabel(ctx: AgentCtx): string | undefined {
  const provider = ctx.messageProvider?.trim();
  const ch = ctx.channelId?.trim();
  if (provider && ch && provider.toLowerCase() !== ch.toLowerCase()) {
    return `${provider} · ${ch}`;
  }
  return provider || ch || undefined;
}

/** OpenClaw 可能给秒级或毫秒级时间戳；`>=1e12` 视为毫秒，以免把已是 ms 的值误乘 1000。 */
function normalizeInboundEventTimestampMs(ts: unknown, flushMs: number): number | undefined {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
    return undefined;
  }
  let ms: number;
  if (ts >= 1e12) {
    ms = Math.floor(ts);
  } else if (ts >= 1e9) {
    ms = Math.floor(ts * 1000);
  } else {
    return undefined;
  }
  const maxSkew = 10 * 365 * 86400_000;
  const slack = 7 * 86400_000;
  if (ms < flushMs - maxSkew || ms > flushMs + slack) {
    return undefined;
  }
  return ms;
}

/** 用于无 LLM / 延迟 flush：优先用用户入站时间作为线程与 trace 起点。 */
function firstUserInboundTimestampMs(pending: Record<string, unknown>, flushMs: number): number {
  const mr = pending.message_received;
  if (!mr || typeof mr !== "object" || Array.isArray(mr)) {
    return flushMs;
  }
  const ms = normalizeInboundEventTimestampMs((mr as { timestamp?: unknown }).timestamp, flushMs);
  return ms ?? flushMs;
}

function threadAgentLabelFromPending(ctx: AgentCtx, pending: Record<string, unknown>): string | undefined {
  const base = threadAgentLabel(ctx);
  if (base) {
    return base;
  }
  const mr = pending.message_received;
  if (!mr || typeof mr !== "object" || Array.isArray(mr)) {
    return undefined;
  }
  const md = (mr as { metadata?: unknown }).metadata;
  if (md && typeof md === "object" && !Array.isArray(md)) {
    const m = md as Record<string, unknown>;
    const rid = extractRoutedAgentIdFromMessageMetadata(m);
    if (rid) {
      return rid;
    }
    const pick = (k: string) => {
      const v = m[k];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    return pick("agentName") ?? pick("agent_name") ?? pick("displayAgentName");
  }
  const routed = extractAgentIdFromRoutingSessionKey(ctx.sessionKey ?? ctx.channelId);
  if (routed) {
    return routed;
  }
  return undefined;
}

function threadChannelLabelFromPending(
  ctx: AgentCtx,
  pending: Record<string, unknown>,
  threadId: string,
): string | undefined {
  const base = threadChannelLabel(ctx);
  if (base) {
    return base;
  }
  const mr = pending.message_received;
  if (mr && typeof mr === "object" && !Array.isArray(mr)) {
    const from = (mr as { from?: unknown }).from;
    if (typeof from === "string" && from.toLowerCase().startsWith("feishu")) {
      return "feishu";
    }
  }
  const t = threadId.trim();
  if (t.toLowerCase().startsWith("feishu/")) {
    return "feishu";
  }
  return undefined;
}

function nowMs(): number {
  return Date.now();
}

/** OpenAI / Anthropic / etc. may use numbers or numeric strings in `usage`. */
function usageNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Gemini / Google 等常在 `usageMetadata` 嵌套里给 token 数。 */
function readUsageTokenParts(u: Record<string, unknown> | undefined): {
  total?: number;
  prompt?: number;
  completion?: number;
} {
  if (!u) {
    return {};
  }
  const umRaw = u.usageMetadata;
  const um =
    umRaw && typeof umRaw === "object" && !Array.isArray(umRaw)
      ? (umRaw as Record<string, unknown>)
      : undefined;
  const total =
    usageNumber(u.total_tokens) ??
    usageNumber(u.totalTokens) ??
    usageNumber(u.totalTokenCount) ??
    usageNumber(um?.totalTokenCount) ??
    usageNumber(um?.totalTokens);
  const prompt =
    usageNumber(u.prompt_tokens) ??
    usageNumber(u.promptTokens) ??
    usageNumber(u.input_tokens) ??
    usageNumber(u.inputTokens) ??
    usageNumber(u.prompt_token_count) ??
    usageNumber(u.promptTokenCount) ??
    usageNumber(u.inputTokenCount) ??
    usageNumber(um?.promptTokenCount) ??
    usageNumber(um?.inputTokenCount);
  const completion =
    usageNumber(u.completion_tokens) ??
    usageNumber(u.completionTokens) ??
    usageNumber(u.output_tokens) ??
    usageNumber(u.outputTokens) ??
    usageNumber(u.completion_token_count) ??
    usageNumber(u.candidatesTokenCount) ??
    usageNumber(u.outputTokenCount) ??
    usageNumber(um?.candidatesTokenCount) ??
    usageNumber(um?.outputTokenCount);
  return { total, prompt, completion };
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function usagePartsPresent(parts: { total?: number; prompt?: number; completion?: number }): boolean {
  return parts.total != null || parts.prompt != null || parts.completion != null;
}

function firstUsageRecordWithParts(candidates: unknown[]): Record<string, unknown> | undefined {
  for (const c of candidates) {
    if (!isPlainObj(c)) {
      continue;
    }
    const p = readUsageTokenParts(c);
    if (usagePartsPresent(p)) {
      return c;
    }
  }
  return undefined;
}

/**
 * 从单条 assistant/model 消息里抠出 usage（hook 的 `llm_output.usage` 为空时，token 常挂在 transcript 上）。
 */
function usageFromAssistantMessage(m: unknown): Record<string, unknown> | undefined {
  if (!isPlainObj(m)) {
    return undefined;
  }
  const o = m;
  if (!roleLooksAssistant(o)) {
    return undefined;
  }
  const meta = isPlainObj(o.metadata) ? o.metadata : undefined;
  const kwargs = isPlainObj(o.kwargs) ? o.kwargs : undefined;
  let crabTokenMetrics: Record<string, unknown> | undefined;
  if (meta && isPlainObj(meta.crabagent) && isPlainObj(meta.crabagent.layers)) {
    const reasoning = meta.crabagent.layers.reasoning;
    if (isPlainObj(reasoning) && isPlainObj(reasoning.tokenMetrics)) {
      crabTokenMetrics = reasoning.tokenMetrics;
    }
  }
  const candidates: unknown[] = [
    o.usage,
    isPlainObj(o.usageMetadata) ? { usageMetadata: o.usageMetadata } : undefined,
    meta?.usage,
    meta && isPlainObj(meta.usageMetadata) ? { usageMetadata: meta.usageMetadata } : undefined,
    o.response_metadata,
    o.responseMetadata,
    kwargs?.usage_metadata,
    isPlainObj(kwargs?.usageMetadata) ? { usageMetadata: kwargs.usageMetadata } : kwargs?.usageMetadata,
    crabTokenMetrics,
  ];
  for (const nestedKey of ["response", "raw", "result", "message"]) {
    const inner = o[nestedKey];
    if (isPlainObj(inner)) {
      candidates.push(inner.usage);
      if (isPlainObj(inner.usageMetadata)) {
        candidates.push({ usageMetadata: inner.usageMetadata });
      }
    }
  }
  return firstUsageRecordWithParts(candidates);
}

/** 从 agent_end 全量 messages 中找最近一条带 token 的 assistant 回复。 */
function usageFromAgentEndMessages(messages: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = usageFromAssistantMessage(messages[i]);
    if (u) {
      return u;
    }
  }
  return undefined;
}

function mergeTotalTokensFromUsage(metaOut: Record<string, unknown>, u: Record<string, unknown>): void {
  const tt =
    usageNumber(u.total_tokens) ??
    usageNumber(u.totalTokens) ??
    usageNumber(u.totalTokenCount);
  const pt =
    usageNumber(u.prompt_tokens) ??
    usageNumber(u.promptTokens) ??
    usageNumber(u.input_tokens) ??
    usageNumber(u.inputTokens) ??
    usageNumber(u.prompt_token_count);
  const ct =
    usageNumber(u.completion_tokens) ??
    usageNumber(u.completionTokens) ??
    usageNumber(u.output_tokens) ??
    usageNumber(u.outputTokens) ??
    usageNumber(u.completion_token_count) ??
    usageNumber(u.candidatesTokenCount);
  const parts = readUsageTokenParts(u);
  const tt2 = tt ?? parts.total;
  const pt2 = pt ?? parts.prompt;
  const ct2 = ct ?? parts.completion;
  if (tt2 != null) {
    metaOut.total_tokens = tt2;
  } else if (pt2 != null || ct2 != null) {
    metaOut.total_tokens = (pt2 ?? 0) + (ct2 ?? 0);
  }
}

function effectiveSessionKey(ctx: AgentCtx): string {
  const a = ctx.sessionKey?.trim();
  if (a) {
    return a;
  }
  const b = ctx.sessionId?.trim();
  if (b) {
    return b;
  }
  const c = ctx.conversationId?.trim();
  if (c) {
    return c;
  }
  return "unknown-session";
}

function shouldSample(bps: number): boolean {
  if (bps >= 10_000) {
    return true;
  }
  if (bps <= 0) {
    return false;
  }
  return Math.floor(Math.random() * 10_000) < bps;
}

function promptHookBlobUsable(blob: unknown): boolean {
  if (!blob || typeof blob !== "object" || Array.isArray(blob)) {
    return false;
  }
  const o = blob as Record<string, unknown>;
  const prev = o.promptPreview;
  if (typeof prev === "string" && prev.trim().length > 0) {
    return true;
  }
  const n = o.promptCharCount;
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** 调试：不记录正文，只描述 pending 形状，便于排查「已 takePending 但未入库」。 */
function summarizePendingShape(p: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!p || typeof p !== "object") {
    return { topLevelKeys: [] };
  }
  const topLevelKeys = Object.keys(p);
  const mr = p.message_received;
  let messageReceivedContentLen: number | undefined;
  if (mr && typeof mr === "object" && !Array.isArray(mr)) {
    const c = (mr as { content?: unknown }).content;
    if (typeof c === "string") {
      messageReceivedContentLen = c.length;
    }
  }
  return {
    topLevelKeys,
    messageReceivedContentLen,
    hasUsableBeforeModelResolve: promptHookBlobUsable(p.before_model_resolve),
    hasUsableBeforePromptBuild: promptHookBlobUsable(p.before_prompt_build),
    hasUsableBeforeAgentStart: promptHookBlobUsable(p.before_agent_start),
  };
}

/** 仅当 `message_received` 含非空正文时视为「用户发消息」，用于强制走 LLM trace 与延迟 flush。 */
function pendingHasUserInboundMessage(p: Record<string, unknown> | undefined): boolean {
  if (!p || typeof p !== "object") {
    return false;
  }
  const mr = p.message_received;
  if (!mr || typeof mr !== "object" || Array.isArray(mr)) {
    return false;
  }
  const c = (mr as { content?: unknown }).content;
  return typeof c === "string" && c.trim().length > 0;
}

/** Aligns with collector `thread_turn_types.ThreadRunKind` for `opik_thread_turns`. */
type ThreadRunKind = "external" | "async_followup" | "subagent" | "system";

function inferThreadRunKind(
  pending: Record<string, unknown>,
  promptPreview: string | undefined,
): ThreadRunKind {
  const mr = pending.message_received;
  let metaAsync = false;
  if (mr && typeof mr === "object" && !Array.isArray(mr)) {
    const m = mr as Record<string, unknown>;
    const meta =
      m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
        ? (m.metadata as Record<string, unknown>)
        : {};
    metaAsync =
      meta.async_command === true ||
      meta.is_async === true ||
      m.async === true ||
      m.isAsync === true;
  }
  const p = (promptPreview ?? "").trim();
  const lower = p.toLowerCase();
  const textLooksAsync =
    metaAsync ||
    lower.includes("an async command the user already approved") ||
    (lower.includes("async command") && lower.includes("completed")) ||
    (lower.includes("async command") && lower.includes("do not run"));
  if (textLooksAsync) {
    return "async_followup";
  }
  if (pendingHasUserInboundMessage(pending)) {
    return "external";
  }
  return "system";
}

/** 飞书 oc_/ou_ 等，用于在 hook 别名与 pending 桶名不一致时仍能合并取出。 */
function extractThreadCorrelationIds(s: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(ou_[a-zA-Z0-9_]+|oc_[a-zA-Z0-9_]+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

function messageReceivedCorrelationIds(p: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const mr = p.message_received;
  if (!mr || typeof mr !== "object" || Array.isArray(mr)) {
    return ids;
  }
  const mo = mr as { from?: unknown; metadata?: unknown };
  if (typeof mo.from === "string") {
    for (const x of extractThreadCorrelationIds(mo.from)) {
      ids.add(x);
    }
  }
  const md = mo.metadata;
  if (md && typeof md === "object" && !Array.isArray(md)) {
    for (const v of Object.values(md as Record<string, unknown>)) {
      if (typeof v === "string") {
        for (const x of extractThreadCorrelationIds(v)) {
          ids.add(x);
        }
      }
    }
  }
  return ids;
}

function anchorCorrelationIds(aliasKeys: string[], primarySk: string): Set<string> {
  const out = new Set<string>();
  for (const raw of [...aliasKeys, primarySk]) {
    for (const x of extractThreadCorrelationIds(raw)) {
      out.add(x);
    }
  }
  return out;
}

function pendingHasIngestibleContext(p: Record<string, unknown> | undefined): boolean {
  if (!p || typeof p !== "object") {
    return false;
  }
  const ss = p.session_start;
  if (ss && typeof ss === "object" && !Array.isArray(ss)) {
    return true;
  }
  const mr = p.message_received;
  if (mr && typeof mr === "object" && !Array.isArray(mr)) {
    const c = (mr as { content?: unknown }).content;
    if (typeof c === "string" && c.trim().length > 0) {
      return true;
    }
  }
  if (promptHookBlobUsable(p.before_agent_start)) {
    return true;
  }
  if (promptHookBlobUsable(p.before_prompt_build)) {
    return true;
  }
  if (promptHookBlobUsable(p.before_model_resolve)) {
    return true;
  }
  return false;
}

function partsArrayToText(parts: unknown[]): string | undefined {
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      chunks.push(part);
    } else if (part && typeof part === "object" && !Array.isArray(part)) {
      const p = part as Record<string, unknown>;
      const t = p.text;
      if (typeof t === "string") {
        chunks.push(t);
      } else if (typeof p.content === "string") {
        chunks.push(p.content);
      }
    }
  }
  const s = chunks.join("").trim();
  return s.length > 0 ? s : undefined;
}

function transcriptMessageText(m: unknown): string | undefined {
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    return undefined;
  }
  const o = m as Record<string, unknown>;
  if (typeof o.text === "string") {
    return o.text;
  }
  if (typeof o.body === "string") {
    return o.body;
  }
  const c = o.content;
  if (typeof c === "string") {
    return c;
  }
  if (Array.isArray(c)) {
    return partsArrayToText(c);
  }
  const parts = o.parts;
  if (Array.isArray(parts)) {
    const fromParts = partsArrayToText(parts);
    if (fromParts) {
      return fromParts;
    }
  }
  const nested = o.message;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = transcriptMessageText(nested);
    if (inner) {
      return inner;
    }
  }
  return undefined;
}

function messageLooksLikeUserTurn(o: Record<string, unknown>): boolean {
  const roleRaw = String(o.role ?? "").trim();
  if (roleRaw === "用户" || roleRaw === "主人") {
    return true;
  }
  const role = roleRaw.toLowerCase();
  if (
    role === "user" ||
    role === "human" ||
    role === "customer" ||
    role === "client" ||
    role === "end_user" ||
    role === "participant"
  ) {
    return true;
  }
  const author = String(o.author ?? "").toLowerCase();
  if (author === "user" || author === "human") {
    return true;
  }
  const type = String(o.type ?? "").toLowerCase();
  if (type === "human" || type === "humanmessage") {
    return true;
  }
  return false;
}

function roleLooksAssistant(o: Record<string, unknown>): boolean {
  const roleRaw = String(o.role ?? "").trim();
  if (roleRaw === "助手" || roleRaw === "助理" || roleRaw === "系统") {
    return true;
  }
  const role = roleRaw.toLowerCase();
  if (role === "assistant" || role === "ai" || role === "model" || role === "bot" || role === "system") {
    return true;
  }
  const type = String(o.type ?? "").toLowerCase();
  if (type === "ai" || type === "aimessage" || type === "assistant") {
    return true;
  }
  return false;
}

function syntheticTranscriptPending(text: string, kind: "user" | "fallback"): Record<string, unknown> {
  return {
    message_received: {
      from: kind === "user" ? "agent_end.transcript" : "agent_end.transcript_fallback",
      content: stripLeadingBracketDatePrefixes(text).slice(0, 16_384),
    },
  };
}

/** 当未走 message_received 时，从 agent_end 的 transcript 里取最后一条 user 消息作输入。 */
function pendingFromTranscriptMessages(messages: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      continue;
    }
    const o = m as Record<string, unknown>;
    if (!messageLooksLikeUserTurn(o)) {
      continue;
    }
    const text = transcriptMessageText(m);
    if (typeof text === "string" && text.trim().length > 0) {
      return syntheticTranscriptPending(text, "user");
    }
  }
  /** OpenClaw 部分通道用非标准 role；从后往前跳过 assistant，取第一条仍有正文的条目。 */
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      continue;
    }
    const o = m as Record<string, unknown>;
    if (roleLooksAssistant(o)) {
      continue;
    }
    const text = transcriptMessageText(m);
    if (typeof text === "string" && text.trim().length > 0) {
      return syntheticTranscriptPending(text, "fallback");
    }
  }
  return undefined;
}

function previewFromPendingUserTurn(pending: Record<string, unknown>): string | undefined {
  const mr = pending.message_received;
  if (mr && typeof mr === "object" && !Array.isArray(mr)) {
    const c = (mr as { content?: unknown }).content;
    if (typeof c === "string" && c.length > 0) {
      return c.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS);
    }
  }
  const bas = pending.before_agent_start;
  if (bas && typeof bas === "object" && !Array.isArray(bas)) {
    const prev = (bas as { promptPreview?: unknown }).promptPreview;
    if (typeof prev === "string" && prev.length > 0) {
      return prev.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS);
    }
  }
  const bpb = pending.before_prompt_build;
  if (bpb && typeof bpb === "object" && !Array.isArray(bpb)) {
    const prev = (bpb as { promptPreview?: unknown }).promptPreview;
    if (typeof prev === "string" && prev.length > 0) {
      return prev.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS);
    }
  }
  const bmr = pending.before_model_resolve;
  if (bmr && typeof bmr === "object" && !Array.isArray(bmr)) {
    const prev = (bmr as { promptPreview?: unknown }).promptPreview;
    if (typeof prev === "string" && prev.length > 0) {
      return prev.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS);
    }
  }
  const sst = pending.session_start;
  if (sst && typeof sst === "object" && !Array.isArray(sst)) {
    try {
      return JSON.stringify(sst).slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS);
    } catch {
      return "[session_start]";
    }
  }
  return undefined;
}

type ActiveTurn = {
  sessionKey: string;
  workspace: string;
  project: string;
  traceId: string;
  threadId: string;
  llmSpanId: string | null;
  toolSpanByCallId: Map<string, string>;
  spanSort: number;
  startedAt: number;
  threadRow: Record<string, unknown>;
  traceRow: Record<string, unknown>;
  spans: Record<string, unknown>[];
  pendingUserMessage?: Record<string, unknown>;
};

/** OpenClaw 部分通道先 `agent_end` 再 `llm_output`；回合已 close 后用此引用补写 span.usage / trace.output。 */
type LateLlmRef = {
  traceId: string;
  spanId: string;
  threadId: string;
  closedAtMs: number;
  /** `closeTurn` 时登记的所有 session 别名，避免 `llm_output` 的 ctx 只带 feishu/oc 而命中不了 ref。 */
  mapKeys: string[];
};

export class OpikOpenClawRuntime {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly lateLlmOutputRefBySk = new Map<string, LateLlmRef>();
  private readonly lateLlmOutputGraceMs = 120_000;
  /** Last `turn_id` for an `external` run per thread — async/subagent follow-ups attach via `parent_turn_id`. */
  private readonly lastExternalTurnIdByThread = new Map<string, string>();
  /** `…/state/crabagent` — pending JSON 存 `pending/` 下，防崩溃或未触发 agent_end 丢上下文。 */
  private readonly persistPendingDir?: string;
  private readonly traceBareAgentEnds: boolean;
  private readonly debugTrace?: (phase: string, data: Record<string, unknown>) => void;

  constructor(
    private readonly workspace: string,
    private readonly project: string,
    opts?: {
      persistPendingDir?: string;
      traceBareAgentEnds?: boolean;
      debugTrace?: (phase: string, data: Record<string, unknown>) => void;
    },
  ) {
    const d = opts?.persistPendingDir?.trim();
    this.persistPendingDir = d || undefined;
    this.traceBareAgentEnds = opts?.traceBareAgentEnds !== false;
    this.debugTrace = opts?.debugTrace;
    if (this.persistPendingDir) {
      this.hydratePendingFromDisk();
    }
  }

  private computeTurnMetadata(
    threadId: string,
    pending: Record<string, unknown>,
    promptPreview: string | undefined,
  ): { turnId: string; runKind: ThreadRunKind; parentTurnId: string | null } {
    const runKind = inferThreadRunKind(pending, promptPreview);
    const turnId = randomUUID();
    let parentTurnId: string | null = null;
    // External is the only top-level; all non-external turns attach under the latest external (if any).
    if (runKind !== "external") {
      parentTurnId = this.lastExternalTurnIdByThread.get(threadId) ?? null;
    } else {
      this.lastExternalTurnIdByThread.set(threadId, turnId);
    }
    return { turnId, runKind, parentTurnId };
  }

  private hydratePendingFromDisk(): void {
    if (!this.persistPendingDir) {
      return;
    }
    for (const rec of loadAllPendingSnapshots(this.persistPendingDir)) {
      this.applyPendingMerge(rec.sessionKey, rec.payload as Record<string, unknown>, true);
    }
  }

  /**
   * @param skipDisk 为 true 时表示从磁盘恢复合并，避免 hydrate 时反复写盘。
   */
  private applyPendingMerge(
    sessionKey: string,
    payload: Record<string, unknown>,
    skipDisk: boolean,
  ): void {
    const sk = sessionKey.trim() || "unknown-session";
    const cur = this.active.get(sk);
    if (cur) {
      cur.pendingUserMessage = { ...(cur.pendingUserMessage ?? {}), ...payload };
      return;
    }
    const merged = { ...(this.pendingOnly.get(sk) ?? {}), ...payload };
    this.pendingOnly.set(sk, merged);
    if (!skipDisk && this.persistPendingDir && Object.keys(merged).length > 0) {
      writePendingSnapshot(this.persistPendingDir, sk, merged);
    }
  }

  mergePendingContext(sessionKey: string, payload: Record<string, unknown>): void {
    this.applyPendingMerge(sessionKey, payload, false);
  }

  private readonly pendingOnly = new Map<string, Record<string, unknown>>();

  private takePending(sk: string): Record<string, unknown> | undefined {
    const a = this.pendingOnly.get(sk);
    this.pendingOnly.delete(sk);
    if (this.persistPendingDir) {
      deletePendingSnapshot(this.persistPendingDir, sk);
    }
    return a;
  }

  /** 与 CozeLoop 类似：同一轮 OpenClaw 可能在不同 hook 使用 sessionKey / conversationId / feishu id 等，合并取出 pending。 */
  private takePendingAliases(keys: string[]): Record<string, unknown> | undefined {
    const seen = new Set<string>();
    let acc: Record<string, unknown> | undefined;
    for (const raw of keys) {
      const k = raw.trim() || "unknown-session";
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      const p = this.takePending(k);
      if (p && Object.keys(p).length > 0) {
        acc = acc ? { ...acc, ...p } : { ...p };
      }
    }
    return acc;
  }

  /**
   * 在 hook 给的别名之外，把 `pendingOnly` 中含用户正文且 oc_/ou_ 与主键/别名相交的桶并入，避免首帧 llm_input 仅粗键时 peek 为空。
   */
  private expandPendingAliasKeysForUserTurn(baseKeys: string[], primarySk: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (raw: string) => {
      const k = raw.trim() || "unknown-session";
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    };
    for (const k of baseKeys) {
      add(k);
    }
    add(primarySk);
    const anchor = anchorCorrelationIds(baseKeys, primarySk);
    if (anchor.size === 0) {
      return out;
    }
    for (const [pk, p] of this.pendingOnly) {
      if (!pendingHasUserInboundMessage(p)) {
        continue;
      }
      const side = new Set<string>();
      for (const x of extractThreadCorrelationIds(pk)) {
        side.add(x);
      }
      for (const x of messageReceivedCorrelationIds(p)) {
        side.add(x);
      }
      let hit = false;
      for (const a of anchor) {
        if (side.has(a)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        add(pk);
      }
    }
    return out;
  }

  /**
   * 不消费 pending：用于采样判断。合并 `pendingOnly` 与进行中回合的 `pendingUserMessage`（入站可能在 LLM 尚未结束时到达）。
   */
  private peekPendingForSampling(keys: string[], primarySk: string): Record<string, unknown> | undefined {
    const seen = new Set<string>();
    let acc: Record<string, unknown> | undefined;
    for (const raw of [...keys, primarySk]) {
      const k = raw.trim() || "unknown-session";
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      const disk = this.pendingOnly.get(k);
      const activeP = this.active.get(k)?.pendingUserMessage;
      const blob = {
        ...(disk && typeof disk === "object" ? disk : {}),
        ...(activeP && typeof activeP === "object" ? activeP : {}),
      } as Record<string, unknown>;
      if (Object.keys(blob).length > 0) {
        acc = acc ? { ...acc, ...blob } : { ...blob };
      }
    }
    return acc && Object.keys(acc).length > 0 ? acc : undefined;
  }

  /** 任一会话键上是否存在进行中的 LLM 回合。 */
  activeHasAny(keys: string[]): boolean {
    for (const raw of keys) {
      const k = raw.trim() || "unknown-session";
      if (this.active.has(k)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 用户发消息但长时间无 `llm_input` / `agent_end` 时，将仍留在 pending 的 inbound 合成为 non-LLM trace。
   */
  tryDeferredNonLlmFlush(aliasKeys: string[], ctx: AgentCtx): OpikBatchPayload | null {
    const keys =
      aliasKeys.length > 0
        ? [...new Set(aliasKeys.map((k) => k.trim() || "unknown-session"))]
        : ["unknown-session"];
    const primary = keys[0] ?? "unknown-session";
    const expanded = this.expandPendingAliasKeysForUserTurn(keys, primary);
    if (this.activeHasAny(expanded)) {
      return null;
    }
    const peeked = this.peekPendingForSampling(expanded, primary);
    if (!pendingHasUserInboundMessage(peeked)) {
      return null;
    }
    return this.flushNonLlmAgentEnd(primary, ctx, { success: true, messages: [] }, expanded);
  }

  private registerLateLlmOutputRef(
    sk: string,
    ref: Pick<LateLlmRef, "traceId" | "spanId" | "threadId" | "closedAtMs">,
    lateAliasKeys?: string[],
  ): void {
    const seen = new Set<string>();
    const mapKeys: string[] = [];
    for (const raw of [sk, ...(lateAliasKeys ?? [])]) {
      const k = raw.trim() || "unknown-session";
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      mapKeys.push(k);
    }
    const full: LateLlmRef = { ...ref, mapKeys };
    for (const k of mapKeys) {
      this.lateLlmOutputRefBySk.set(k, full);
    }
  }

  private clearLateLlmOutputRef(ref: LateLlmRef): void {
    for (const k of ref.mapKeys) {
      this.lateLlmOutputRefBySk.delete(k);
    }
  }

  /** `llm_output` 的 hook ctx 可能比 `agent_end` 稀疏；与 `traceSessionKeyCandidates` 并集再查 active / late。 */
  private llmOutputLookupKeys(sk: string, extra?: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [sk, ...(extra ?? [])]) {
      const k = raw.trim() || "unknown-session";
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  /** 结束上一轮并返回 batch（若有）。 */
  private closeTurn(sk: string, endReason: string, lateAliasKeys?: string[]): OpikBatchPayload | null {
    const cur = this.active.get(sk);
    if (!cur) {
      return null;
    }
    const t = nowMs();
    cur.traceRow.updated_at_ms = t;
    const prevMeta =
      typeof cur.traceRow.metadata === "object" && cur.traceRow.metadata !== null
        ? (cur.traceRow.metadata as Record<string, unknown>)
        : {};
    cur.traceRow.metadata = { ...prevMeta, end_reason: endReason };
    if (cur.traceRow.is_complete !== 1) {
      cur.traceRow.is_complete = 1;
      cur.traceRow.ended_at_ms = cur.traceRow.ended_at_ms ?? t;
      if (endReason === "new_llm_input") {
        if (cur.traceRow.success === undefined) {
          cur.traceRow.success = null;
        }
      } else if (cur.traceRow.success === undefined) {
        cur.traceRow.success = 1;
      }
    }
    for (const s of cur.spans) {
      if (s.is_complete !== 1) {
        s.is_complete = 1;
        s.end_time_ms = s.end_time_ms ?? t;
      }
    }
    if (cur.pendingUserMessage && Object.keys(cur.pendingUserMessage).length > 0) {
      const inputRaw = cur.traceRow.input;
      const input =
        inputRaw && typeof inputRaw === "object" && !Array.isArray(inputRaw)
          ? (inputRaw as Record<string, unknown>)
          : {};
      const utRaw = input.user_turn;
      const userTurn =
        utRaw && typeof utRaw === "object" && !Array.isArray(utRaw) ? (utRaw as Record<string, unknown>) : {};
      cur.traceRow.input = normalizeOpikTraceInputForStorage({
        ...input,
        user_turn: { ...userTurn, ...cur.pendingUserMessage },
      }) as Record<string, unknown>;
    }
    const batch: OpikBatchPayload = {
      threads: [cur.threadRow],
      traces: [cur.traceRow],
      spans: [...cur.spans],
    };
    if (cur.llmSpanId) {
      this.registerLateLlmOutputRef(
        sk,
        {
          traceId: cur.traceId,
          spanId: cur.llmSpanId,
          threadId: cur.threadId,
          closedAtMs: t,
        },
        lateAliasKeys,
      );
    }
    this.active.delete(sk);
    return batch;
  }

  onLlmInput(
    skRaw: string,
    ev: {
      provider?: string;
      model?: string;
      prompt?: string;
      systemPrompt?: string;
      imagesCount?: number;
      sessionId?: string;
      runId?: string;
    },
    ctx: AgentCtx,
    sampleBps: number,
    pendingAliasKeys?: string[],
    extras?: LlmInputIngestExtras,
  ): OpikBatchPayload | null {
    const sk = skRaw.trim() || effectiveSessionKey(ctx);
    const basePendingKeys =
      pendingAliasKeys && pendingAliasKeys.length > 0
        ? [...new Set(pendingAliasKeys.map((k) => k.trim() || "unknown-session"))]
        : [sk];
    const pendingKeys = this.expandPendingAliasKeysForUserTurn(basePendingKeys, sk);
    const peeked = this.peekPendingForSampling(pendingKeys, sk);
    const forceTraceForUserMessage = pendingHasUserInboundMessage(peeked);
    if (!forceTraceForUserMessage && !shouldSample(sampleBps)) {
      /** 无用户 inbound 时仍可按采样跳过；有用户正文则强制本回合建 LLM trace。 */
      this.debugTrace?.("llm_input_sample_skipped", {
        sessionKey: sk,
        sampleRateBps: sampleBps,
        pendingAliasKeys: pendingKeys,
        provider: ev.provider,
        model: ev.model,
      });
      return null;
    }
    const prev = this.closeTurn(sk, "new_llm_input", pendingKeys);
    const t = nowMs();
    const traceId = randomUUID();
    const threadId = sk;
    const llmSpanId = randomUUID();
    const pending = this.takePendingAliases(pendingKeys);
    const pendingRec =
      pending && typeof pending === "object" && !Array.isArray(pending)
        ? (pending as Record<string, unknown>)
        : {};
    const routingMerged = mergeOpenclawRoutingLayers(
      extractRoutingFromPendingUserTurn(pendingRec),
      extras?.routingFromEvent,
    );
    const openclawRouting = buildOpenclawRoutingMetadata(threadId, ctx, routingMerged);
    const startMs = pendingHasUserInboundMessage(pendingRec)
      ? firstUserInboundTimestampMs(pendingRec, t)
      : t;
    const agLabel = threadAgentLabelFromPending(ctx, pendingRec) ?? threadAgentLabel(ctx);
    const chLabel =
      threadChannelLabelFromPending(ctx, pendingRec, threadId) ?? threadChannelLabel(ctx);
    const promptStr = typeof ev.prompt === "string" ? ev.prompt : undefined;
    /** Leading field so DB previews / SUBSTR on input_json still catch user text if JSON is truncated. */
    const input = normalizeOpikTraceInputForStorage({
      list_input_preview: promptStr && promptStr.length > 0 ? promptStr.slice(0, 12_000) : undefined,
      prompt: ev.prompt,
      systemPrompt: ev.systemPrompt,
      imagesCount: ev.imagesCount,
      user_turn: pending,
      openclaw: {
        sessionId: ctx.sessionId,
        sessionKey: ctx.sessionKey,
        channelId: ctx.channelId,
        agentId: ctx.agentId,
      },
      ...(openclawRouting ? { openclaw_routing: openclawRouting } : {}),
    }) as Record<string, unknown>;
    const runIdTrim = typeof ev.runId === "string" ? ev.runId.trim() : "";
    const threadRow = {
      thread_id: threadId,
      workspace_name: this.workspace,
      project_name: this.project,
      first_seen_ms: startMs,
      last_seen_ms: t,
      agent_name: agLabel,
      channel_name: chLabel,
      metadata: { source: "openclaw-trace-plugin" },
    };
    const turnMeta = this.computeTurnMetadata(threadId, pendingRec, promptStr);
    const traceRow: Record<string, unknown> = {
      trace_id: traceId,
      thread_id: threadId,
      workspace_name: this.workspace,
      project_name: this.project,
      name: ev.model ?? "llm",
      input,
      metadata: {
        provider: ev.provider,
        usage: {},
        ...(runIdTrim.length > 0 ? { run_id: runIdTrim, runId: runIdTrim } : {}),
        agent_name: agLabel,
        turn_id: turnMeta.turnId,
        run_kind: turnMeta.runKind,
        parent_turn_id: turnMeta.parentTurnId,
        openclaw_context: {
          messageProvider: ctx.messageProvider,
          conversationId: ctx.conversationId,
          agentId: ctx.agentId,
        },
        ...(openclawRouting ? { openclaw_routing: openclawRouting } : {}),
      },
      created_at_ms: startMs,
      is_complete: 0,
      created_from: "openclaw-trace-plugin",
    };
    const spanMeta: Record<string, unknown> = {};
    if (openclawRouting) {
      spanMeta.openclaw_routing = openclawRouting;
    }
    const mp = extras?.modelParams;
    if (mp && Object.keys(mp).length > 0) {
      spanMeta.model_params = mp;
    }
    const spanRow: Record<string, unknown> = {
      span_id: llmSpanId,
      trace_id: traceId,
      parent_span_id: null,
      name: ev.model ?? "llm",
      type: "llm",
      start_time_ms: startMs,
      input: normalizeOpikSpanInputForStorage({ promptPreview: ev.prompt?.slice(0, 2000) }) as Record<string, unknown>,
      model: ev.model,
      provider: ev.provider,
      is_complete: 0,
      sort_index: 1,
      ...(Object.keys(spanMeta).length > 0 ? { metadata: spanMeta } : {}),
    };
    const turn: ActiveTurn = {
      sessionKey: sk,
      workspace: this.workspace,
      project: this.project,
      traceId,
      threadId,
      llmSpanId,
      toolSpanByCallId: new Map(),
      spanSort: 1,
      startedAt: startMs,
      threadRow,
      traceRow,
      spans: [spanRow],
    };
    this.active.set(sk, turn);
    return prev;
  }

  /** 无 ingestible pending / transcript 时仍写一条占位 trace（自动化扫描等）。 */
  private buildBareAgentEndBatch(
    sk: string,
    ctx: AgentCtx,
    ev: { success?: boolean; error?: unknown; durationMs?: number; messages?: unknown[] },
  ): OpikBatchPayload {
    const t = nowMs();
    const traceId = randomUUID();
    const threadId = sk;
    const traceName = ctx.agentId?.trim() || ctx.agentName?.trim() || "non_llm_turn";
    const input = {
      user_turn: {},
      openclaw: {
        sessionId: ctx.sessionId,
        sessionKey: ctx.sessionKey,
        channelId: ctx.channelId,
        agentId: ctx.agentId,
      },
    };
    const threadRow = {
      thread_id: threadId,
      workspace_name: this.workspace,
      project_name: this.project,
      first_seen_ms: t,
      last_seen_ms: t,
      agent_name: threadAgentLabel(ctx),
      channel_name: threadChannelLabel(ctx),
      metadata: { source: "openclaw-trace-plugin" },
    };
    const turnMeta = this.computeTurnMetadata(threadId, {}, undefined);
    const traceRow: Record<string, unknown> = {
      trace_id: traceId,
      thread_id: threadId,
      workspace_name: this.workspace,
      project_name: this.project,
      name: traceName,
      input,
      metadata: {
        usage: {},
        turn_id: turnMeta.turnId,
        run_kind: turnMeta.runKind,
        parent_turn_id: turnMeta.parentTurnId,
        openclaw_context: {
          messageProvider: ctx.messageProvider,
          conversationId: ctx.conversationId,
          agentId: ctx.agentId,
        },
        trace_kind: "agent_end_bare",
        messageCount: Array.isArray(ev.messages) ? ev.messages.length : undefined,
      },
      created_at_ms: t,
      is_complete: 1,
      success: ev.success === false ? 0 : 1,
      ended_at_ms: t,
      duration_ms: ev.durationMs ?? 0,
      created_from: "openclaw-trace-plugin",
    };
    if (ev.error) {
      traceRow.error_info = {
        message: typeof ev.error === "string" ? ev.error : JSON.stringify(ev.error),
      };
      traceRow.success = 0;
    }
    const spanRow: Record<string, unknown> = {
      span_id: randomUUID(),
      trace_id: traceId,
      parent_span_id: null,
      name: "turn",
      type: "general",
      start_time_ms: t,
      end_time_ms: t,
      duration_ms: 0,
      metadata: {
        note: "Bare agent_end (no ingestible pending); traceBareAgentEnds.",
      },
      is_complete: 1,
      sort_index: 1,
    };
    return { threads: [threadRow], traces: [traceRow], spans: [spanRow] };
  }

  /** 无 `llm_input`（如自动化/邮件规则直接回复）但有 `message_received` 等 pending 时，在 `agent_end` 补一条 trace。 */
  private flushNonLlmAgentEnd(
    sk: string,
    ctx: AgentCtx,
    ev: { success?: boolean; error?: unknown; durationMs?: number; messages?: unknown[] },
    pendingAliasKeys: string[],
  ): OpikBatchPayload | null {
    const baseKeys =
      pendingAliasKeys.length > 0
        ? [...new Set(pendingAliasKeys.map((k) => k.trim() || "unknown-session"))]
        : [sk];
    const keys = this.expandPendingAliasKeysForUserTurn(baseKeys, sk);
    let pending = this.takePendingAliases(keys);
    const pendingAfterTake = pending;
    if (!pendingHasIngestibleContext(pending)) {
      pending = pendingFromTranscriptMessages(ev.messages);
    }
    if (pending == null || !pendingHasIngestibleContext(pending)) {
      if (this.traceBareAgentEnds) {
        return this.buildBareAgentEndBatch(sk, ctx, ev);
      }
      this.debugTrace?.("non_llm_agent_end_no_trace", {
        sessionKey: sk,
        pendingAliasKeys: keys,
        tookPendingFromAliases: Boolean(pendingAfterTake && Object.keys(pendingAfterTake).length > 0),
        stashedPendingShape: summarizePendingShape(pendingAfterTake),
        transcriptTried: Boolean(ev.messages && Array.isArray(ev.messages) && ev.messages.length > 0),
        messageCount: Array.isArray(ev.messages) ? ev.messages.length : 0,
        note: "pending 已从别名 map 取出；若无 ingestible 字段且 transcript 抽不出用户向正文，本回合不产生 batch。",
      });
      return null;
    }
    const t = nowMs();
    const startMs = firstUserInboundTimestampMs(pending, t);
    const traceDur =
      typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs) && ev.durationMs > 0
        ? Math.floor(ev.durationMs)
        : Math.max(1, t - startMs);
    const traceId = randomUUID();
    const threadId = sk;
    const preview = previewFromPendingUserTurn(pending);
    const agLabel = threadAgentLabelFromPending(ctx, pending);
    const chLabel = threadChannelLabelFromPending(ctx, pending, threadId);
    const traceName = agLabel ?? "non_llm_turn";
    const input = normalizeOpikTraceInputForStorage({
      list_input_preview: preview,
      prompt: preview,
      user_turn: pending,
      openclaw: {
        sessionId: ctx.sessionId,
        sessionKey: ctx.sessionKey,
        channelId: ctx.channelId,
        agentId: ctx.agentId,
      },
    }) as Record<string, unknown>;
    const threadRow = {
      thread_id: threadId,
      workspace_name: this.workspace,
      project_name: this.project,
      first_seen_ms: startMs,
      last_seen_ms: t,
      agent_name: agLabel,
      channel_name: chLabel,
      metadata: { source: "openclaw-trace-plugin" },
    };
    const turnMeta = this.computeTurnMetadata(threadId, pending as Record<string, unknown>, preview);
    const traceRow: Record<string, unknown> = {
      trace_id: traceId,
      thread_id: threadId,
      workspace_name: this.workspace,
      project_name: this.project,
      name: traceName,
      input,
      metadata: {
        usage: {},
        agent_name: agLabel,
        turn_id: turnMeta.turnId,
        run_kind: turnMeta.runKind,
        parent_turn_id: turnMeta.parentTurnId,
      openclaw_context: {
        messageProvider: ctx.messageProvider,
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
      },
        trace_kind: (() => {
          const fr =
            pending.message_received &&
            typeof pending.message_received === "object" &&
            !Array.isArray(pending.message_received)
              ? String((pending.message_received as { from?: unknown }).from ?? "")
              : "";
          if (fr.includes("transcript_fallback")) {
            return "agent_end_transcript_fallback";
          }
          if (fr.includes("transcript")) {
            return "agent_end_transcript";
          }
          return "agent_end_without_llm";
        })(),
        messageCount: Array.isArray(ev.messages) ? ev.messages.length : undefined,
      },
      created_at_ms: startMs,
      updated_at_ms: t,
      is_complete: 1,
      success: ev.success === false ? 0 : 1,
      ended_at_ms: t,
      duration_ms: traceDur,
      created_from: "openclaw-trace-plugin",
    };
    if (ev.error) {
      traceRow.error_info = {
        message: typeof ev.error === "string" ? ev.error : JSON.stringify(ev.error),
      };
      traceRow.success = 0;
    }
    const spanRow: Record<string, unknown> = {
      span_id: randomUUID(),
      trace_id: traceId,
      parent_span_id: null,
      name: "turn",
      type: "general",
      start_time_ms: startMs,
      end_time_ms: t,
      duration_ms: traceDur,
      metadata: {
        note: "No llm_input for this turn (e.g. automation or template reply).",
      },
      is_complete: 1,
      sort_index: 1,
    };
    return { threads: [threadRow], traces: [traceRow], spans: [spanRow] };
  }

  onLlmOutput(
    sk: string,
    ev: {
      provider?: string;
      model?: string;
      assistantTexts?: unknown;
      usage?: Record<string, unknown>;
    },
    sessionAliasKeys?: string[],
  ): OpikBatchPayload | null {
    const keys = this.llmOutputLookupKeys(sk, sessionAliasKeys);
    let cur: ActiveTurn | undefined;
    for (const k of keys) {
      const t0 = this.active.get(k);
      if (t0?.llmSpanId) {
        cur = t0;
        break;
      }
    }
    if (!cur || !cur.llmSpanId) {
      let late: LateLlmRef | undefined;
      let lateMatchedKey: string | undefined;
      for (const k of keys) {
        const L = this.lateLlmOutputRefBySk.get(k);
        if (L) {
          late = L;
          lateMatchedKey = k;
          break;
        }
      }
      const now = nowMs();
      const hasPayload =
        ev.usage != null ||
        (Array.isArray(ev.assistantTexts) && ev.assistantTexts.length > 0);
      if (
        late &&
        now - late.closedAtMs <= this.lateLlmOutputGraceMs &&
        hasPayload
      ) {
        this.clearLateLlmOutputRef(late);
        const t = now;
        const spanPatch: Record<string, unknown> = {
          span_id: late.spanId,
          trace_id: late.traceId,
          name: ev.model ?? "llm",
          type: "llm",
          model: ev.model,
          provider: ev.provider,
          is_complete: 1,
          end_time_ms: t,
        };
        if (ev.usage !== undefined) {
          spanPatch.usage = ev.usage;
        }
        if (ev.assistantTexts !== undefined) {
          spanPatch.output = { assistantTexts: ev.assistantTexts };
        }
        const meta: Record<string, unknown> = {};
        if (ev.usage && isPlainObj(ev.usage)) {
          meta.usage = ev.usage;
          mergeTotalTokensFromUsage(meta, ev.usage);
        }
        const tracePatch: Record<string, unknown> = {
          trace_id: late.traceId,
          thread_id: late.threadId,
          workspace_name: this.workspace,
          project_name: this.project,
          updated_at_ms: t,
        };
        if (Object.keys(meta).length > 0) {
          tracePatch.metadata = meta;
        }
        if (Array.isArray(ev.assistantTexts)) {
          tracePatch.output = { assistantTexts: ev.assistantTexts };
        }
        this.debugTrace?.("llm_output_late_patch", {
          sessionKey: lateMatchedKey ?? sk,
          primarySk: sk,
          lookupTried: keys.slice(0, 24),
          traceId: late.traceId,
          spanId: late.spanId,
          note: "agent_end 已关闭回合后到达的 llm_output，补写 span/trace",
        });
        return {
          threads: [],
          traces: [tracePatch],
          spans: [spanPatch],
        };
      }
      this.debugTrace?.("llm_output_no_active_turn", {
        sessionKey: sk,
        lookupTried: keys.slice(0, 24),
        lookupCount: keys.length,
        lateFound: Boolean(late),
        hasPayload,
        provider: ev.provider,
        model: ev.model,
        note: "无进行中的 llm_input ActiveTurn；sessionKey 与 llm_input 不一致或非 main agent 键错位时常出现",
      });
      return null;
    }
    const t = nowMs();
    const span = cur.spans.find((s) => s.span_id === cur.llmSpanId);
    if (span) {
      span.output = { assistantTexts: ev.assistantTexts };
      span.usage = ev.usage;
      span.model = ev.model ?? span.model;
      span.provider = ev.provider ?? span.provider;
      span.end_time_ms = t;
      span.duration_ms = t - Number(cur.startedAt);
      span.is_complete = 1;
    }
    const meta = { ...(cur.traceRow.metadata as Record<string, unknown>) };
    meta.usage = ev.usage ?? meta.usage;
    meta.output_preview = Array.isArray(ev.assistantTexts)
      ? String(ev.assistantTexts[0] ?? "").slice(0, 4000)
      : undefined;
    cur.traceRow.metadata = meta;
    cur.traceRow.output = { assistantTexts: ev.assistantTexts };
    cur.traceRow.updated_at_ms = t;
    const metaOut = cur.traceRow.metadata as Record<string, unknown>;
    const uRec = ev.usage && isPlainObj(ev.usage) ? ev.usage : {};
    mergeTotalTokensFromUsage(metaOut, uRec);
    let clearedLate = false;
    for (const k of keys) {
      const strayLate = this.lateLlmOutputRefBySk.get(k);
      if (strayLate) {
        this.clearLateLlmOutputRef(strayLate);
        clearedLate = true;
        break;
      }
    }
    if (!clearedLate) {
      this.lateLlmOutputRefBySk.delete(sk);
    }
    return null;
  }

  onBeforeTool(sk: string, ev: { toolName?: string; toolCallId?: string; params?: unknown }): void {
    const cur = this.active.get(sk);
    if (!cur) {
      this.debugTrace?.("before_tool_no_active_turn", {
        sessionKey: sk,
        toolName: ev.toolName,
        toolCallId: ev.toolCallId,
        note: "无 ActiveTurn，工具 span 未写入",
      });
      return;
    }
    const id = ev.toolCallId?.trim() || randomUUID();
    const t = nowMs();
    cur.spanSort += 1;
    const spanId = randomUUID();
    cur.toolSpanByCallId.set(id, spanId);
    cur.spans.push({
      span_id: spanId,
      trace_id: cur.traceId,
      parent_span_id: cur.llmSpanId,
      name: ev.toolName ?? "tool",
      type: "tool",
      start_time_ms: t,
      input: { params: ev.params },
      is_complete: 0,
      sort_index: cur.spanSort,
    });
  }

  onAfterTool(
    sk: string,
    ev: {
      toolCallId?: string;
      error?: unknown;
      durationMs?: number;
      result?: unknown;
    },
  ): void {
    const cur = this.active.get(sk);
    if (!cur) {
      this.debugTrace?.("after_tool_no_active_turn", {
        sessionKey: sk,
        toolCallId: ev.toolCallId,
        note: "无 ActiveTurn，after_tool 忽略",
      });
      return;
    }
    const key = ev.toolCallId?.trim();
    const spanId = key ? cur.toolSpanByCallId.get(key) : undefined;
    const span = spanId ? cur.spans.find((s) => s.span_id === spanId) : undefined;
    if (!span) {
      this.debugTrace?.("after_tool_span_not_found", {
        sessionKey: sk,
        toolCallId: ev.toolCallId,
        knownCallIds: [...cur.toolSpanByCallId.keys()].slice(0, 12),
        note: "找不到对应 before_tool 的 span",
      });
      return;
    }
    const t = nowMs();
    span.output = { result: ev.result };
    span.end_time_ms = t;
    span.duration_ms = ev.durationMs ?? t - Number(span.start_time_ms ?? t);
    span.is_complete = 1;
    if (ev.error) {
      span.error_info = {
        message: typeof ev.error === "string" ? ev.error : JSON.stringify(ev.error),
      };
    }
    enrichToolSpanResourceAudit(span);
  }

  onAgentEnd(
    sk: string,
    ev: { success?: boolean; error?: unknown; durationMs?: number; messages?: unknown[] },
    ctx?: AgentCtx,
    pendingAliasKeys?: string[],
  ): OpikBatchPayload | null {
    const cur = this.active.get(sk);
    if (!cur) {
      if (!ctx) {
        this.debugTrace?.("agent_end_dropped_no_ctx", {
          sessionKey: sk,
          note: "无 ActiveTurn 且无 hook ctx，无法合成 non-LLM trace。",
        });
        return null;
      }
      return this.flushNonLlmAgentEnd(sk, ctx, ev, pendingAliasKeys ?? [sk]);
    }
    const t = nowMs();
    cur.traceRow.success = ev.success === false ? 0 : 1;
    cur.traceRow.duration_ms = ev.durationMs ?? t - cur.startedAt;
    cur.traceRow.ended_at_ms = t;
    cur.traceRow.updated_at_ms = t;
    cur.traceRow.is_complete = 1;
    if (ev.error) {
      cur.traceRow.error_info = {
        message: typeof ev.error === "string" ? ev.error : JSON.stringify(ev.error),
      };
      cur.traceRow.success = 0;
    }
    cur.traceRow.metadata = {
      ...(cur.traceRow.metadata as object),
      messageCount: Array.isArray(ev.messages) ? ev.messages.length : undefined,
    };
    const usageFromMsgs = usageFromAgentEndMessages(ev.messages);
    if (usageFromMsgs) {
      const meta = cur.traceRow.metadata as Record<string, unknown>;
      const prevU = meta.usage;
      const prevHas =
        isPlainObj(prevU) && usagePartsPresent(readUsageTokenParts(prevU as Record<string, unknown>));
      if (!prevHas) {
        meta.usage = usageFromMsgs;
        mergeTotalTokensFromUsage(meta, usageFromMsgs);
      }
      if (cur.llmSpanId) {
        const span = cur.spans.find((s) => s.span_id === cur.llmSpanId);
        if (span) {
          const su = span.usage;
          const spanHas =
            isPlainObj(su) && usagePartsPresent(readUsageTokenParts(su as Record<string, unknown>));
          if (!spanHas) {
            span.usage = usageFromMsgs;
          }
        }
      }
    }
    return this.closeTurn(sk, "agent_end", pendingAliasKeys ?? [sk]);
  }

  /** compaction / subagent 等：记一条 general span。 */
  addGeneralSpan(sk: string, name: string, payload: Record<string, unknown>): void {
    const cur = this.active.get(sk);
    if (!cur) {
      this.debugTrace?.("general_span_dropped_no_active_turn", {
        sessionKey: sk,
        spanName: name,
        note: "当前 session 无进行中的 llm_input turn，span 未写入任何 trace。",
      });
      return;
    }
    const t = nowMs();
    cur.spanSort += 1;
    cur.spans.push({
      span_id: randomUUID(),
      trace_id: cur.traceId,
      parent_span_id: cur.llmSpanId,
      name,
      type: "general",
      start_time_ms: t,
      end_time_ms: t,
      duration_ms: 0,
      metadata: payload,
      is_complete: 1,
      sort_index: cur.spanSort,
    });
  }
}
