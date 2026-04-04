import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import { queryThreadTraceGraph } from "./trace-graph-query.js";

describe("queryThreadTraceGraph", () => {
  it("metadata.parent_turn_id → edges；合并子 thread 内 traces", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-tg-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    try {
      const main = "t-main";
      const sub = "t-sub";
      const t0 = Date.now();

      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', ?, ?)`,
      ).run(main, t0, t0);
      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, parent_thread_id, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'subagent', ?, ?, ?)`,
      ).run(sub, main, t0, t0);

      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('r0', ?, 'default', 'openclaw', 'external', 'r0', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(main, t0);
      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('c1', ?, 'default', 'openclaw', 'subagent', 'c1', '{}', '{}',
          '{"parent_turn_id":"r0"}', ?, 1, 'test')`,
      ).run(sub, t0 + 1);

      const g = queryThreadTraceGraph(db, main);
      assert.equal(g.nodes.length, 2);
      assert.equal(g.edges.length, 1);
      assert.equal(g.edges[0]!.source, "r0");
      assert.equal(g.edges[0]!.target, "c1");
      assert.equal(g.edges[0]!.trace_type, "subagent");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
