import { randomUUID } from "node:crypto";

/**
 * OpenClaw session keys use `agent:<agentId>:<rest>` (see `resolveSessionAgentId`).
 * Returns the configured agent id / name segment (e.g. `main`).
 */
export function inferAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const raw = sessionKey?.trim();
  if (!raw) {
    return undefined;
  }
  const m = /^agent:([^:]+):/i.exec(raw);
  const id = m?.[1]?.trim();
  return id || undefined;
}

/**
 * Best-effort messaging channel label from OpenClaw session keys, e.g.
 * `agent:main:telegram:direct:…` → `telegram`, `agent:main:main` → `main`.
 * Does not depend on OpenClaw core packages (keeps the plugin self-contained).
 */
export function inferChannelFromSessionKey(sessionKey: string | undefined): string | undefined {
  const raw = sessionKey?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  const agentMatch = /^agent:([^:]+):(.+)$/.exec(raw);
  if (agentMatch) {
    const rest = agentMatch[2] ?? "";
    const restParts = rest.split(":").filter(Boolean);
    if (restParts.length === 0) {
      return undefined;
    }
    const head = restParts[0] ?? "";
    if (head === "subagent" || head === "cron" || head === "acp") {
      return head;
    }
    return head || undefined;
  }
  const legacy = raw.split(":").filter(Boolean);
  return legacy[0] || undefined;
}

/**
 * Peer / chat id after `:direct:` in session keys, e.g.
 * `agent:main:openclaw-weixin:direct:user@im.wechat` → `user@im.wechat`.
 * Case preserved; {@link TraceState} normalizes when building the merge key.
 */
export function inferDirectPeerFromSessionKey(sessionKey: string | undefined): string | undefined {
  const raw = sessionKey?.trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  const needle = ":direct:";
  const idx = lower.indexOf(needle);
  if (idx < 0) {
    return undefined;
  }
  const peer = raw.slice(idx + needle.length).trim();
  return peer.length > 0 ? peer : undefined;
}

/**
 * OpenClaw may omit `sessionKey` on hooks when the control UI is hidden, but still sets
 * `channelId` / `messageProvider` on the hook context.
 */
export function resolveTraceChannel(params: {
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  payload: Record<string, unknown>;
}): string | undefined {
  const existing = params.payload.channel;
  if (typeof existing === "string" && existing.trim().length > 0) {
    return existing.trim().toLowerCase();
  }
  const fromSk = inferChannelFromSessionKey(params.sessionKey);
  if (fromSk) {
    return fromSk;
  }
  if (typeof params.channelId === "string" && params.channelId.trim().length > 0) {
    return params.channelId.trim().toLowerCase();
  }
  if (typeof params.messageProvider === "string" && params.messageProvider.trim().length > 0) {
    return params.messageProvider.trim().toLowerCase();
  }
  return undefined;
}

function mergePayloadWithChannel(params: {
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const label = resolveTraceChannel(params);
  if (!label) {
    return params.payload;
  }
  return { ...params.payload, channel: label };
}

function resolveAgentIdForEnvelope(params: {
  agentId?: string;
  sessionKey?: string;
}): string | undefined {
  const direct = params.agentId?.trim();
  if (direct) {
    return direct;
  }
  return inferAgentIdFromSessionKey(params.sessionKey);
}

export function buildEvent(params: {
  type: string;
  traceRootId: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  channelId?: string;
  messageProvider?: string;
  runId?: string;
  /** Optional display name for the chat/thread (ingested as top-level `chat_title`). */
  chatTitle?: string;
  /** Optional display name for the agent (ingested as top-level `agent_name`). */
  agentName?: string;
  /** Correlates one user turn with later hooks (`llm_input`, tools, etc.). */
  msgId?: string;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const agent_id = resolveAgentIdForEnvelope({
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  const runIdTrim =
    typeof params.runId === "string" && params.runId.trim().length > 0 ? params.runId.trim() : "";
  const mergedPayload = mergePayloadWithChannel({
    sessionKey: params.sessionKey,
    channelId: params.channelId,
    messageProvider: params.messageProvider,
    payload: params.payload,
  });
  if (runIdTrim) {
    mergedPayload.run_id = runIdTrim;
  }
  const msgIdTrim =
    typeof params.msgId === "string" && params.msgId.trim().length > 0 ? params.msgId.trim() : "";
  if (msgIdTrim) {
    mergedPayload.msg_id = msgIdTrim;
  }
  const out: Record<string, unknown> = {
    schema_version: 1,
    event_id: randomUUID(),
    trace_root_id: params.traceRootId,
    session_id: params.sessionId,
    session_key: params.sessionKey,
    type: params.type,
    payload: mergedPayload,
    ts: new Date().toISOString(),
  };
  if (runIdTrim) {
    out.run_id = runIdTrim;
  }
  if (agent_id) {
    out.agent_id = agent_id;
  }
  const title = params.chatTitle?.trim();
  if (title) {
    out.chat_title = title;
  }
  const agentNameTrim = params.agentName?.trim();
  if (agentNameTrim) {
    out.agent_name = agentNameTrim;
  }
  if (msgIdTrim) {
    out.msg_id = msgIdTrim;
  }
  return out;
}
