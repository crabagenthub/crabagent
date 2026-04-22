import net from "node:net";

export type ProbeResult = {
  ok: boolean;
  checked_at_ms: number;
  latency_ms: number;
  error?: string;
};

function nowMs(): number {
  return Date.now();
}

function safeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  return String(err);
}

export async function probeTcpConnect(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  const start = nowMs();
  return await new Promise<ProbeResult>((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean, error?: string) => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve({
        ok,
        checked_at_ms: nowMs(),
        latency_ms: Math.max(0, nowMs() - start),
        error,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, `timeout after ${timeoutMs}ms`));
    socket.once("error", (e) => done(false, safeError(e)));
  });
}

export async function probeHttp(url: string, timeoutMs: number): Promise<ProbeResult> {
  const start = nowMs();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    const ok = res.status >= 200 && res.status < 500;
    return {
      ok,
      checked_at_ms: nowMs(),
      latency_ms: Math.max(0, nowMs() - start),
      error: ok ? undefined : `http_status=${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      checked_at_ms: nowMs(),
      latency_ms: Math.max(0, nowMs() - start),
      error: safeError(e),
    };
  } finally {
    clearTimeout(tid);
  }
}

