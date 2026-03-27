import fs from "node:fs";
import path from "node:path";
import type { OpikBatchPayload } from "./opik-types.js";

export function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 每行一个 `OpikBatchPayload` JSON。 */
export function drainOutboxFile(filePath: string): OpikBatchPayload[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    fs.unlinkSync(filePath);
  } catch {
    return [];
  }
  const out: OpikBatchPayload[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object") {
        out.push(v as OpikBatchPayload);
      }
    } catch {
      // skip
    }
  }
  return out;
}

export function appendOutboxFile(filePath: string, batches: OpikBatchPayload[]): void {
  if (batches.length === 0) {
    return;
  }
  ensureDirForFile(filePath);
  const lines = batches.map((e) => `${JSON.stringify(e)}\n`).join("");
  fs.appendFileSync(filePath, lines, "utf8");
}
