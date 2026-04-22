#!/usr/bin/env node
/**
 * Dump opik_traces / opik_spans / opik_raw_ingest rows matching a needle (trace_id, thread_id, substring in JSON).
 *
 *   CRABAGENT_DB_PATH=/path/to/crabagent.db node services/collector/scripts/dump-trace-events.mjs <needle>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.join(here, "..");
const defaultDb = path.join(collectorRoot, "data", "crabagent.db");
const dbPath = process.env.CRABAGENT_DB_PATH?.trim() || defaultDb;

const needle = (process.argv[2] ?? "").trim();
if (!needle) {
  console.error("Usage: dump-trace-events.mjs <needle>");
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${path.resolve(dbPath)}`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true });
const n = `%${needle}%`;

console.log("--- opik_traces ---");
console.log(
  db
    .prepare(
      `SELECT trace_id, thread_id, name, created_at_ms, is_complete FROM opik_traces
       WHERE trace_id LIKE @n OR thread_id LIKE @n OR name LIKE @n
          OR input_json LIKE @n OR metadata_json LIKE @n`,
    )
    .all({ n }),
);

console.log("--- opik_spans ---");
console.log(
  db
    .prepare(
      `SELECT span_id, trace_id, name, span_type FROM opik_spans
       WHERE trace_id LIKE @n OR span_id LIKE @n OR name LIKE @n`,
    )
    .all({ n }),
);

console.log("--- opik_raw_ingest (last 20 matches) ---");
console.log(
  db
    .prepare(
      `SELECT id, route, received_at_ms, substr(body_json,1,200) AS body_preview FROM opik_raw_ingest
       WHERE body_json LIKE @n ORDER BY id DESC LIMIT 20`,
    )
    .all({ n }),
);

db.close();
