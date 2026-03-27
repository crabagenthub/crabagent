/**
 * 契约：每条 opik trace 行合成 3 条事件；llm_output.payload 须能从常见 output_json 形态还原 assistantTexts。
 * 运行：`pnpm --filter @crabagent/collector test`（或单独 tsx --test 本文件）
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import { queryThreadTraceEvents } from "./thread-trace-events-query.js";

function insertMinimalTrace(
  db: ReturnType<typeof openDatabase>,
  opts: {
    traceId: string;
    threadId: string;
    inputJson: string;
    outputJson: string;
    metadataJson: string;
    createdMs: number;
  },
): void {
  db.prepare(
    `INSERT INTO opik_threads (thread_id, workspace_name, project_name, first_seen_ms, last_seen_ms)
     VALUES (?, 'default', 'openclaw', ?, ?)
     ON CONFLICT(thread_id, workspace_name, project_name) DO UPDATE SET
       last_seen_ms = MAX(opik_threads.last_seen_ms, excluded.last_seen_ms)`,
  ).run(opts.threadId, opts.createdMs, opts.createdMs);

  db.prepare(
    `INSERT INTO opik_traces (
      trace_id, thread_id, workspace_name, project_name, name,
      input_json, output_json, metadata_json,
      success, duration_ms, created_at_ms, is_complete, created_from
    ) VALUES (?, ?, 'default', 'openclaw', 't',
      ?, ?, ?,
      1, 100, ?, 1, 'test')`,
  ).run(
    opts.traceId,
    opts.threadId,
    opts.inputJson,
    opts.outputJson,
    opts.metadataJson,
    opts.createdMs,
  );
}

describe("queryThreadTraceEvents / 合成时间线", () => {
  it("每条 trace 产生 message_received → llm_input → llm_output 且 event_id 后缀稳定", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-a";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-1",
        threadId,
        inputJson: JSON.stringify({ text: "user q" }),
        outputJson: JSON.stringify({ assistantTexts: ["answer one"] }),
        metadataJson: JSON.stringify({ run_id: "run-1" }),
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      assert.equal(items.length, 3);
      assert.equal(items[0]!.type, "message_received");
      assert.equal(items[0]!.event_id, "tr-1:recv");
      assert.equal(items[1]!.type, "llm_input");
      assert.equal(items[1]!.event_id, "tr-1:llm_in");
      assert.equal(items[2]!.type, "llm_output");
      assert.equal(items[2]!.event_id, "tr-1:llm_out");
      const p = items[2]!.payload as { assistantTexts?: string[] };
      assert.ok(Array.isArray(p.assistantTexts));
      assert.equal(p.assistantTexts![0], "answer one");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("output_json 仅有 LangChain 式 messages（无 assistantTexts）时仍能填充 payload.assistantTexts", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-b.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-b";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-b",
        threadId,
        inputJson: JSON.stringify({ text: "hello" }),
        outputJson: JSON.stringify({
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "world reply" },
          ],
        }),
        metadataJson: "{}",
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { assistantTexts?: string[] };
      assert.equal(p.assistantTexts?.[0], "world reply");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("output 为空时用 metadata.output_preview 兜底", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-c.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-c";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-c",
        threadId,
        inputJson: "{}",
        outputJson: "{}",
        metadataJson: JSON.stringify({ output_preview: "preview body" }),
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { assistantTexts?: string[] };
      assert.equal(p.assistantTexts?.[0], "preview body");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("同 thread 多行 trace → 事件数 = 3 × 行数", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-d.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-d";
      const t0 = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-d1",
        threadId,
        inputJson: "{}",
        outputJson: JSON.stringify({ assistantTexts: ["a"] }),
        metadataJson: "{}",
        createdMs: t0,
      });
      insertMinimalTrace(db, {
        traceId: "tr-d2",
        threadId,
        inputJson: "{}",
        outputJson: JSON.stringify({ assistantTexts: ["b"] }),
        metadataJson: "{}",
        createdMs: t0 + 1000,
      });

      const items = queryThreadTraceEvents(db, threadId);
      assert.equal(items.length, 6);
      const outs = items.filter((e) => e.type === "llm_output");
      assert.equal(outs.length, 2);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });
});
