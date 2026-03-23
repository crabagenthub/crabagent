import type Database from "better-sqlite3";
import { ssePublish } from "./sse-hub.js";
import { computeThreadKey } from "./thread-key.js";

export type IngestEventInput = Record<string, unknown>;

/** Same rules as trace-plugin `envelope.ts` (collector stays dependency-free). */
function inferChannelFromSessionKey(sessionKey: string | undefined): string | undefined {
  const raw = sessionKey?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  const agentMatch = /^agent:([^:]+):(.+)$/.exec(raw);
  if (agentMatch) {
    const restParts = (agentMatch[2] ?? "").split(":").filter(Boolean);
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

function normalizeStoredPayload(e: Record<string, unknown>): Record<string, unknown> {
  const base =
    typeof e.payload === "object" && e.payload !== null && !Array.isArray(e.payload)
      ? { ...(e.payload as Record<string, unknown>) }
      : {};
  const existing = base.channel;
  const hasExplicit = typeof existing === "string" && existing.trim().length > 0;
  if (hasExplicit) {
    return base;
  }
  const sk = typeof e.session_key === "string" ? e.session_key : undefined;
  const inferred = inferChannelFromSessionKey(sk);
  if (inferred) {
    return { ...base, channel: inferred };
  }
  return base;
}

function pickClientTs(e: Record<string, unknown>): string | null {
  const ts = e.ts;
  if (typeof ts === "string" && ts.trim().length > 0) {
    return ts.trim();
  }
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return new Date(ts).toISOString();
  }
  return null;
}

function pickChannelColumn(payload: Record<string, unknown>): string | null {
  const ch = payload.channel;
  if (typeof ch === "string" && ch.trim().length > 0) {
    return ch.trim().toLowerCase();
  }
  return null;
}

export function runIngestBatch(params: {
  insertStmt: Database.Statement;
  events: IngestEventInput[];
}): { accepted: number; skipped: number } {
  let accepted = 0;
  let skipped = 0;

  for (const raw of params.events) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const e = raw as Record<string, unknown>;
    const eventId = typeof e.event_id === "string" ? e.event_id : null;
    const type = typeof e.type === "string" ? e.type : null;
    if (!eventId || !type) {
      skipped += 1;
      continue;
    }
    const traceRootId = typeof e.trace_root_id === "string" ? e.trace_root_id : null;
    const sessionId = typeof e.session_id === "string" ? e.session_id : null;
    const sessionKey = typeof e.session_key === "string" ? e.session_key : null;
    const agentId = typeof e.agent_id === "string" ? e.agent_id.trim() || null : null;
    const runId = typeof e.run_id === "string" ? e.run_id : null;
    const schemaVersion = typeof e.schema_version === "number" ? e.schema_version : 1;
    const payloadForStore = normalizeStoredPayload(e);
    const payloadJson = JSON.stringify(payloadForStore);
    const channelCol = pickChannelColumn(payloadForStore);
    const clientTs = pickClientTs(e);
    const r = params.insertStmt.run({
      event_id: eventId,
      trace_root_id: traceRootId,
      session_id: sessionId,
      session_key: sessionKey,
      agent_id: agentId,
      run_id: runId,
      channel: channelCol,
      type,
      payload_json: payloadJson,
      schema_version: schemaVersion,
      client_ts: clientTs,
    });
    if (r.changes > 0) {
      accepted += 1;
      const rowId = Number(r.lastInsertRowid);
      const payload = {
        id: rowId > 0 ? rowId : undefined,
        event_id: eventId,
        trace_root_id: traceRootId ?? undefined,
        session_id: sessionId,
        session_key: sessionKey ?? undefined,
        agent_id: agentId ?? undefined,
        run_id: runId ?? undefined,
        channel: channelCol ?? undefined,
        client_ts: clientTs ?? undefined,
        type,
        payload: payloadForStore,
        created_at: new Date().toISOString(),
      };
      const threadKey = computeThreadKey({
        session_key: sessionKey,
        session_id: sessionId,
        trace_root_id: traceRootId,
      });
      if (threadKey) {
        ssePublish(threadKey, { ...payload, thread_key: threadKey });
      }
    } else {
      skipped += 1;
    }
  }

  return { accepted, skipped };
}
