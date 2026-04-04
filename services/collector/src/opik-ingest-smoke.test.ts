/**
 * 染色冒烟：不依赖 OpenClaw，仅验证 Collector 的 applyOpikBatch → SQLite 是否可查到标记。
 * 运行：`pnpm --filter @crabagent/collector exec tsx --test src/opik-ingest-smoke.test.ts`
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyOpikBatch } from "./opik-batch-ingest.js";
import { openDatabase } from "./db.js";

/** 在网关/插件里也可写同一字符串，便于全文搜索染色数据。 */
const CRABAGENT_SMOKE_INGEST_MARKER = "crabagent_smoke_ingest_v1";

describe("Collector opik ingest（染色数据）", () => {
  it("POST 体等价的 batch 落库后 metadata 含 crabagent_smoke_ingest_v1", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ingest-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const db = openDatabase(dbPath);
    try {
      const traceId = `smoke-trace-${Date.now()}`;
      const threadId = "smoke-thread-feishu-weather";
      const now = Date.now();
      const body = {
        threads: [
          {
            thread_id: threadId,
            workspace_name: "default",
            project_name: "openclaw",
            first_seen_ms: now,
            last_seen_ms: now,
            metadata: { [CRABAGENT_SMOKE_INGEST_MARKER]: true, scenario: "collector_only" },
          },
        ],
        traces: [
          {
            trace_id: traceId,
            thread_id: threadId,
            workspace_name: "default",
            project_name: "openclaw",
            name: "smoke-weather-query",
            created_at_ms: now,
            is_complete: 1,
            success: 1,
            metadata: {
              [CRABAGENT_SMOKE_INGEST_MARKER]: true,
              scenario: "hangzhou_weather_stub",
            },
          },
        ],
        spans: [
          {
            span_id: `smoke-span-${now}`,
            trace_id: traceId,
            name: "llm",
            type: "llm",
            start_time_ms: now,
            is_complete: 1,
            metadata: { [CRABAGENT_SMOKE_INGEST_MARKER]: true },
            usage: { total_tokens: 1 },
          },
        ],
      };

      const r = applyOpikBatch(db, body);
      assert.equal(r.skipped.length, 0, `unexpected skip: ${JSON.stringify(r.skipped)}`);
      assert.ok(r.accepted.traces >= 1);

      const row = db
        .prepare("SELECT metadata_json FROM opik_traces WHERE trace_id = ?")
        .get(traceId) as { metadata_json: string } | undefined;
      assert.ok(row?.metadata_json, "trace row missing");
      assert.ok(
        row.metadata_json.includes(CRABAGENT_SMOKE_INGEST_MARKER),
        `metadata should contain ${CRABAGENT_SMOKE_INGEST_MARKER}: ${row.metadata_json}`,
      );
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("后续仅更新 output 且未带 is_complete 时，不将已完成的 trace 打回 running", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ingest-complete-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
    const db = openDatabase(dbPath);
    try {
      const traceId = `smoke-trace-complete-${Date.now()}`;
      const threadId = "smoke-thread-complete";
      const now = Date.now();

      assert.equal(
        applyOpikBatch(db, {
          traces: [
            {
              trace_id: traceId,
              thread_id: threadId,
              workspace_name: "default",
              project_name: "openclaw",
              name: "turn-1",
              created_at_ms: now,
              is_complete: 1,
              success: 1,
              output: { text: "done" },
            },
          ],
        }).skipped.length,
        0,
      );

      assert.equal(
        applyOpikBatch(db, {
          traces: [
            {
              trace_id: traceId,
              thread_id: threadId,
              workspace_name: "default",
              project_name: "openclaw",
              name: "turn-1",
              created_at_ms: now,
              metadata: { patch: true },
            },
          ],
        }).skipped.length,
        0,
      );

      const row = db.prepare("SELECT is_complete FROM opik_traces WHERE trace_id = ?").get(traceId) as
        | { is_complete: number }
        | undefined;
      assert.equal(row?.is_complete, 1, "partial ingest must not overwrite is_complete back to 0");
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("threads 已标 subagent 后，同批 trace 触发的 thread upsert 不得把 thread_type 打回 main", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-ingest-thread-type-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const parentTid = "agent:email_automatic:feishu:group:oc_parent_smoke";
      const childTid = "agent:email_automatic:subagent:uuid-smoke-child";
      const traceA = `trace-a-${Date.now()}`;
      const traceB = `trace-b-${Date.now()}`;
      const now = Date.now();

      assert.equal(
        applyOpikBatch(db, {
          threads: [
            {
              thread_id: parentTid,
              workspace_name: "default",
              project_name: "openclaw",
              first_seen_ms: now,
              last_seen_ms: now,
            },
            {
              thread_id: childTid,
              workspace_name: "default",
              project_name: "openclaw",
              thread_type: "subagent",
              parent_thread_id: parentTid,
              channel_name: "feishu",
              first_seen_ms: now,
              last_seen_ms: now,
              metadata: { source: "openclaw-trace-plugin" },
            },
          ],
          traces: [
            {
              trace_id: traceA,
              thread_id: childTid,
              workspace_name: "default",
              project_name: "openclaw",
              name: "llm",
              created_at_ms: now,
              is_complete: 1,
              success: 1,
              metadata: { run_kind: "subagent" },
            },
            {
              trace_id: traceB,
              thread_id: childTid,
              workspace_name: "default",
              project_name: "openclaw",
              name: "llm-2",
              created_at_ms: now + 1,
              is_complete: 1,
              success: 1,
            },
          ],
        }).skipped.length,
        0,
      );

      const th = db
        .prepare(
          "SELECT thread_type, parent_thread_id, channel_name FROM opik_threads WHERE thread_id = ? AND workspace_name = 'default' AND project_name = 'openclaw'",
        )
        .get(childTid) as
        | { thread_type: string; parent_thread_id: string | null; channel_name: string | null }
        | undefined;
      assert.ok(th);
      assert.equal(th.thread_type, "subagent");
      assert.equal(th.parent_thread_id, parentTid);
      assert.equal(th.channel_name, "feishu");
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("subagent trace 的 metadata.parent_turn_id 指向父 trace_id 时可解析 parent_thread_id（无需 anchor 元数据）", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-ingest-parent-trace-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const parentTid = "agent:daily_reddit_digest:feishu:group:oc_graph_parent_smoke";
      const childTid = "agent:daily_reddit_digest:subagent:uuid-graph-child-smoke";
      const traceParent = `trace-parent-${Date.now()}`;
      const traceChild = `trace-child-${Date.now()}`;
      const now = Date.now();

      assert.equal(
        applyOpikBatch(db, {
          threads: [
            {
              thread_id: parentTid,
              workspace_name: "default",
              project_name: "openclaw",
              first_seen_ms: now,
              last_seen_ms: now,
            },
          ],
          traces: [
            {
              trace_id: traceParent,
              thread_id: parentTid,
              workspace_name: "default",
              project_name: "openclaw",
              name: "parent-turn",
              created_at_ms: now,
              is_complete: 1,
              success: 1,
              metadata: { run_kind: "external" },
            },
            {
              trace_id: traceChild,
              thread_id: childTid,
              workspace_name: "default",
              project_name: "openclaw",
              name: "subagent-turn",
              created_at_ms: now + 1,
              is_complete: 1,
              success: 1,
              metadata: { run_kind: "subagent", parent_turn_id: traceParent },
            },
          ],
        }).skipped.length,
        0,
      );

      const th = db
        .prepare(
          "SELECT thread_type, parent_thread_id FROM opik_threads WHERE thread_id = ? AND workspace_name = 'default' AND project_name = 'openclaw'",
        )
        .get(childTid) as { thread_type: string; parent_thread_id: string | null } | undefined;
      assert.ok(th);
      assert.equal(th.thread_type, "subagent");
      assert.equal(th.parent_thread_id, parentTid);
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("仅 traces 时 subagent thread_id + metadata.anchor_parent_thread_id 可写入 thread 行", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-ingest-trace-only-sub-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const parentTid = "agent:email_automatic:feishu:group:oc_only_trace_parent";
      const childTid = "agent:email_automatic:subagent:uuid-only-trace-child";
      const traceId = `trace-only-${Date.now()}`;
      const now = Date.now();

      assert.equal(
        applyOpikBatch(db, {
          threads: [
            {
              thread_id: parentTid,
              workspace_name: "default",
              project_name: "openclaw",
              first_seen_ms: now,
              last_seen_ms: now,
            },
          ],
          traces: [
            {
              trace_id: traceId,
              thread_id: childTid,
              workspace_name: "default",
              project_name: "openclaw",
              name: "llm",
              created_at_ms: now,
              is_complete: 1,
              success: 1,
              metadata: {
                run_kind: "subagent",
                anchor_parent_thread_id: parentTid,
              },
            },
          ],
        }).skipped.length,
        0,
      );

      const th = db
        .prepare(
          "SELECT thread_type, parent_thread_id FROM opik_threads WHERE thread_id = ? AND workspace_name = 'default' AND project_name = 'openclaw'",
        )
        .get(childTid) as { thread_type: string; parent_thread_id: string | null } | undefined;
      assert.ok(th);
      assert.equal(th.thread_type, "subagent");
      assert.equal(th.parent_thread_id, parentTid);
    } finally {
      db.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        /* ignore */
      }
    }
  });

  it("metadata 回填：early thread touch 未带 anchor 时从已合并 metadata_json 补 parent_thread_id", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-ingest-meta-backfill-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const parentTid = "agent:main:feishu:group:oc_meta_backfill_parent";
      const childTid = "agent:main:subagent:meta-backfill-child";
      const traceId = `trace-meta-backfill-${Date.now()}`;
      const now = Date.now();
      const metaWithAnchor = JSON.stringify({
        run_kind: "subagent",
        anchor_parent_thread_id: parentTid,
      });

      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, parent_thread_id, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', NULL, ?, ?)`,
      ).run(parentTid, now, now);
      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, parent_thread_id, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'subagent', NULL, ?, ?)`,
      ).run(childTid, now, now);
      db.prepare(
        `INSERT INTO opik_traces (
           trace_id, thread_id, workspace_name, project_name, trace_type, name, metadata_json,
           created_at_ms, is_complete, created_from
         ) VALUES (?, ?, 'default', 'openclaw', 'subagent', 'llm', ?, ?, 0, 'test')`,
      ).run(traceId, childTid, metaWithAnchor, now);

      const before = db
        .prepare(
          "SELECT parent_thread_id FROM opik_threads WHERE thread_id = ? AND workspace_name = 'default' AND project_name = 'openclaw'",
        )
        .get(childTid) as { parent_thread_id: string | null } | undefined;
      assert.ok(before);
      assert.equal(before.parent_thread_id, null);

      assert.equal(
        applyOpikBatch(db, {
          traces: [
            {
              trace_id: traceId,
              thread_id: childTid,
              workspace_name: "default",
              project_name: "openclaw",
              name: "llm",
              created_at_ms: now,
              is_complete: 0,
              metadata: { patch_marker: true },
            },
          ],
        }).skipped.length,
        0,
      );

      const after = db
        .prepare(
          "SELECT parent_thread_id FROM opik_threads WHERE thread_id = ? AND workspace_name = 'default' AND project_name = 'openclaw'",
        )
        .get(childTid) as { parent_thread_id: string | null } | undefined;
      assert.ok(after);
      assert.equal(after.parent_thread_id, parentTid);
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
