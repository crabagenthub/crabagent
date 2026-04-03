/**
 * Thread turn tree + subagent cross-thread graft.
 * 运行：`pnpm --filter @crabagent/collector exec tsx --test src/thread-turns-query.test.ts`
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyOpikBatch } from "./opik-batch-ingest.js";
import { openDatabase } from "./db.js";
import { queryThreadTurnsTree } from "./thread-turns-query.js";

describe("queryThreadTurnsTree", () => {
  it("grafts subagent thread under parent anchor turn", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-thread-turns-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const now = Date.now();
      const ws = "default";
      const proj = "openclaw";
      const parentThread = "agent:test:parent-session";
      const childThread = "agent:test:subagent:child-1";
      const parentTurnId = "turn-parent-external-001";
      const childTurnId = "turn-child-sub-001";
      const traceParent = "trace-parent-001";
      const traceChild = "trace-child-001";

      const batch = {
        threads: [
          {
            thread_id: parentThread,
            workspace_name: ws,
            project_name: proj,
            first_seen_ms: now,
            last_seen_ms: now,
            metadata: {},
          },
          {
            thread_id: childThread,
            workspace_name: ws,
            project_name: proj,
            first_seen_ms: now + 1,
            last_seen_ms: now + 1,
            metadata: {},
          },
        ],
        traces: [
          {
            trace_id: traceParent,
            thread_id: parentThread,
            workspace_name: ws,
            project_name: proj,
            name: "parent_llm",
            created_at_ms: now,
            is_complete: 1,
            success: 1,
            input: {
              list_input_preview: "User asked something",
              user_turn: {
                message_received: { content: "User asked something", from: "feishu" },
              },
            },
            metadata: {
              turn_id: parentTurnId,
              run_kind: "external",
              parent_turn_id: null,
            },
          },
          {
            trace_id: traceChild,
            thread_id: childThread,
            workspace_name: ws,
            project_name: proj,
            name: "subagent_work",
            created_at_ms: now + 100,
            is_complete: 1,
            success: 1,
            input: {},
            metadata: {
              turn_id: childTurnId,
              run_kind: "subagent",
              parent_turn_id: null,
              anchor_parent_thread_id: parentThread,
              anchor_parent_turn_id: parentTurnId,
            },
          },
        ],
        spans: [
          {
            span_id: "span-p1",
            trace_id: traceParent,
            name: "llm",
            type: "llm",
            start_time_ms: now,
            is_complete: 1,
          },
          {
            span_id: "span-c1",
            trace_id: traceChild,
            name: "llm",
            type: "llm",
            start_time_ms: now + 100,
            is_complete: 1,
          },
        ],
      };

      const r = applyOpikBatch(db, batch);
      assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));

      const tree = queryThreadTurnsTree(db, childThread);
      assert.equal(tree.items.length, 1, "should have one grafted root");
      const root = tree.items[0]!;
      assert.equal(root.turn_id, parentTurnId);
      assert.equal(root.run_kind, "external");
      assert.equal(root.children.length, 1);
      assert.equal(root.children[0]!.turn_id, childTurnId);
      assert.equal(root.children[0]!.run_kind, "subagent");
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("subagent-only thread without anchor still has empty roots (legacy)", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-thread-turns-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const now = Date.now();
      const ws = "default";
      const proj = "openclaw";
      const childThread = "agent:test:subagent:orphan";
      const traceChild = "trace-orphan-001";

      applyOpikBatch(db, {
        threads: [
          {
            thread_id: childThread,
            workspace_name: ws,
            project_name: proj,
            first_seen_ms: now,
            last_seen_ms: now,
            metadata: {},
          },
        ],
        traces: [
          {
            trace_id: traceChild,
            thread_id: childThread,
            workspace_name: ws,
            project_name: proj,
            name: "bare",
            created_at_ms: now,
            is_complete: 1,
            success: 1,
            input: {},
            metadata: {
              turn_id: "turn-sys-1",
              run_kind: "system",
              parent_turn_id: null,
            },
          },
        ],
        spans: [
          {
            span_id: "span-o1",
            trace_id: traceChild,
            name: "turn",
            type: "general",
            start_time_ms: now,
            is_complete: 1,
          },
        ],
      });

      const tree = queryThreadTurnsTree(db, childThread);
      assert.equal(tree.items.length, 0);
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });
});
