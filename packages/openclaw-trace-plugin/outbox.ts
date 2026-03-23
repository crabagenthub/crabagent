import fs from "node:fs";
import path from "node:path";

export function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Read all JSON lines and clear the file. Malformed lines are skipped. */
export function drainOutboxFile(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    fs.unlinkSync(filePath);
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object") {
        out.push(v as Record<string, unknown>);
      }
    } catch {
      // skip
    }
  }
  return out;
}

export function appendOutboxFile(filePath: string, events: Record<string, unknown>[]): void {
  if (events.length === 0) {
    return;
  }
  ensureDirForFile(filePath);
  const lines = events.map((e) => `${JSON.stringify(e)}\n`).join("");
  fs.appendFileSync(filePath, lines, "utf8");
}
