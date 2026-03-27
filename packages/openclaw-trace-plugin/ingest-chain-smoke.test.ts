/**
 * 全链路染色：Runtime 合成飞书式会话（含 agent_end 先于 llm_output 的迟到补写）→ mergeOpikBatches → applyOpikBatch。
 * 运行：`pnpm --filter @crabagent/openclaw-trace-plugin exec tsx --test ingest-chain-smoke.test.ts`
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyOpikBatch } from "../../services/collector/src/opik-batch-ingest.js";
import { openDatabase } from "../../services/collector/src/db.js";
import { mergeOpikBatches } from "./flush.js";
import type { OpikBatchPayload } from "./opik-types.js";
import { OpikOpenClawRuntime } from "./opik-runtime.js";
import { traceSessionKeyCandidates } from "./trace-session-key.js";

/** 与 services/collector `opik-ingest-smoke.test.ts` 中常量一致，便于你在 DB 里搜。 */
const CRABAGENT_SMOKE_INGEST_MARKER = "crabagent_smoke_ingest_v1";

describe("Runtime → merge → applyOpikBatch（染色全链路）", () => {
  it("飞书 email_automatic 键 + agent_end 先于 llm_output 仍可入库并带 smoke 标记", () => {
    const dbPath = path.join(
      os.tmpdir(),
      `crabagent-chain-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    const db = openDatabase(dbPath);
    try {
      const rt = new OpikOpenClawRuntime("default", "openclaw");
      const sk = "agent:email_automatic:feishu:user:ou_smoke_test";
      const ctx = { agentId: "email_automatic", sessionKey: sk, messageProvider: "feishu" };

      rt.mergePendingContext("feishu/ou_smoke_test", {
        message_received: {
          from: "feishu",
          content: "杭州明天天气",
        },
      });

      rt.onLlmInput(
        sk,
        { provider: "openai", model: "gpt-test", prompt: "杭州明天天气", imagesCount: 0 },
        ctx,
        10_000,
        traceSessionKeyCandidates(ctx),
      );

      const b2 = rt.onAgentEnd(
        sk,
        { success: true, messages: [{ role: "assistant", content: "晴", usage: { total_tokens: 10 } }] },
        ctx,
        traceSessionKeyCandidates(ctx),
      );
      assert.ok(b2?.traces?.length === 1);
      const tr0 = b2!.traces![0] as Record<string, unknown>;
      const meta = {
        ...((typeof tr0.metadata === "object" && tr0.metadata && !Array.isArray(tr0.metadata)
          ? tr0.metadata
          : {}) as Record<string, unknown>),
      };
      meta[CRABAGENT_SMOKE_INGEST_MARKER] = true;
      meta.scenario = "ingest_chain_feishu_weather";
      tr0.metadata = meta;

      const b3 = rt.onLlmOutput(sk, {
        model: "gpt-test",
        assistantTexts: ["晴，20°C"],
        usage: { total_tokens: 99 },
      });

      const parts: OpikBatchPayload[] = [];
      if (b2) {
        parts.push(b2);
      }
      if (b3) {
        parts.push(b3);
      }
      const merged = mergeOpikBatches(parts);
      const r = applyOpikBatch(db, merged);
      assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
      assert.ok(r.accepted.traces >= 1);

      const tid = String(tr0.trace_id ?? "");
      assert.ok(tid.length > 0);
      const row = db.prepare("SELECT metadata_json FROM opik_traces WHERE trace_id = ?").get(tid) as
        | { metadata_json: string }
        | undefined;
      assert.ok(row?.metadata_json?.includes(CRABAGENT_SMOKE_INGEST_MARKER));
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
