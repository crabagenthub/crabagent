import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { writePendingSnapshot } from "./pending-disk.js";
import { OpikOpenClawRuntime } from "./opik-runtime.js";
import { traceSessionKeyCandidates } from "./trace-session-key.js";

describe("OpikOpenClawRuntime — 无 LLM 回合上报", () => {
  it("从 agent_end.messages 识别 LangChain 式 human 消息并产出 batch", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const batch = rt.onAgentEnd(
      "sess-1",
      {
        success: true,
        messages: [{ type: "human", content: "邮件正文测试" }],
      },
      { agentId: "email_automatic" },
    );
    assert.ok(batch);
    assert.equal(batch?.traces?.length, 1);
    assert.equal(batch?.spans?.length, 1);
    const meta = batch?.traces?.[0]?.metadata as Record<string, unknown> | undefined;
    assert.equal(meta?.trace_kind, "agent_end_transcript");
  });

  it("在多个 session 别名上能合并取出 message_received pending（CozeLoop 式对齐）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("conv-feishu-xyz", {
      message_received: { from: "inbox", content: "hello from pending" },
    });
    const batch = rt.onAgentEnd(
      "session-main",
      { success: true, messages: [] },
      { agentId: "email_automatic", conversationId: "conv-feishu-xyz" },
      ["session-main", "conv-feishu-xyz"],
    );
    assert.ok(batch);
    assert.equal(batch?.traces?.length, 1);
    const input = batch?.traces?.[0]?.input as Record<string, unknown> | undefined;
    const ut = input?.user_turn as Record<string, unknown> | undefined;
    const mr = ut?.message_received as Record<string, unknown> | undefined;
    assert.equal(mr?.content, "hello from pending");
  });

  it("agent_end 先关闭回合后，迟到的 llm_output 仍生成 span/trace 补写 batch", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.onLlmInput("sk-late", { provider: "p", model: "m", prompt: "x" }, { agentId: "main" }, 10_000, ["sk-late"]);
    rt.onAgentEnd("sk-late", { success: true, messages: [] }, { agentId: "main" }, ["sk-late"]);
    const patch = rt.onLlmOutput("sk-late", {
      model: "m",
      assistantTexts: ["晚了但要有"],
      usage: { total_tokens: 42 },
    });
    assert.ok(patch);
    assert.equal(patch?.spans?.length, 1);
    assert.equal(patch?.traces?.length, 1);
    const sp = patch?.spans?.[0] as Record<string, unknown> | undefined;
    assert.deepEqual(sp?.usage, { total_tokens: 42 });
  });

  it("agent_end 先于 llm_output 时，llm_output 只用 feishu 别名键仍能命中 late ref", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const sk = "agent:email_automatic:feishu:user:ou_late_alias";
    const ctx = { agentId: "email_automatic", sessionKey: sk };
    const keys = traceSessionKeyCandidates(ctx);
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "查天气" }, ctx, 10_000, keys);
    rt.onAgentEnd(sk, { success: true, messages: [] }, ctx, keys);
    const feishuOnly = keys.find((k) => k.startsWith("feishu/"));
    assert.ok(feishuOnly, "candidates should include feishu/");
    const patch = rt.onLlmOutput(feishuOnly!, {
      model: "m",
      assistantTexts: ["杭州今日多云"],
      usage: { totalTokens: 7 },
    });
    assert.ok(patch, "late patch should resolve via alias key");
    assert.equal(patch?.spans?.length, 1);
    assert.equal(patch?.traces?.length, 1);
  });

  it("primary sk 完全错位时，仅靠 sessionAliasKeys 仍可命中 late ref", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const sk = "agent:email_automatic:feishu:user:ou_mismatch_primary";
    const ctx = { agentId: "email_automatic", sessionKey: sk };
    const keys = traceSessionKeyCandidates(ctx);
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "q" }, ctx, 10_000, keys);
    rt.onAgentEnd(sk, { success: true, messages: [] }, ctx, keys);
    const patch = rt.onLlmOutput(
      "wrong-openclaw-primary-sk",
      { model: "m", assistantTexts: ["ok"], usage: { total_tokens: 1 } },
      keys,
    );
    assert.ok(patch);
    assert.equal(patch?.spans?.length, 1);
  });

  it("飞书单聊 feishu/ou pending 与 agent:…:feishu:user:ou LLM 键对齐", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("feishu/ou_abc", {
      message_received: { from: "feishu", content: "查杭州天气" },
    });
    const sk = "agent:email_automatic:feishu:user:ou_abc";
    const ctx = { agentId: "email_automatic", sessionKey: sk };
    rt.onLlmInput(
      sk,
      { provider: "p", model: "m", prompt: "p" },
      ctx,
      10_000,
      traceSessionKeyCandidates(ctx),
    );
    const batch = rt.onAgentEnd(sk, { success: true, messages: [] }, ctx, traceSessionKeyCandidates(ctx));
    assert.ok(batch);
    const input = batch?.traces?.[0]?.input as Record<string, unknown> | undefined;
    const ut = input?.user_turn as Record<string, unknown> | undefined;
    const mr = ut?.message_received as Record<string, unknown> | undefined;
    assert.equal(mr?.content, "查杭州天气");
  });

  it("飞书 feishu/oc pending 与 agent:email_automatic:feishu:group:oc LLM 键对齐（全链路入库）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("feishu/oc_x", {
      message_received: { from: "feishu", content: "用户消息" },
    });
    const sk = "agent:email_automatic:feishu:group:oc_x";
    const ctx = { agentId: "email_automatic", sessionKey: sk };
    rt.onLlmInput(
      sk,
      { provider: "p", model: "m", prompt: "prompt" },
      ctx,
      10_000,
      traceSessionKeyCandidates(ctx),
    );
    const batch = rt.onAgentEnd(sk, { success: true, messages: [] }, ctx, traceSessionKeyCandidates(ctx));
    assert.ok(batch);
    const input = batch?.traces?.[0]?.input as Record<string, unknown> | undefined;
    const ut = input?.user_turn as Record<string, unknown> | undefined;
    const mr = ut?.message_received as Record<string, unknown> | undefined;
    assert.equal(mr?.content, "用户消息");
  });

  it("llm_input 采样跳过仍应在 agent_end 用 pending 合成（避免零上报与 pending 滞留）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("sk", {
      message_received: { from: "u", content: "x" },
    });
    rt.onLlmInput("sk", { provider: "p", model: "m", prompt: "p" }, { agentId: "main" }, 0, ["sk"]);
    const batch = rt.onAgentEnd("sk", { success: true }, { agentId: "main" }, ["sk"]);
    assert.ok(batch);
    assert.equal(batch?.traces?.length, 1);
    const input = batch?.traces?.[0]?.input as Record<string, unknown> | undefined;
    const ut = input?.user_turn as Record<string, unknown> | undefined;
    const mr = ut?.message_received as Record<string, unknown> | undefined;
    assert.equal(mr?.content, "x");
  });

  it("participant / customer 等 role 也可从 transcript 提取", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const batch = rt.onAgentEnd(
      "s",
      {
        success: true,
        messages: [{ role: "customer", content: "询价" }],
      },
      { agentId: "a" },
    );
    assert.ok(batch?.traces?.[0]);
  });

  it("中文 role「用户」可从 transcript 提取", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const batch = rt.onAgentEnd(
      "s",
      {
        success: true,
        messages: [{ role: "用户", content: "我姓张，张俊熙是不是有点韩国味" }],
      },
      { agentId: "email_automatic" },
    );
    assert.ok(batch);
    const input = batch?.traces?.[0]?.input as Record<string, unknown> | undefined;
    assert.match(String(input?.list_input_preview ?? ""), /张俊熙/);
  });

  it("无 message_received 时可用 before_prompt_build 长预览合成（模拟 Gmail Hook 隔离路径）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const tail = "我姓张，张俊熙是不是有点韩国味";
    const longPrompt = `${"x".repeat(5000)}${tail}`;
    rt.mergePendingContext("hook:gmail:msg-1", {
      before_prompt_build: {
        promptCharCount: longPrompt.length,
        promptPreview: longPrompt.slice(0, 16_384),
        historyMessageCount: 0,
      },
    });
    const batch = rt.onAgentEnd(
      "hook:gmail:msg-1",
      { success: true, messages: [] },
      { agentId: "email_automatic", sessionKey: "hook:gmail:msg-1" },
      ["hook:gmail:msg-1"],
    );
    assert.ok(batch);
    const input = batch?.traces?.[0]?.input as Record<string, unknown> | undefined;
    assert.match(String(input?.list_input_preview ?? ""), /张俊熙/);
  });

  it("pending 落盘后在下次 Runtime 启动可 hydrate 并在 agent_end 合成", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oct-pend-"));
    try {
      const sk = "hook:gmail:recover-1";
      writePendingSnapshot(dir, sk, {
        before_prompt_build: {
          promptPreview: "磁盘恢复的邮件正文 张俊熙",
          promptCharCount: 20,
          historyMessageCount: 0,
        },
      });
      const rt = new OpikOpenClawRuntime("default", "openclaw", { persistPendingDir: dir });
      const batch = rt.onAgentEnd(
        sk,
        { success: true, messages: [] },
        { agentId: "email_automatic", sessionKey: sk },
        [sk],
      );
      assert.ok(batch);
      assert.match(String((batch?.traces?.[0]?.input as { list_input_preview?: string })?.list_input_preview ?? ""), /张俊熙/);
      const pendingDir = path.join(dir, "pending");
      assert.ok(fs.existsSync(pendingDir));
      assert.equal(fs.readdirSync(pendingDir).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非标准 role 时跳过 assistant 后取正文（fallback）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const batch = rt.onAgentEnd(
      "s",
      {
        success: true,
        messages: [
          { role: "assistant", content: "hi" },
          { source: "inbound", text: "plain inbound body" },
        ],
      },
      { agentId: "email_automatic" },
    );
    assert.ok(batch);
    const meta = batch?.traces?.[0]?.metadata as Record<string, unknown> | undefined;
    assert.equal(meta?.trace_kind, "agent_end_transcript_fallback");
  });

  it("仅有 session_start 也视为可入库上下文", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("sk", { session_start: { resumedFrom: false } });
    const batch = rt.onAgentEnd("sk", { success: true, messages: [] }, { agentId: "email_automatic" }, ["sk"]);
    assert.ok(batch);
    const meta = batch?.traces?.[0]?.metadata as Record<string, unknown> | undefined;
    assert.equal(meta?.trace_kind, "agent_end_without_llm");
  });

  it("无 pending 仍写 agent_end_bare（自动化 / 非逾期扫描类回合，对齐 core）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw", { traceBareAgentEnds: true });
    const batch = rt.onAgentEnd(
      "agent:email_automatic:feishu:group:oc_x",
      { success: true, messages: [] },
      { agentId: "email_automatic", sessionKey: "agent:email_automatic:feishu:group:oc_x" },
      ["agent:email_automatic:feishu:group:oc_x"],
    );
    assert.ok(batch);
    const meta = batch?.traces?.[0]?.metadata as Record<string, unknown> | undefined;
    assert.equal(meta?.trace_kind, "agent_end_bare");
  });

  it("traceBareAgentEnds=false 且无 ingestible 时不合成", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw", { traceBareAgentEnds: false });
    const batch = rt.onAgentEnd("sk", { success: true, messages: [] }, { agentId: "a", sessionKey: "sk" }, ["sk"]);
    assert.equal(batch, null);
  });
});
