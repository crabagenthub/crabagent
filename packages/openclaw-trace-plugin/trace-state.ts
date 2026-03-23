import { randomUUID } from "node:crypto";
import { inferChannelFromSessionKey, inferDirectPeerFromSessionKey } from "./envelope.js";

/**
 * Stable key for correlating one user-visible chat (channel + peer), aligned with internal
 * `conversationMapKey` inputs.
 *
 * When `sessionKey` is present, **infer channel and peer from the key first**. Hooks often omit
 * `channelId` / `conversationId` while `message_received` may carry a different metadata label
 * (e.g. `weixin` vs `openclaw-weixin` from the key) — matching the session key avoids splitting
 * `trace_root` and breaks `msg_id` FIFO correlation.
 */
export function conversationCorrelationKey(params: {
  channelId?: string;
  conversationId?: string;
  sessionKey?: string;
}): string | undefined {
  const sk = params.sessionKey?.trim();
  const ch =
    (sk ? inferChannelFromSessionKey(sk) : undefined) ||
    (params.channelId?.trim() ? params.channelId.trim().toLowerCase() : undefined);
  const convRaw =
    (sk ? inferDirectPeerFromSessionKey(sk) : undefined)?.trim() ||
    params.conversationId?.trim() ||
    "";
  const conv = convRaw.trim().toLowerCase();
  if (!ch || !conv) {
    return undefined;
  }
  return `${ch}\n${conv}`;
}

export type TraceRootResolveArgs = {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  /** With conversationId, merges events that share a channel/chat but omit session_key on some hooks. */
  channelId?: string;
  conversationId?: string;
};

/** Per-session sampling + trace_root_id; sessionKey index for subagent merge. */
export class TraceState {
  private readonly sampledSessions = new Map<string, boolean>();
  private readonly traceRootBySession = new Map<string, string>();
  private readonly traceRootBySessionKey = new Map<string, string>();
  private readonly childToParentTrace = new Map<string, string>();
  /** Links agent runId to trace root when ctx.sessionId was missing on early hooks (OpenClaw quirk). */
  private readonly traceRootByRunId = new Map<string, string>();
  /** When hooks later omit sessionKey but include sessionId, reuse the key from an earlier event. */
  private readonly sessionKeyBySessionId = new Map<string, string>();
  /** Stable merge key for one user-visible chat when session_key / session_id disagree across hooks. */
  private readonly traceRootByConversation = new Map<string, string>();

  /**
   * FIFO of `msg_id` per conversation (channel+peer). `message_received` pushes; first `llm_input`
   * of a run shifts one id and binds it to `run_id` for tools / later LLM rounds.
   */
  private readonly pendingMsgQueueByConv = new Map<string, string[]>();
  private readonly msgIdByRunId = new Map<string, string>();
  /** When inbound had no correlation key, last `msg_id` is stored here for `llm_input` to pick up. */
  private orphanInboundMsgId: string | undefined;

  shouldRecord(sessionId: string | undefined, sessionKey: string | undefined, rateBps: number): boolean {
    if (!sessionId) {
      return true;
    }
    const cached = this.sampledSessions.get(sessionId);
    if (cached !== undefined) {
      return cached;
    }
    const key = sessionKey?.trim() || sessionId;
    const sampled = sampleDeterministic(key, rateBps);
    this.sampledSessions.set(sessionId, sampled);
    return sampled;
  }

  /** Call on every enqueue when raw hook fields are available. */
  rememberSessionKeyMapping(sessionId: string | undefined, sessionKey: string | undefined): void {
    const sid = sessionId?.trim();
    const sk = sessionKey?.trim();
    if (sid && sk) {
      this.sessionKeyBySessionId.set(sid, sk);
    }
  }

  effectiveSessionKey(sessionId: string | undefined, sessionKey: string | undefined): string | undefined {
    const sk = sessionKey?.trim();
    if (sk) {
      return sk;
    }
    const sid = sessionId?.trim();
    return sid ? this.sessionKeyBySessionId.get(sid) : undefined;
  }

  bindSessionKey(sessionKey: string, traceRootId: string): void {
    const sk = sessionKey.trim();
    if (sk) {
      this.traceRootBySessionKey.set(sk, traceRootId);
    }
  }

  /** Map agent run id → canonical trace root (last resolved wins; merges stream/llm ordering quirks). */
  bindRunToTraceRoot(runId: string | undefined, traceRootId: string): void {
    const r = runId?.trim();
    if (!r) {
      return;
    }
    this.traceRootByRunId.set(r, traceRootId);
  }

  /**
   * When `sessionId` appears after hooks that only had `sessionKey` (e.g. `message_received`),
   * attach this session to the same trace root so one channel turn stays one trace.
   */
  private linkSessionToRoot(root: string, sessionId: string | undefined): void {
    const sid = sessionId?.trim();
    if (!sid) {
      return;
    }
    const prev = this.traceRootBySession.get(sid);
    if (!prev || prev === root) {
      this.traceRootBySession.set(sid, root);
      return;
    }
    // Prefer the root already tied to sessionKey / child map (conversation-stable).
    this.traceRootBySession.set(sid, root);
  }

  /**
   * Allocate a new trace root id. Never use `runId` as the root UUID: `model_stream_context`
   * (cache tail) often runs before `llm_input` and would otherwise emit a second trace whose
   * root equals `runId` while `message_received` used a random root; `bindRunToTraceRoot` links
   * runs to roots separately.
   */
  private allocateNewRoot(sessionId: string | undefined): string {
    const root = randomUUID();
    const sid = sessionId?.trim();
    if (sid) {
      this.traceRootBySession.set(sid, root);
    }
    return root;
  }

