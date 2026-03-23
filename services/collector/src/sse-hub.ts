/** In-memory pub/sub for trace_root_id (MVP; lost on process restart). */

type Listener = (payload: string) => void;

const channels = new Map<string, Set<Listener>>();

export function sseSubscribe(traceRootId: string, listener: Listener): () => void {
  let set = channels.get(traceRootId);
  if (!set) {
    set = new Set();
    channels.set(traceRootId, set);
  }
  set.add(listener);
  return () => {
    const s = channels.get(traceRootId);
    if (!s) {
      return;
    }
    s.delete(listener);
    if (s.size === 0) {
      channels.delete(traceRootId);
    }
  };
}

export function ssePublish(traceRootId: string, payload: unknown): void {
  const set = channels.get(traceRootId);
  if (!set?.size) {
    return;
  }
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const fn of set) {
    try {
      fn(line);
    } catch {
      // drop broken subscriber
    }
  }
}
