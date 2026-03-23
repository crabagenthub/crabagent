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
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const agent_id = resolveAgentIdForEnvelope({
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  const out: Record<string, unknown> = {
    schema_version: 1,
    event_id: randomUUID(),
    trace_root_id: params.traceRootId,
    session_id: params.sessionId,
    session_key: params.sessionKey,
    run_id: params.runId,
    type: params.type,
    payload: mergePayloadWithChannel({
      sessionKey: params.sessionKey,
      channelId: params.channelId,
      messageProvider: params.messageProvider,
      payload: params.payload,
    }),
    ts: new Date().toISOString(),
  };
  if (agent_id) {
    out.agent_id = agent_id;
  }
  return out;
}
