import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import { queryConversationExecutionGraph, queryTraceExecutionGraph } from "./execution-graph-query.js";
import { queryTraceRecords } from "./trace-records-query.js";

describe("queryConversationExecutionGraph", () => {
  it("trace headers, span edges, and cross_trace when parent_turn_id links traces", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-execg-${Date.now()}.db`);
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
         VALUES ('p1', ?, 'default', 'openclaw', 'external', 'p1', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(main, t0);
      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('c1', ?, 'default', 'openclaw', 'subagent', 'c1', '{}', '{}',
          '{"parent_turn_id":"p1"}', ?, 1, 'test')`,
      ).run(sub, t0 + 1);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('sp-p-llm', 'p1', NULL, 'llm', 'llm', 'gpt', '{"total_tokens":10}', 1, 1, ?)`,
      ).run(t0);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('sp-c-llm', 'c1', NULL, 'llm', 'llm', 'gpt', '{"total_tokens":5}', 1, 1, ?)`,
      ).run(t0 + 2);

      const g = queryConversationExecutionGraph(db, main, { maxNodes: 500 });
      const ids = new Set(g.nodes.map((n) => n.id));
      const thP1 = g.nodes.find((n) => n.id === "th:p1");
      assert.ok(thP1);
      assert.equal(thP1!.node_role, "trace");
      assert.equal(thP1!.total_tokens, 10);
      assert.ok(thP1!.duration_ms == null || thP1!.duration_ms >= 0);
      const traceRows = queryTraceRecords(db, { limit: 20, offset: 0, order: "desc" });
      const trP1 = traceRows.find((r) => String(r.trace_id) === "p1");
      assert.ok(trP1);
      assert.equal(thP1!.total_tokens, Number(trP1!.total_tokens));
      assert.ok(ids.has("th:p1"));
      assert.ok(ids.has("th:c1"));
      assert.ok(ids.has("sp-p-llm"));
      assert.ok(ids.has("sp-c-llm"));
      const xt = g.edges.filter((e) => e.edge_kind === "cross_trace");
      assert.equal(xt.length, 1);
      assert.equal(xt[0]!.source, "sp-p-llm");
      assert.equal(xt[0]!.target, "sp-c-llm");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("queryTraceExecutionGraph includes parent/child traces and cross_trace for focused trace", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-execg-trace-${Date.now()}.db`);
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
         VALUES ('p1', ?, 'default', 'openclaw', 'external', 'p1', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(main, t0);
      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('c1', ?, 'default', 'openclaw', 'subagent', 'c1', '{}', '{}',
          '{"parent_turn_id":"p1"}', ?, 1, 'test')`,
      ).run(main, t0 + 1);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('sp-p-llm', 'p1', NULL, 'llm', 'llm', 'gpt', '{"total_tokens":10}', 1, 1, ?)`,
      ).run(t0);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('sp-c-llm', 'c1', NULL, 'llm', 'llm', 'gpt', '{"total_tokens":5}', 1, 1, ?)`,
      ).run(t0 + 2);

      const g = queryTraceExecutionGraph(db, "p1", { maxNodes: 500 });
      assert.ok(g.nodes.some((n) => n.id === "th:p1"));
      assert.ok(g.nodes.some((n) => n.id === "th:c1"));
      const xt = g.edges.filter((e) => e.edge_kind === "cross_trace");
      assert.equal(xt.length, 1);
      assert.equal(xt[0]!.source, "sp-p-llm");
      assert.equal(xt[0]!.target, "sp-c-llm");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("tool_execution_mode on trace metadata → LLM/tool edges + node fields", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-execg-tem-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    try {
      const main = "t-tem";
      const t0 = Date.now();

      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', ?, ?)`,
      ).run(main, t0, t0);

      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('tx1', ?, 'default', 'openclaw', 'external', 'tx1', '{}', '{}',
          '{"tool_execution_mode":"parallel"}', ?, 1, 'test')`,
      ).run(main, t0);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('llm1', 'tx1', NULL, 'gpt', 'llm', 'gpt', '{"total_tokens":3}', 1, 1, ?)`,
      ).run(t0);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('t1', 'tx1', 'llm1', 'read', 'tool', NULL, '{}', 1, 2, ?)`,
      ).run(t0 + 1);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, is_complete, sort_index, start_time_ms)
         VALUES ('t2', 'tx1', 'llm1', 'grep', 'tool', NULL, '{}', 1, 3, ?)`,
      ).run(t0 + 2);

      const g = queryConversationExecutionGraph(db, main, { maxNodes: 500 });
      const th = g.nodes.find((n) => n.id === "th:tx1");
      assert.equal(th?.tool_execution_mode, "parallel");
      const llm = g.nodes.find((n) => n.id === "llm1");
      assert.equal(llm?.kind, "LLM");
      assert.equal(llm?.tool_execution_mode, "parallel");
      const fan = g.edges.filter((e) => e.edge_kind === "span_parent_parallel");
      assert.equal(fan.length, 2);
      assert.ok(fan.every((e) => e.tool_batch_mode === "parallel"));
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("memory 工具无 semantic_kind 时标为 MEMORY，LLM→memory 边为 span_parent_memory", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-execg-mem-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    try {
      const main = "t-mem";
      const t0 = Date.now();

      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', ?, ?)`,
      ).run(main, t0, t0);

      db.prepare(
        `INSERT INTO opik_traces (trace_id, thread_id, workspace_name, project_name, trace_type, name,
          input_json, output_json, metadata_json, created_at_ms, is_complete, created_from)
         VALUES ('tm1', ?, 'default', 'openclaw', 'external', 'tm1', '{}', '{}', '{}', ?, 1, 'test')`,
      ).run(main, t0);

      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, metadata_json, is_complete, sort_index, start_time_ms)
         VALUES ('llm-m', 'tm1', NULL, 'gpt', 'llm', 'gpt', '{"total_tokens":1}', NULL, 1, 1, ?)`,
      ).run(t0);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, parent_span_id, name, span_type, model, usage_json, metadata_json, is_complete, sort_index, start_time_ms)
         VALUES ('mem-m', 'tm1', 'llm-m', 'memory_recall', 'tool', NULL, '{}', NULL, 1, 2, ?)`,
      ).run(t0 + 1);

      const g = queryConversationExecutionGraph(db, main, { maxNodes: 500 });
      const mem = g.nodes.find((n) => n.id === "mem-m");
      assert.equal(mem?.kind, "MEMORY");
      const eg = g.edges.find((e) => e.source === "llm-m" && e.target === "mem-m");
      assert.equal(eg?.edge_kind, "span_parent_memory");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
