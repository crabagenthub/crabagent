import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDirForFile } from "./outbox.js";

const FILE_VERSION = 1 as const;

export type SubagentAnchorDiskRecord = {
  v: typeof FILE_VERSION;
  childSessionKey: string;
  parentSessionKey: string;
  parentChannelName?: string;
  updatedAtMs: number;
};

function anchorFilePath(rootDir: string, childSessionKey: string): string {
  const hash = createHash("sha256").update(childSessionKey, "utf8").digest("hex");
  return path.join(rootDir, "subagent-anchors", `${hash}.json`);
}

export function writeSubagentAnchorSnapshot(
  rootDir: string,
  childSessionKey: string,
  parentSessionKey: string,
  parentChannelName?: string,
): void {
  if (!rootDir.trim()) {
    return;
  }
  const child = childSessionKey.trim() || "unknown-session";
  const parent = parentSessionKey.trim();
  if (!parent) {
    return;
  }
  const fp = anchorFilePath(rootDir, child);
  ensureDirForFile(fp);
  const rec: SubagentAnchorDiskRecord = {
    v: FILE_VERSION,
    childSessionKey: child,
    parentSessionKey: parent,
    ...(parentChannelName?.trim() ? { parentChannelName: parentChannelName.trim() } : {}),
    updatedAtMs: Date.now(),
  };
  fs.writeFileSync(fp, JSON.stringify(rec), "utf8");
}

export function deleteSubagentAnchorSnapshot(rootDir: string, childSessionKey: string): void {
  if (!rootDir.trim()) {
    return;
  }
  const child = childSessionKey.trim() || "unknown-session";
  const fp = anchorFilePath(rootDir, child);
  try {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  } catch {
    // ignore
  }
}

function parseAnchorRecord(raw: string): SubagentAnchorDiskRecord | null {
  try {
    const v = JSON.parse(raw) as SubagentAnchorDiskRecord;
    if (
      !v ||
      v.v !== FILE_VERSION ||
      typeof v.childSessionKey !== "string" ||
      typeof v.parentSessionKey !== "string" ||
      !v.childSessionKey.trim() ||
      !v.parentSessionKey.trim()
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** 启动时恢复子会话 → 父会话键（进程重启后仍能对齐 parent_thread_id 与父 trace 锚点）。 */
export function loadAllSubagentAnchorSnapshots(rootDir: string): SubagentAnchorDiskRecord[] {
  const dir = path.join(rootDir, "subagent-anchors");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const names = fs.readdirSync(dir);
  const out: SubagentAnchorDiskRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const fp = path.join(dir, name);
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const rec = parseAnchorRecord(raw);
      if (rec) {
        out.push(rec);
      }
    } catch {
      // skip
    }
  }
  return out;
}
