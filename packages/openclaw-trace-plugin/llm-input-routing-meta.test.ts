import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractLlmInputRoutingMeta,
  extractRoutingFromPendingUserTurn,
  mergeOpenclawRoutingLayers,
  pickLlmInputModelParams,
} from "./llm-input-routing-meta.js";

describe("llm-input-routing-meta", () => {
  it("extractLlmInputRoutingMeta 合并根与 routing 嵌套", () => {
    const out = extractLlmInputRoutingMeta({
      label: "ignored",
      routing: { label: "飞书群", kind: "group", thinking: "inherit" },
    });
    assert.equal(out?.label, "飞书群");
    assert.equal(out?.kind, "group");
    assert.equal(out?.thinking, "inherit");
  });

  it("pickLlmInputModelParams 读取 temperature / topP / maxTokens", () => {
    const mp = pickLlmInputModelParams({ temperature: 0.2, topP: 0.9, maxTokens: 4096 });
    assert.equal(mp?.temperature, 0.2);
    assert.equal(mp?.topP, 0.9);
    assert.equal(mp?.maxTokens, 4096);
  });

  it("pickLlmInputModelParams 接受 snake_case top_p max_tokens", () => {
    const mp = pickLlmInputModelParams({ top_p: 0.5, max_tokens: 100 });
    assert.equal(mp?.topP, 0.5);
    assert.equal(mp?.maxTokens, 100);
  });

  it("extractLlmInputRoutingMeta 读取 options 内字段", () => {
    const out = extractLlmInputRoutingMeta({
      provider: "x",
      options: { thinking: "inherit", fast: "on", label: "opt-label" },
    });
    assert.equal(out?.thinking, "inherit");
    assert.equal(out?.fast, "on");
    assert.equal(out?.label, "opt-label");
  });

  it("extractRoutingFromPendingUserTurn 读取 message_received.metadata", () => {
    const out = extractRoutingFromPendingUserTurn({
      message_received: {
        metadata: { routing: { label: "inbound", verbose: "inherit" } },
      },
    });
    assert.equal(out?.label, "inbound");
    assert.equal(out?.verbose, "inherit");
  });

  it("mergeOpenclawRoutingLayers 后者覆盖前者", () => {
    const m = mergeOpenclawRoutingLayers({ label: "a", kind: "x" }, { label: "b" });
    assert.equal(m?.label, "b");
    assert.equal(m?.kind, "x");
  });

  it("extractLlmInputRoutingMeta 合并 openclawSession（与控制面 SessionEntry 键对齐）", () => {
    const out = extractLlmInputRoutingMeta({
      openclawSession: {
        sessionKey: "agent:x:y",
        kind: "direct",
        label: "工作台",
        thinkingLevel: "inherit",
        fastMode: false,
        verboseLevel: "on",
        reasoningLevel: "medium",
        contextTokens: 200000,
        totalTokens: 42,
      },
    });
    assert.equal(out?.label, "工作台");
    assert.equal(out?.kind, "direct");
    assert.equal(out?.thinking, "inherit");
    assert.equal(out?.fast, false);
    assert.equal(out?.verbose, "on");
    assert.equal(out?.reasoning, "medium");
    assert.equal(out?.max_context_tokens, 200000);
  });

  it("openclawSession 仅含 key/kind 时补齐 inherit（快照省略空档位与未设 fastMode）", () => {
    const out = extractLlmInputRoutingMeta({
      openclawSession: { sessionKey: "agent:main:webchat:u1", kind: "direct" },
    });
    assert.equal(out?.kind, "direct");
    assert.equal(out?.thinking, "inherit");
    assert.equal(out?.fast, "inherit");
    assert.equal(out?.verbose, "inherit");
    assert.equal(out?.reasoning, "inherit");
  });
});
