import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import { queryThreadRecords } from "./thread-records-query.js";

describe("queryThreadRecords total_tokens", () => {
  it("sums llm span usage_json input + output across traces in thread (not total)", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-thrlist-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    try {
      const tid = "agent:email:thread-a";
      const t0 = Date.now();

      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', ?, ?)`,
      ).run(tid, t0, t0);

      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('tr1', ?, 'default', 'openclaw', 'external', 'x', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(tid, t0);
      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('tr2', ?, 'default', 'openclaw', 'external', 'y', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(tid, t0 + 1);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, usage_preview, is_complete, sort_index, start_time_ms)
         VALUES ('llm1', 'tr1', NULL, 'llm', 'llm', 'gpt', '{"input":80,"output":20,"cacheRead":0,"total":100}', NULL, 1, 1, ?)`,
      ).run(t0);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, usage_preview, is_complete, sort_index, start_time_ms)
         VALUES ('llm2', 'tr2', NULL, 'llm', 'llm', 'gpt', '{"input":40,"output":10,"cacheRead":0,"total":50}', NULL, 1, 1, ?)`,
      ).run(t0);

      const rows = queryThreadRecords(db, { limit: 10, offset: 0, order: "desc" });
      const row = rows.find((r) => String(r.thread_id) === tid);
      assert.ok(row);
      assert.equal(row.total_tokens, 150);

      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('tr3', ?, 'default', 'openclaw', 'external', 'z', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(tid, t0 + 2);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, usage_preview, is_complete, sort_index, start_time_ms)
         VALUES ('llm3', 'tr3', NULL, 'llm', 'llm', 'gpt', '{"input":1,"output":2,"total":99999}', NULL, 1, 1, ?)`,
      ).run(t0);
      const rows2 = queryThreadRecords(db, { limit: 10, offset: 0, order: "desc" });
      const row2 = rows2.find((r) => String(r.thread_id) === tid);
      assert.ok(row2);
      assert.equal(row2.total_tokens, 153, "ignores total field; uses input+output only");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
