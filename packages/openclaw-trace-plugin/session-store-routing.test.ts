import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOpenclawSessionShapeFromStoreEntry,
  classifyKindFromStoreEntry,
} from "./session-store-routing.js";
import { extractLlmInputRoutingMeta } from "./llm-input-routing-meta.js";

describe("session-store-routing", () => {
  it("classifyKindFromStoreEntry 尊重 chatType 与 agent: 键", () => {
    assert.equal(
      classifyKindFromStoreEntry("agent:main:feishu:group:oc_x", { chatType: "group" }),
      "group",
    );
    assert.equal(classifyKindFromStoreEntry("agent:main:feishu:user:ou_1", {}), "user");
    assert.equal(classifyKindFromStoreEntry("global", {}), "global");
  });

  it("磁盘 entry 经 openclawSession 形状合并出 label 与 inherit 档位", () => {
    const shape = buildOpenclawSessionShapeFromStoreEntry("agent:main:feishu:group:oc_x", {
      label: "群公告",
      thinkingLevel: "",
      fastMode: true,
      contextTokens: 204800,
      totalTokens: 35214,
    });
    const out = extractLlmInputRoutingMeta({ openclawSession: shape });
    assert.equal(out?.label, "群公告");
    assert.equal(out?.kind, "group");
    assert.equal(out?.thinking, "inherit");
    assert.equal(out?.fast, true);
    assert.equal(out?.max_context_tokens, 204800);
  });
});
