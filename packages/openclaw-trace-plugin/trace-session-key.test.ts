import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentScopedTraceKey,
  parseRoutingKindFromSessionKey,
  resolvePrimaryTraceKey,
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
});
