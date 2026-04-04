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

  it("subagent_spawned 早于父 trace 时仍写入子 thread 的 parent 与父 channel", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const parentSk = "agent:email_automatic:feishu:direct:oc_parenttest";
    const childSk = "agent:email_automatic:subagent:uuid-child-test";
    rt.registerSubagentChildAnchor(parentSk, childSk, "feishu");
    rt.onLlmInput(
      parentSk,
      { provider: "p", model: "m", prompt: "父回合" },
      {
        agentId: "email_automatic",
        sessionKey: parentSk,
        messageProvider: "feishu",
        channelId: "direct",
      },
      10_000,
    );
    rt.onLlmInput(
      childSk,
      { provider: "p", model: "m", prompt: "子回合" },
      {
        agentId: "email_automatic",
        sessionKey: childSk,
        messageProvider: "webchat",
      },
      10_000,
    );
    const childBatch = rt.onAgentEnd(
      childSk,
      { success: true, messages: [] },
      {
        agentId: "email_automatic",
        sessionKey: childSk,
        messageProvider: "webchat",
      },
      [childSk],
    );
    assert.ok(childBatch?.threads?.length);
    const th = childBatch?.threads?.[0] as Record<string, unknown> | undefined;
    assert.equal(th?.thread_type, "subagent");
    assert.equal(th?.parent_thread_id, parentSk);
    assert.equal(th?.channel_name, "feishu");
  });

  it("llm_input 将 openclaw_routing.kind 写入 trace（从 sessionKey 解析）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const sk = "agent:email_automatic:feishu:group:oc_x";
    const ctx = { agentId: "email_automatic", sessionKey: sk };
    rt.mergePendingContext(sk, { message_received: { from: "feishu/oc_x", content: "ping" } });
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "pong" }, ctx, 10_000, [sk]);
    const batch = rt.onAgentEnd(sk, { success: true, messages: [{ role: "assistant", content: "ok" }] }, ctx, [sk]);
    assert.ok(batch?.traces?.length);
    const meta = batch?.traces?.[0]?.metadata as Record<string, unknown> | undefined;
    const rout = meta?.openclaw_routing as Record<string, unknown> | undefined;
    assert.equal(rout?.kind, "group");
    assert.equal(rout?.thinking, "inherit");
    assert.equal(rout?.fast, "inherit");
    assert.equal(rout?.verbose, "inherit");
    assert.equal(rout?.reasoning, "inherit");
    const span = batch?.spans?.find((s) => (s as Record<string, unknown>).type === "llm") as
      | Record<string, unknown>
      | undefined;
    const sm = span?.metadata as Record<string, unknown> | undefined;
    const sr = sm?.openclaw_routing as Record<string, unknown> | undefined;
    assert.equal(sr?.kind, "group");
    assert.equal(sr?.thinking, "inherit");
  });

  it("首次 before_tool 将 tool_execution_mode 写入 trace.metadata（后续不覆盖）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const sk = "sess-tool-exec-mode";
    const ctx = { agentId: "main", sessionKey: sk };
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "x" }, ctx, 10_000, [sk]);
    rt.onBeforeTool(sk, {
      toolName: "read",
      toolCallId: "c1",
      params: {},
      tool_execution_mode: "sequential",
    });
    rt.onBeforeTool(sk, {
      toolName: "read",
      toolCallId: "c2",
      params: {},
      tool_execution_mode: "parallel",
    });
    const batch = rt.onAgentEnd(sk, { success: true, messages: [] }, ctx, [sk]);
    assert.ok(batch?.traces?.length);
    const meta = batch?.traces?.[0]?.metadata as Record<string, unknown> | undefined;
    assert.equal(meta?.tool_execution_mode, "sequential");
  });

  it("llm_input 带 run_id 时在 trace 顶层写入 subagent_thread_id（供 Collector 落库）", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("feishu/oc_sub_tid", {
      message_received: { from: "feishu", content: "hi" },
    });
    const sk = "agent:email_automatic:feishu:group:oc_sub_tid";
    const ctx = { agentId: "email_automatic", sessionKey: sk };
    const runId =
      "announce:v1:agent:email_automatic:subagent:d05e53b7-989b-43e6-8de2-a69fd889ef56:ccf3a2c3-f98a-4e74-9dc3-8c7824af1443";
    rt.onLlmInput(
      sk,
      { provider: "p", model: "m", prompt: "p", runId },
      ctx,
      10_000,
      traceSessionKeyCandidates(ctx),
    );
    const active = (rt as unknown as { active: Map<string, { traceRow: Record<string, unknown> }> }).active;
    const row = active.get(sk)?.traceRow;
    assert.equal(
      row?.subagent_thread_id,
      "agent:email_automatic:subagent:d05e53b7-989b-43e6-8de2-a69fd889ef56",
    );
  });

  it("子代理无 subagent_spawned 锚点时从 systemPrompt 的 Requester session 写 thread parent_thread_id", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const parentSk = "agent:xiaohongshu_ai:feishu:group:oc_4a1b9cecd1b85d8f92f8c472c6306e49";
    const childSk = "agent:xiaohongshu_ai:subagent:9d236944-4064-446c-9bf1-9aeb7396ca38";
    rt.mergePendingContext(childSk, {
      message_received: { from: "internal", content: "task" },
    });
    const ctx = { agentId: "xiaohongshu_ai", sessionKey: childSk };
    const sys = `## Session Context
- **Requester session:** ${parentSk}.
- **Your session:** ${childSk}
`;
    rt.onLlmInput(
      childSk,
      { provider: "p", model: "m", prompt: "x", systemPrompt: sys },
      ctx,
      10_000,
      traceSessionKeyCandidates(ctx),
    );
    const active = (rt as unknown as { active: Map<string, { threadRow: Record<string, unknown> }> }).active;
    const th = active.get(childSk)?.threadRow;
    assert.equal(th?.parent_thread_id, parentSk);
    assert.equal(th?.thread_type, "subagent");
  });

  it("子代理 trace 的 metadata.parent_turn_id 指向父会话上 external（用户入站）trace", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const parentSk = "agent:ua:feishu:group:oc_pt_ext";
    const childSk = "agent:ua:subagent:aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa";
    const pctx = { agentId: "ua", sessionKey: parentSk };

    rt.mergePendingContext(parentSk, { message_received: { from: "feishu", content: "请子代理干活" } });
    rt.onLlmInput(
      parentSk,
      { provider: "p", model: "m", prompt: "父轮次" },
      pctx,
      10_000,
      traceSessionKeyCandidates(pctx),
    );
    const act = rt as unknown as {
      active: Map<string, { traceId: string; traceRow: Record<string, unknown> }>;
    };
    const parentTraceId = act.active.get(parentSk)!.traceId;

    rt.mergePendingContext(childSk, { message_received: { from: "internal", content: "sub" } });
    const sys = `## Session Context
- **Requester session:** ${parentSk}.
- **Your session:** ${childSk}
`;
    rt.onLlmInput(
      childSk,
      { provider: "p", model: "m", prompt: "子", systemPrompt: sys },
      { agentId: "ua", sessionKey: childSk },
      10_000,
      traceSessionKeyCandidates({ agentId: "ua", sessionKey: childSk }),
    );
    const childTraceRow = act.active.get(childSk)!.traceRow;
    const childMeta = childTraceRow.metadata as Record<string, unknown>;
    assert.equal(childMeta.parent_turn_id, parentTraceId);
  });

  it("异步跟进 trace 的 metadata.parent_turn_id 指向同会话 external trace", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const sk = "agent:async_u:feishu:group:oc_async_pt";
    const ctx = { agentId: "async_u", sessionKey: sk };
    rt.mergePendingContext(sk, { message_received: { from: "feishu", content: "发起异步" } });
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "first" }, ctx, 10_000, traceSessionKeyCandidates(ctx));
    const act = rt as unknown as { active: Map<string, { traceId: string; traceRow: Record<string, unknown> }> };
    const externalTraceId = act.active.get(sk)!.traceId;
    rt.onLlmInput(
      sk,
      {
        provider: "p",
        model: "m",
        prompt: "The async command the user already approved has completed.",
      },
      ctx,
      10_000,
      traceSessionKeyCandidates(ctx),
    );
    const meta = act.active.get(sk)!.traceRow.metadata as Record<string, unknown>;
    assert.equal(meta.parent_turn_id, externalTraceId);
  });

  it("仅有 before_agent_start.promptPreview、无 message_received 仍标 trace_type external", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    const sk = "agent:hook_ext:feishu:group:oc_hook_ext_only";
    rt.mergePendingContext(sk, {
      before_agent_start: {
        promptPreview:
          "这是一条足够长的用户侧可见会话内容用于测试 external 归类，无 message_received 钩子。",
        promptCharCount: 48,
        historyMessageCount: 0,
      },
    });
    const ctx = { agentId: "hook_ext", sessionKey: sk };
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "模型回复" }, ctx, 10_000, [sk]);
    const act = rt as unknown as { active: Map<string, { traceRow: Record<string, unknown> }> };
    assert.equal(act.active.get(sk)?.traceRow.trace_type, "external");
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

  it("pending 仅在 feishu/oc 桶时，仅靠 primarySk 中 oc_ token 扩展别名仍可低采样建 LLM trace", () => {
    const rt = new OpikOpenClawRuntime("default", "openclaw");
    rt.mergePendingContext("feishu/oc_expand_t1", {
      message_received: { from: "feishu:oc_expand_t1", content: "token-expand" },
    });
    const sk = "agent:main:feishu:group:oc_expand_t1";
    const ctx = { agentId: "main", sessionKey: sk };
    const wrongKeys = ["coarse-key-without-feishu-token"];
    rt.onLlmInput(sk, { provider: "p", model: "m", prompt: "go" }, ctx, 0, wrongKeys);
    const active = (rt as unknown as { active: Map<string, { traceRow: Record<string, unknown> }> }).active;
    assert.ok(active.has(sk));
    const input = active.get(sk)!.traceRow.input as Record<string, unknown>;
    const ut = input.user_turn as Record<string, unknown> | undefined;
    const mr = ut?.message_received as Record<string, unknown> | undefined;
    assert.equal(mr?.content, "token-expand");
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

  it("subagent 锚点落盘后在下次 Runtime 启动可 hydrate，父 llm 后子 agent_end 仍带 parent_thread_id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oct-anchor-"));
    try {
      const parentSk = "agent:email_automatic:feishu:direct:oc_anchor_disk_parent";
      const childSk = "agent:email_automatic:subagent:uuid-anchor-disk-child";
      const rt1 = new OpikOpenClawRuntime("default", "openclaw", { persistPendingDir: dir });
      rt1.registerSubagentChildAnchor(parentSk, childSk, "feishu");
      rt1.onLlmInput(
        parentSk,
        { provider: "p", model: "m", prompt: "父" },
        { agentId: "email_automatic", sessionKey: parentSk, messageProvider: "feishu", channelId: "direct" },
        10_000,
      );
      rt1.onLlmInput(
        childSk,
        { provider: "p", model: "m", prompt: "子" },
        { agentId: "email_automatic", sessionKey: childSk, messageProvider: "webchat" },
        10_000,
      );
      const anchorDir = path.join(dir, "subagent-anchors");
      assert.ok(fs.existsSync(anchorDir));
      assert.ok(fs.readdirSync(anchorDir).length >= 1);

      const rt2 = new OpikOpenClawRuntime("default", "openclaw", { persistPendingDir: dir });
      rt2.onLlmInput(
        parentSk,
        { provider: "p", model: "m", prompt: "父恢复后" },
        { agentId: "email_automatic", sessionKey: parentSk, messageProvider: "feishu", channelId: "direct" },
        10_000,
      );
      const childBatch = rt2.onAgentEnd(
        childSk,
        { success: true, messages: [] },
        { agentId: "email_automatic", sessionKey: childSk, messageProvider: "webchat" },
        [childSk],
      );
      assert.ok(childBatch?.threads?.length);
      const th = childBatch?.threads?.[0] as Record<string, unknown> | undefined;
      assert.equal(th?.thread_type, "subagent");
      assert.equal(th?.parent_thread_id, parentSk);
      assert.equal(th?.channel_name, "feishu");
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
