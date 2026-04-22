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
          input_json, output_json, metadata_json, total_cost, created_at_ms, is_complete, created_from)
         VALUES ('r0', ?, 'default', 'openclaw', 'external', 'r0', '{}', '{}', '{}', 0.01, ?, 1, 'test')`,
      ).run(main, t0);
      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('c1', ?, 'default', 'openclaw', 'subagent', 'c1', '{}', '{}',
          '{"parent_turn_id":"r0"}', ?, 1, 'test')`,
      ).run(sub, t0 + 1);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, provider, usage_json, metadata_json, is_complete, sort_index)
         VALUES ('sp-r0-llm', 'r0', NULL, 'llm', 'llm', 'gpt-4o', 'openai', '{"total_tokens":120}', '{}', 1, 1)`,
      ).run();
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, metadata_json, is_complete, sort_index)
         VALUES ('sp-c1-tool', 'c1', NULL, 'my_skill', 'tool', '{"semantic_kind":"skill","skill_id":"sk1","skill_name":"My Skill"}', 1, 2)`,
      ).run();
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, is_complete, sort_index)
         VALUES ('sp-c1-llm', 'c1', NULL, 'llm', 'llm', 'claude-3', 1, 1)`,
      ).run();

      const g = queryThreadTraceGraph(db, main);
      assert.equal(g.truncated, false);
      assert.equal(g.nodes.length, 2);
      assert.equal(g.edges.length, 1);
      assert.equal(g.edges[0]!.source, "r0");
      assert.equal(g.edges[0]!.target, "c1");
      assert.equal(g.edges[0]!.trace_type, "subagent");
      const n0 = g.nodes.find((n) => n.id === "r0");
      const n1 = g.nodes.find((n) => n.id === "c1");
      assert.ok(n0);
      assert.ok(n1);
      assert.equal(n0!.total_tokens, 120);
      assert.equal(n0!.primary_model, "gpt-4o");
      assert.equal(n0!.primary_provider, "openai");
      assert.deepEqual(n0!.llm_models, ["gpt-4o"]);
      assert.equal(n0!.tool_call_count, 0);
      assert.equal(n0!.total_cost, 0.01);
      assert.equal(n1!.primary_model, "claude-3");
      assert.equal(n1!.skills.length, 1);
      assert.equal(n1!.skills[0]!.name, "My Skill");
      assert.equal(n1!.skills[0]!.skill_id, "sk1");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