  private conversationMapKey(channelId: string | undefined, conversationId: string | undefined): string | undefined {
    const ch = channelId?.trim().toLowerCase();
    const conv = conversationId?.trim().toLowerCase();
    if (!ch || !conv) {
      return undefined;
    }
    return `${ch}\n${conv}`;
  }

  private rememberConversation(
    channelId: string | undefined,
    conversationId: string | undefined,
    root: string,
  ): void {
    const k = this.conversationMapKey(channelId, conversationId);
    if (!k) {
      return;
    }
    this.traceRootByConversation.set(k, root);
  }

  resolveTraceRoot(args: TraceRootResolveArgs): string {
    const sk = args.sessionKey?.trim();
    const sessionId = args.sessionId;
    const runId = args.runId;

    const effectiveChannelId =
      inferChannelFromSessionKey(sk) ||
      (args.channelId?.trim() ? args.channelId.trim().toLowerCase() : undefined);
    const effectiveConversationId =
      inferDirectPeerFromSessionKey(sk)?.trim() || args.conversationId?.trim() || undefined;

    const convKey = this.conversationMapKey(effectiveChannelId, effectiveConversationId);
    if (convKey) {
      const fromConv = this.traceRootByConversation.get(convKey);
      if (fromConv) {
        if (sk) {
          this.bindSessionKey(sk, fromConv);
        }
        this.linkSessionToRoot(fromConv, sessionId);
        return fromConv;
      }
    }

    if (sk) {
      const fromChild = this.childToParentTrace.get(sk);
      if (fromChild) {
        this.linkSessionToRoot(fromChild, sessionId);
        this.bindSessionKey(sk, fromChild);
        this.rememberConversation(effectiveChannelId, effectiveConversationId, fromChild);
        return fromChild;
      }
      const fromKey = this.traceRootBySessionKey.get(sk);
      if (fromKey) {
        this.linkSessionToRoot(fromKey, sessionId);
        this.rememberConversation(effectiveChannelId, effectiveConversationId, fromKey);
        return fromKey;
      }
    }
    if (sessionId) {
      const fromSession = this.traceRootBySession.get(sessionId);
      if (fromSession) {
        if (sk) {
          this.bindSessionKey(sk, fromSession);
        }
        this.rememberConversation(effectiveChannelId, effectiveConversationId, fromSession);
        return fromSession;
      }
    }
    const rid = runId?.trim();
    if (rid) {
      const fromRun = this.traceRootByRunId.get(rid);
      if (fromRun) {
        if (sk) {
          this.bindSessionKey(sk, fromRun);
        }
        this.linkSessionToRoot(fromRun, sessionId);
        this.rememberConversation(effectiveChannelId, effectiveConversationId, fromRun);
        return fromRun;
      }
    }
    const root = this.allocateNewRoot(sessionId);
    if (sk) {
      this.bindSessionKey(sk, root);
    }
    this.rememberConversation(effectiveChannelId, effectiveConversationId, root);
    return root;
  }

  /** Parent trace for subagent: prefer requester sessionKey, else parent runId as ephemeral root. */
  parentTraceRootForSubagent(requesterSessionKey: string | undefined, parentRunId: string | undefined): string {
    const rsk = requesterSessionKey?.trim();
    if (rsk) {
      const tr = this.traceRootBySessionKey.get(rsk);
      if (tr) {
        return tr;
      }
    }
    return parentRunId?.trim() || randomUUID();
  }

  linkChildSessionKey(childSessionKey: string, parentTraceRootId: string): void {
    const ck = childSessionKey.trim();
    if (ck) {
      this.childToParentTrace.set(ck, parentTraceRootId);
    }
  }

  /** Call from `message_received` after allocating `msg_id`. */
  registerInboundMsgId(convKey: string | undefined, msgId: string): void {
    const id = msgId.trim();
    if (!id) {
      return;
    }
    if (convKey) {
      const q = this.pendingMsgQueueByConv.get(convKey) ?? [];
      q.push(id);
      this.pendingMsgQueueByConv.set(convKey, q);
      this.orphanInboundMsgId = undefined;
    } else {
      this.orphanInboundMsgId = id;
    }
  }

  /**
   * Resolve `msg_id` for any hook event. `llm_input` consumes one pending id (FIFO) for the
   * conversation and binds it to `run_id`.
   */
  resolveMsgIdForEvent(eventType: string, runId: string | undefined, convKey: string | undefined): string | undefined {
    const r = runId?.trim();
    if (r && this.msgIdByRunId.has(r)) {
      return this.msgIdByRunId.get(r);
    }
    if (eventType === "llm_input" && r) {
      let id: string | undefined;
      if (convKey) {
        const q = this.pendingMsgQueueByConv.get(convKey) ?? [];
        id = q.shift();
        this.pendingMsgQueueByConv.set(convKey, q);
      }
      if (!id) {
        id = this.orphanInboundMsgId;
      }
      if (id) {
        this.msgIdByRunId.set(r, id);
        this.orphanInboundMsgId = undefined;
      }
      return id;
    }
    if (convKey) {
      const head = this.pendingMsgQueueByConv.get(convKey)?.[0];
      if (head) {
        return head;
      }
    }
    return this.orphanInboundMsgId;
  }
}

function sampleDeterministic(key: string, rateBps: number): boolean {
  if (rateBps >= 10_000) {
    return true;
  }
  if (rateBps <= 0) {
    return false;
  }
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  const bucket = Math.abs(h) % 10_000;
  return bucket < rateBps;
}
