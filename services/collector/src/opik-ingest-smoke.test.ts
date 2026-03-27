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
});
