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
    traceType?: string;
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
      trace_type,
      input_json, output_json, metadata_json,
      success, duration_ms, created_at_ms, is_complete, created_from
    ) VALUES (?, ?, 'default', 'openclaw', 't',
      ?,
      ?, ?, ?,
      1, 100, ?, 1, 'test')`,
  ).run(
    opts.traceId,
    opts.threadId,
    opts.traceType ?? "external",
    opts.inputJson,
    opts.outputJson,
    opts.metadataJson,
    opts.createdMs,
  );
}

function insertThreadRow(
  db: ReturnType<typeof openDatabase>,
  opts: {
    threadId: string;
    threadType: "main" | "subagent";
    parentThreadId?: string | null;
    firstSeenMs: number;
    lastSeenMs: number;
  },
): void {
  db.prepare(
    `INSERT INTO opik_threads (
      thread_id, workspace_name, project_name, thread_type, parent_thread_id,
      first_seen_ms, last_seen_ms
    ) VALUES (?, 'default', 'openclaw', ?, ?, ?, ?)
    ON CONFLICT(thread_id, workspace_name, project_name) DO UPDATE SET
      thread_type = excluded.thread_type,
      parent_thread_id = COALESCE(excluded.parent_thread_id, opik_threads.parent_thread_id),
      last_seen_ms = MAX(opik_threads.last_seen_ms, excluded.last_seen_ms)`,
  ).run(
    opts.threadId,
    opts.threadType,
    opts.parentThreadId ?? null,
    opts.firstSeenMs,
    opts.lastSeenMs,
  );
}

function insertLlmSpanOutput(
  db: ReturnType<typeof openDatabase>,
  traceId: string,
  outputJson: string,
  sortIndex = 1,
  opts?: { usageJson?: string | null; model?: string | null; provider?: string | null },
): void {
  db.prepare(
    `INSERT INTO opik_spans (
      span_id, trace_id, parent_span_id, name, span_type,
      output_json, usage_json, model, provider, is_complete, sort_index
    ) VALUES (?, ?, NULL, 'llm', 'llm', ?, ?, ?, ?, 1, ?)`,
  ).run(
    `span-${traceId}`,
    traceId,
    outputJson,
    opts?.usageJson ?? null,
    opts?.model ?? null,
    opts?.provider ?? null,
    sortIndex,
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

  it("合成事件携带 input.openclaw.sessionId → 顶层 session_id", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-sid.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-sid";
      const now = Date.now();
      const sid = "openclaw-sess-abc-123";
      insertMinimalTrace(db, {
        traceId: "tr-sid",
        threadId,
        inputJson: JSON.stringify({
          text: "hi",
          openclaw: { sessionId: sid, sessionKey: threadId },
        }),
        outputJson: "{}",
        metadataJson: "{}",
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      assert.equal(items.length, 3);
      for (const row of items) {
        assert.equal(row.session_id, sid, String(row.type));
      }
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("messages 仅有 role=tool（OpenClaw「Tool」首条回复）时仍能填充 payload.assistantTexts", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-tool.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-tool";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-tool",
        threadId,
        inputJson: JSON.stringify({ text: "hello" }),
        outputJson: JSON.stringify({
          messages: [
            { role: "user", content: "hello" },
            { role: "tool", content: "你好！我是 Coco Pig。" },
          ],
        }),
        metadataJson: "{}",
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { assistantTexts?: string[] };
      assert.equal(p.assistantTexts?.[0], "你好！我是 Coco Pig。");
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

  it("output_json 含多条 role=tool 时按顺序拼成一条 assistantTexts", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-multi-tool.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-multi-tool";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-mt",
        threadId,
        inputJson: JSON.stringify({ text: "q" }),
        outputJson: JSON.stringify({
          messages: [
            { role: "user", content: "q" },
            { role: "tool", content: "需要批准天气查询：\n/approve x allow-once" },
            { role: "tool", content: "关于邮件 —— 说明段落" },
          ],
        }),
        metadataJson: "{}",
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { assistantTexts?: string[] };
      const joined = p.assistantTexts?.[0] ?? "";
      assert.ok(joined.includes("需要批准天气查询"));
      assert.ok(joined.includes("关于邮件"));
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("trace output_json 为空但 opik_spans 上 llm span 有正文时仍能填充 payload.assistantTexts", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-span-fb.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-span-fb";
      const traceId = "tr-span-fb";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId,
        threadId,
        inputJson: JSON.stringify({ text: "hi" }),
        outputJson: "{}",
        metadataJson: "{}",
        createdMs: now,
      });
      insertLlmSpanOutput(db, traceId, JSON.stringify({ assistantTexts: ["hey Lucbine, from span only"] }));

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { assistantTexts?: string[] };
      assert.equal(p.assistantTexts?.[0], "hey Lucbine, from span only");
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

  it("agent_end_* 合成 trace 不把 output_preview 冒充助手回复", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-synth.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-synth";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-synth",
        threadId,
        inputJson: "{}",
        outputJson: "{}",
        metadataJson: JSON.stringify({
          output_preview: "占位说明不应当助手文本",
          trace_kind: "agent_end_without_llm",
        }),
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { assistantTexts?: string[] };
      assert.ok(!Array.isArray(p.assistantTexts) || p.assistantTexts.length === 0);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("output_json.usage 为空对象时仍合并 metadata.usage 的 token", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-usage-md.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-usage-md";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId: "tr-usage-md",
        threadId,
        inputJson: JSON.stringify({ text: "q" }),
        outputJson: JSON.stringify({ usage: {}, assistantTexts: ["ok"] }),
        metadataJson: JSON.stringify({
          usage: { prompt_tokens: 22_800, completion_tokens: 276 },
        }),
        createdMs: now,
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { usage?: Record<string, unknown> };
      assert.equal(Number(p.usage?.prompt_tokens), 22_800);
      assert.equal(Number(p.usage?.completion_tokens), 276);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("metadata.usage 落后于主 LLM span 时以 span 为准（与语义树端到端一致）", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-usage-span-wins.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-span-wins";
      const traceId = "tr-span-wins";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId,
        threadId,
        inputJson: JSON.stringify({ text: "q" }),
        outputJson: JSON.stringify({ assistantTexts: ["ok"] }),
        metadataJson: JSON.stringify({
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 21_929 },
        }),
        createdMs: now,
      });
      insertLlmSpanOutput(db, traceId, "{}", 1, {
        usageJson: JSON.stringify({ input: 85_570, output: 397, total: 85_967 }),
        model: "deepseek-chat",
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { usage?: Record<string, unknown> };
      assert.equal(Number((p.usage as { total?: number })?.total), 85_967);
      assert.equal(Number((p.usage as { input?: number })?.input), 85_570);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("同 trace 多条 llm span 时合成 llm_output 的 usage 为各 span 之和", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-multi-llm-span.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-multi-llm";
      const traceId = "tr-multi-llm";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId,
        threadId,
        inputJson: JSON.stringify({ text: "q" }),
        outputJson: JSON.stringify({ assistantTexts: ["ok"] }),
        metadataJson: "{}",
        createdMs: now,
      });
      insertLlmSpanOutput(db, traceId, "{}", 1, {
        usageJson: JSON.stringify({ input: 100, output: 10, total: 110 }),
      });
      db.prepare(
        `INSERT INTO opik_spans (
          span_id, trace_id, parent_span_id, name, span_type,
          output_json, usage_json, model, provider, is_complete, sort_index
        ) VALUES (?, ?, NULL, 'llm', 'llm', ?, ?, NULL, NULL, 1, ?)`,
      ).run(
        "span-second-multi",
        traceId,
        "{}",
        JSON.stringify({ input: 50, output: 5, total: 55 }),
        2,
      );

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as { usage?: { input?: number; output?: number; total?: number } };
      assert.equal(Number(p.usage?.input), 150);
      assert.equal(Number(p.usage?.output), 15);
      assert.equal(Number(p.usage?.total), 165);
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("trace 与 metadata 均无 token 时从 llm span usage_json 兜底", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-usage-span.db`);
    const db = openDatabase(dbPath);
    try {
      const threadId = "thread-usage-span";
      const traceId = "tr-usage-span";
      const now = Date.now();
      insertMinimalTrace(db, {
        traceId,
        threadId,
        inputJson: JSON.stringify({ text: "q" }),
        outputJson: JSON.stringify({ usage: {}, assistantTexts: ["hi"] }),
        metadataJson: "{}",
        createdMs: now,
      });
      insertLlmSpanOutput(db, traceId, "{}", 1, {
        usageJson: JSON.stringify({ input: 100, output: 20 }),
        model: "minimax/m2",
      });

      const items = queryThreadTraceEvents(db, threadId);
      const p = items[2]!.payload as {
        usage?: Record<string, unknown>;
        model?: string;
      };
      assert.equal(Number((p.usage as { input?: number })?.input), 100);
      assert.equal(Number((p.usage as { output?: number })?.output), 20);
      assert.equal(p.model, "minimax/m2");
    } finally {
      db.close();
      fs.unlinkSync(dbPath);
    }
  });

  it("主会话查询包含子 thread（parent_thread_id）内 trace，子 trace 的 thread_id 为子会话", () => {
    const dbPath = path.join(os.tmpdir(), `crabagent-ttq-${Date.now()}-graft.db`);
    const db = openDatabase(dbPath);
    try {
      const parentMain = "agent:main:main";
      const childSub = "agent:main:subagent:d04d0177-08cb-48bf-b925-d9b160ee3d7b";
      const now = Date.now();

      insertThreadRow(db, {
        threadId: parentMain,
        threadType: "main",
        firstSeenMs: now,
        lastSeenMs: now,
      });
      insertThreadRow(db, {
        threadId: childSub,
        threadType: "subagent",
        parentThreadId: parentMain,
        firstSeenMs: now,
        lastSeenMs: now + 50,
      });

      insertMinimalTrace(db, {
        traceId: "tr-main",
        threadId: parentMain,
        inputJson: JSON.stringify({ text: "hi" }),
        outputJson: JSON.stringify({ assistantTexts: ["from main"] }),
        metadataJson: JSON.stringify({ run_id: "run-main", turn_id: "tr-main", run_kind: "external" }),
        createdMs: now,
        traceType: "external",
      });

      insertMinimalTrace(db, {
        traceId: "tr-sub",
        threadId: childSub,
        inputJson: JSON.stringify({
          openclaw: { sessionKey: childSub },
          text: "sub",
        }),
        outputJson: JSON.stringify({ assistantTexts: ["from subagent"] }),
        metadataJson: JSON.stringify({
          run_id: "run-sub",
          turn_id: "tr-sub",
          run_kind: "subagent",
          anchor_parent_thread_id: parentMain,
          anchor_parent_turn_id: "tr-main",
          parent_turn_id: "tr-main",
        }),
        createdMs: now + 50,
        traceType: "subagent",
      });

      const items = queryThreadTraceEvents(db, parentMain);
      assert.equal(items.length, 6, "main + grafted subagent → 2 traces × 3 events");
      const subOut = items.find((e) => (e as { type?: string }).type === "llm_output" && e.trace_root_id === "tr-sub") as
        | { thread_id?: string; trace_root_id?: string }
        | undefined;
      assert.ok(subOut, "subagent llm_output present in parent thread timeline");
      assert.equal(subOut.thread_id, childSub, "events carry child opik_traces.thread_id for UI subagent link");
      assert.equal((subOut as { run_kind?: string | null }).run_kind, "subagent");
      const subRecv = items.find(
        (e) => (e as { type?: string }).type === "message_received" && e.trace_root_id === "tr-sub",
      ) as { run_kind?: string | null } | undefined;
      assert.equal(subRecv?.run_kind, "subagent");
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
