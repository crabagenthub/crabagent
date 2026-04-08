import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentScopedTraceKey,
  extractSubagentChildIdFromPromptPreview,
  extractSubagentChildIdFromSessionKey,
  extractRequesterThreadIdFromOpenClawSessionContext,
  extractSubagentSessionKeyFromText,
  hasOpenClawParentRoutingSessionHint,
  isOpenClawParentRoutingSessionKey,
  parseRoutingKindFromSessionKey,
  pickCanonicalTraceThreadId,
  resolvePrimaryTraceKey,
  sessionKeyImpliesSubagentSessionKey,
  traceSessionKeyCandidates,
  traceSessionKeyCandidatesForInbound,
  traceSessionKeyCandidatesForPending,
} from "./trace-session-key.js";

describe("trace-session-key（CozeLoop 式渠道键）", () => {
  it("user: / chat: conversationId 归一为 feishu/…", () => {
    assert.equal(resolvePrimaryTraceKey({ conversationId: "user:abc" }), "feishu/abc");
    assert.equal(resolvePrimaryTraceKey({ conversationId: "chat:xyz" }), "feishu/xyz");
  });

  it("hook: 前缀保持原样", () => {
    assert.equal(resolvePrimaryTraceKey({ sessionKey: "hook:gmail:msg-1" }), "hook:gmail:msg-1");
  });

  it("candidates 同时包含 sessionKey 与 conversationId", () => {
    const keys = traceSessionKeyCandidates({
      sessionKey: "session-main",
      conversationId: "conv-feishu-xyz",
    });
    assert.ok(keys.includes("session-main"));
    assert.ok(keys.includes("conv-feishu-xyz"));
  });

  it("非 main agentId 时追加 \\x1fagent: 变体且主键与 effective 一致", () => {
    const ctx = { sessionKey: "user:group-1", agentId: "email_automatic" };
    const keys = traceSessionKeyCandidates(ctx);
    assert.ok(keys.includes("user:group-1\x1fagent:email_automatic"));
    assert.ok(keys.includes("user:group-1"));
    assert.equal(agentScopedTraceKey(ctx), "user:group-1\x1fagent:email_automatic");
  });

  it("sessionKey 已是 agent:<id>: 路由时不重复加后缀", () => {
    const sk = "agent:email_automatic:feishu:oc_x";
    const ctx = { sessionKey: sk, agentId: "email_automatic" };
    const keys = traceSessionKeyCandidates(ctx);
    assert.ok(keys.includes(sk));
    assert.ok(!keys.some((k) => k.includes("\x1fagent:")));
    assert.equal(agentScopedTraceKey(ctx), sk);
  });

  it("飞书 agent 路由 sessionKey 补充 feishu/<oc> 以供入站 pending 对齐", () => {
    const sk = "agent:email_automatic:feishu:group:oc_x";
    const keys = traceSessionKeyCandidates({ sessionKey: sk, agentId: "email_automatic" });
    assert.ok(keys.includes(sk));
    assert.ok(keys.includes("feishu/oc_x"));
  });

  it("agent 路由中含 user: 时补充 feishu/<open_id>（单聊常见）", () => {
    const sk = "agent:email_automatic:feishu:user:ou_abc";
    const keys = traceSessionKeyCandidates({ sessionKey: sk, agentId: "email_automatic" });
    assert.ok(keys.includes("feishu/ou_abc"));
  });

  it("traceSessionKeyCandidatesForPending 含以 conversationId 为 from 的候选（对齐仅带 ctx 的 llm_input）", () => {
    const ctx = { sessionKey: "agent:test:feishu:group:oc_9", conversationId: "user:side" };
    const expanded = traceSessionKeyCandidatesForPending(ctx);
    for (const k of traceSessionKeyCandidates(ctx, "user:side")) {
      assert.ok(expanded.includes(k), `missing ${k}`);
    }
  });

  it("parseRoutingKindFromSessionKey 从 agent:…:feishu:group:… 取第四段 kind", () => {
    assert.equal(parseRoutingKindFromSessionKey("agent:email_automatic:feishu:group:oc_x"), "group");
    assert.equal(parseRoutingKindFromSessionKey("agent:a:feishu:user:ou_abc"), "user");
  });

  it("parseRoutingKindFromSessionKey 对 oc_ 第四段不误判", () => {
    assert.equal(parseRoutingKindFromSessionKey("agent:email_automatic:feishu:oc_x"), undefined);
  });

  it("sessionKeyImpliesSubagentSessionKey 识别 agent:<id>:subagent:<child>", () => {
    assert.equal(
      sessionKeyImpliesSubagentSessionKey("agent:email_automatic:subagent:bc2569ba-5f34-467c-bd65-86541a7b2d50"),
      true,
    );
    assert.equal(sessionKeyImpliesSubagentSessionKey("agent:email_automatic:feishu:direct:oc_x"), false);
  });

  it("extractSubagentChildIdFromSessionKey 取末段 UUID", () => {
    assert.equal(
      extractSubagentChildIdFromSessionKey("agent:email_automatic:subagent:d05e53b7-989b-43e6-8de2-a69fd889ef56"),
      "d05e53b7-989b-43e6-8de2-a69fd889ef56",
    );
    assert.equal(extractSubagentChildIdFromSessionKey("agent:a:feishu:oc_x"), undefined);
  });

  it("extractSubagentChildIdFromPromptPreview 从内部事件正文抽 session_key 中的 child UUID", () => {
    const blob = `
[Internal task completion event]
source: subagent
session_key: \`agent:email_automatic:subagent:68702043-413d-481a-9cf9-7588b5968e76\`
session_id: 968144ec-a117-444a-bb9e-b465bea6ee24
`;
    assert.equal(extractSubagentChildIdFromPromptPreview(blob), "68702043-413d-481a-9cf9-7588b5968e76");
    assert.equal(extractSubagentChildIdFromPromptPreview(""), undefined);
  });

  it("extractRequesterThreadIdFromOpenClawSessionContext 从 systemPrompt 取父会话键", () => {
    const sys = `## Session Context
- **Requester session:** agent:xiaohongshu_ai:feishu:group:oc_4a1b9cecd1b85d8f92f8c472c6306e49.
- **Your session:** agent:xiaohongshu_ai:subagent:9d236944-4064-446c-9bf1-9aeb7396ca38.
`;
    assert.equal(
      extractRequesterThreadIdFromOpenClawSessionContext(sys),
      "agent:xiaohongshu_ai:feishu:group:oc_4a1b9cecd1b85d8f92f8c472c6306e49",
    );
    assert.equal(extractRequesterThreadIdFromOpenClawSessionContext(""), undefined);
  });

  it("extractSubagentSessionKeyFromText 从 metadata.run_id 解析完整 subagent_thread_id", () => {
    const runId =
      "announce:v1:agent:email_automatic:subagent:d05e53b7-989b-43e6-8de2-a69fd889ef56:ccf3a2c3-f98a-4e74-9dc3-8c7824af1443";
    assert.equal(
      extractSubagentSessionKeyFromText(runId),
      "agent:email_automatic:subagent:d05e53b7-989b-43e6-8de2-a69fd889ef56",
    );
  });

  it("traceSessionKeyCandidatesForInbound 并集 event.from 与 ForPending（deferred flush）", () => {
    const ctx = { channelId: "feishu/oc_z" };
    const from = "oc_z";
    const merged = traceSessionKeyCandidatesForInbound(ctx, from);
    for (const k of traceSessionKeyCandidates(ctx, from)) {
      assert.ok(merged.includes(k), `missing ${k}`);
    }
    for (const k of traceSessionKeyCandidatesForPending(ctx)) {
      assert.ok(merged.includes(k), `missing ${k}`);
    }
  });

  it("isOpenClawParentRoutingSessionKey 区分父路由与子代理 session", () => {
    assert.equal(isOpenClawParentRoutingSessionKey("agent:email_automatic:feishu:group:oc_x"), true);
    assert.equal(
      isOpenClawParentRoutingSessionKey("agent:email_automatic:subagent:d05e53b7-989b-43e6-8de2-a69fd889ef56"),
      false,
    );
  });

  it("pickCanonicalTraceThreadId 优先 ctx.sessionKey 父路由，其次候选中的 agent:…", () => {
    const sk = "agent:email_automatic:feishu:group:oc_ab";
    assert.equal(
      pickCanonicalTraceThreadId(
        { sessionKey: sk, agentId: "email_automatic" },
        ["feishu/oc_ab", "feishu/oc_ab\x1fagent:email_automatic"],
      ),
      sk,
    );
    assert.equal(
      pickCanonicalTraceThreadId(
        { agentId: "email_automatic", channelId: "feishu/oc_ab" },
        ["feishu/oc_ab", sk],
      ),
      sk,
    );
  });

  it("hasOpenClawParentRoutingSessionHint 在仅有 feishu/oc 桶与 \\x1fagent 别名时为 false", () => {
    assert.equal(
      hasOpenClawParentRoutingSessionHint(
        { agentId: "email_automatic", channelId: "feishu/oc_ab" },
        ["feishu/oc_ab", "feishu/oc_ab\x1fagent:email_automatic"],
      ),
      false,
    );
  });
});
