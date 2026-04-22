import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import { queryThreadTokenBreakdown } from "./thread-token-breakdown-query.js";

describe("queryThreadTokenBreakdown", () => {
  it("sums LLM span usage_json for thread key", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-tokbd-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    try {
      const main = "t-main";
      const t0 = Date.now();

      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', ?, ?)`,
      ).run(main, t0, t0);

      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('tr1', ?, 'default', 'openclaw', 'external', 'x', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(main, t0);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('llm1', 'tr1', NULL, 'llm', 'llm', 'gpt', '{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}', 1, 1, ?)`,
      ).run(t0);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('llm2', 'tr1', NULL, 'llm', 'llm', 'gpt', '{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}', 1, 2, ?)`,
      ).run(t0 + 1);

      const b = queryThreadTokenBreakdown(db, main);
      assert.equal(b.thread_key, main);
      assert.equal(b.prompt_tokens, 110);
      assert.equal(b.completion_tokens, 55);
      assert.equal(b.total_tokens, 165);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
