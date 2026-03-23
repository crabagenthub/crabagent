import { createHash } from "node:crypto";

/**
 * OpenClaw may invoke `message_received` more than once for the same inbound message
 * (e.g. plugin hook + internal bridge). Drop duplicates within a short TTL so traces
 * show one row per user send.
 */
export class MessageReceivedDeduper {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 20_000) {
    this.ttlMs = ttlMs;
  }

  private prune(now: number): void {
    for (const [k, exp] of this.seen) {
      if (exp <= now) {
        this.seen.delete(k);
      }
    }
    while (this.seen.size > 4000) {
      const first = this.seen.keys().next().value;
      if (first === undefined) {
        break;
      }
      this.seen.delete(first);
    }
  }

  /**
   * @returns true if this is a duplicate and should be skipped.
   */
  isDuplicate(params: {
    now: number;
    sessionKey?: string;
    sessionId?: string;
    from: string;
    content: string;
    timestamp?: number;
    messageId?: string;
  }): boolean {
    const key = fingerprintKey(params, params.now);
    this.prune(params.now);
    const exp = this.seen.get(key);
    if (exp !== undefined && exp > params.now) {
      return true;
    }
    this.seen.set(key, params.now + this.ttlMs);
    return false;
  }
}

function fingerprintKey(
  params: {
    sessionKey?: string;
    sessionId?: string;
    from: string;
    content: string;
    timestamp?: number;
    messageId?: string;
  },
  nowMs: number,
): string {
  const scope = (params.sessionKey ?? params.sessionId ?? "").trim();
  const mid = params.messageId?.trim();
  if (mid) {
    return `id:${scope}:${mid}`;
  }
  const from = String(params.from ?? "");
  const content = String(params.content ?? "");
  const h = createHash("sha256").update(`${scope}\0${from}\0${content}`).digest("hex").slice(0, 24);
  const ts =
    typeof params.timestamp === "number" && Number.isFinite(params.timestamp) ? params.timestamp : nowMs;
  const bucket = Math.floor(ts / 1000);
  return `body:${h}:${bucket}`;
}
