import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDirForFile } from "./outbox.js";

const FILE_VERSION = 1 as const;

export type PendingDiskRecord = {
  v: typeof FILE_VERSION;
  sessionKey: string;
  payload: Record<string, unknown>;
  updatedAtMs: number;
};

function pendingFilePath(rootDir: string, sessionKey: string): string {
  const hash = createHash("sha256").update(sessionKey, "utf8").digest("hex");
  return path.join(rootDir, "pending", `${hash}.json`);
}

/** 将某 session 的 pending 快照落盘（网关崩溃或未触发 agent_end 时可恢复）。 */
export function writePendingSnapshot(rootDir: string, sessionKey: string, payload: Record<string, unknown>): void {
  if (!rootDir.trim()) {
    return;
  }
  const sk = sessionKey.trim() || "unknown-session";
  const filePath = pendingFilePath(rootDir, sk);
  ensureDirForFile(filePath);
  const rec: PendingDiskRecord = {
    v: FILE_VERSION,
    sessionKey: sk,
    payload,
    updatedAtMs: Date.now(),
  };
  fs.writeFileSync(filePath, JSON.stringify(rec), "utf8");
}

export function deletePendingSnapshot(rootDir: string, sessionKey: string): void {
  if (!rootDir.trim()) {
    return;
  }
  const sk = sessionKey.trim() || "unknown-session";
  const filePath = pendingFilePath(rootDir, sk);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

function parseRecord(raw: string): PendingDiskRecord | null {
  try {
    const v = JSON.parse(raw) as PendingDiskRecord;
    if (!v || v.v !== FILE_VERSION || typeof v.sessionKey !== "string" || !v.payload || typeof v.payload !== "object") {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** 启动时加载所有未消费的 pending 文件。 */
export function loadAllPendingSnapshots(rootDir: string): PendingDiskRecord[] {
  const pendingDir = path.join(rootDir, "pending");
  if (!fs.existsSync(pendingDir)) {
    return [];
  }
  const names = fs.readdirSync(pendingDir);
  const out: PendingDiskRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const fp = path.join(pendingDir, name);
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const rec = parseRecord(raw);
      if (rec) {
        out.push(rec);
      }
    } catch {
      // skip
    }
  }
  return out;
}
