#!/usr/bin/env node
/**
 * 清空 Collector SQLite 中各业务表的全部行（保留库文件与表结构）。
 * 建议先停止 Collector，避免与其它写入争用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 删除顺序：子表 → 父表；不存在的表会跳过。 */
const TABLES_IN_DELETE_ORDER = [
  "opik_raw_ingest",
  "opik_trace_feedback",
  "opik_attachments",
  "opik_spans",
  "opik_traces",
  "opik_threads",
  "ext_raw_ingest",
  "ext_attachments",
  "ext_spans",
  "ext_traces",
  "ext_threads",
  "evaluations",
  "spans",
  "traces",
  "daily_session_aggregates",
  "daily_aggregates",
  "optimizations",
  "generations",
  "sessions",
  "channel_peers",
  "agents",
  "otel_spans",
  "events",
];

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const canonical = path.join(repoRoot, "services", "collector", "data", "crabagent.db");
const legacyAtRepoRoot = path.join(repoRoot, "data", "crabagent.db");

/**
 * @param {string} dbPath
 */
function clearDbFile(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log("skip (no file):", dbPath);
    return;
  }
  const db = new Database(dbPath);
  try {
    db.pragma("foreign_keys = OFF");
    const existing = new Set(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all()
        .map((/** @type {{ name: string }} */ r) => r.name),
    );
    for (const t of TABLES_IN_DELETE_ORDER) {
      if (!existing.has(t)) {
        continue;
      }
      const n = db.prepare(`DELETE FROM "${t.replace(/"/g, '""')}"`).run().changes;
      console.log(`  ${t}: deleted ${n} row(s)`);
    }
    db.pragma("foreign_keys = ON");
    db.prepare("VACUUM").run();
    console.log("cleared:", dbPath);
  } finally {
    db.close();
  }
}

console.log("Clearing collector business tables (stop collector first)…");
clearDbFile(canonical);
clearDbFile(legacyAtRepoRoot);
console.log("Done.");
