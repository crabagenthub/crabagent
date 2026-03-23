import fs from "node:fs";
import path from "node:path";

/**
 * Poll a growing JSONL file from EOF on start (no backlog), emit parsed objects.
 */
export function startCacheTraceTail(params: {
  filePath: string;
  intervalMs: number;
  onLine: (obj: Record<string, unknown>) => void;
  shouldStop: () => boolean;
}): () => void {
  let offset = 0;
  if (fs.existsSync(params.filePath)) {
    offset = fs.statSync(params.filePath).size;
  }

  const tick = () => {
    if (params.shouldStop()) {
      return;
    }
    const fp = params.filePath;
    if (!fs.existsSync(fp)) {
      return;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(fp);
    } catch {
      return;
    }
    if (st.size <= offset) {
      return;
    }
    const len = st.size - offset;
    const buf = Buffer.alloc(len);
    let fd: number | undefined;
    try {
      fd = fs.openSync(fp, "r");
      fs.readSync(fd, buf, 0, len, offset);
    } catch {
      return;
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
    offset = st.size;
    const chunk = buf.toString("utf8");
    for (const line of chunk.split("\n")) {
      const t = line.trim();
      if (!t) {
        continue;
      }
      try {
        params.onLine(JSON.parse(t) as Record<string, unknown>);
      } catch {
        // skip non-json
      }
    }
  };

  const iv = setInterval(tick, params.intervalMs);
  tick();
  return () => clearInterval(iv);
}

export function defaultCacheTracePath(stateDir: string): string {
  return path.join(stateDir, "logs", "cache-trace.jsonl");
}
