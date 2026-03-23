import { randomUUID } from "node:crypto";

/** Per-session sampling + trace_root_id; sessionKey index for subagent merge. */
export class TraceState {
  private readonly sampledSessions = new Map<string, boolean>();
  private readonly traceRootBySession = new Map<string, string>();
  private readonly traceRootBySessionKey = new Map<string, string>();
  private readonly childToParentTrace = new Map<string, string>();
  /** Links agent runId to trace root when ctx.sessionId was missing on early hooks (OpenClaw quirk). */
  private readonly traceRootByRunId = new Map<string, string>();

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

  bindSessionKey(sessionKey: string, traceRootId: string): void {
    const sk = sessionKey.trim();
    if (sk) {
      this.traceRootBySessionKey.set(sk, traceRootId);
    }
  }

  /**
   * Remember which trace_root_id belongs to this run. Upgrades ephemeral `runId === trace_root_id`
   * to the real session root once session_start / session-scoped hooks have resolved it.
   */
  bindRunToTraceRoot(runId: string | undefined, traceRootId: string): void {
    const r = runId?.trim();
    if (!r) {
      return;
    }
    const prev = this.traceRootByRunId.get(r);
    if (prev === undefined) {
      this.traceRootByRunId.set(r, traceRootId);
      return;
    }
    if (prev === r && traceRootId !== r) {
      this.traceRootByRunId.set(r, traceRootId);
    }
  }

  getOrCreateTraceRoot(sessionId: string | undefined, runId: string | undefined): string {
    if (!sessionId) {
      return runId?.trim() || randomUUID();
    }
    const existing = this.traceRootBySession.get(sessionId);
    if (existing) {
      return existing;
    }
    const root = runId?.trim() || randomUUID();
    this.traceRootBySession.set(sessionId, root);
    return root;
  }

  resolveTraceRoot(
    sessionKey: string | undefined,
    sessionId: string | undefined,
    runId: string | undefined,
  ): string {
    const sk = sessionKey?.trim();
    if (sk) {
      const fromChild = this.childToParentTrace.get(sk);
      if (fromChild) {
        return fromChild;
      }
      const fromKey = this.traceRootBySessionKey.get(sk);
      if (fromKey) {
        return fromKey;
      }
    }
    if (sessionId) {
      const fromSession = this.traceRootBySession.get(sessionId);
      if (fromSession) {
        return fromSession;
      }
    }
    const rid = runId?.trim();
    if (rid) {
      const fromRun = this.traceRootByRunId.get(rid);
      if (fromRun) {
        return fromRun;
      }
    }
    return this.getOrCreateTraceRoot(sessionId, runId);
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
