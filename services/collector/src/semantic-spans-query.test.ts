import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSpanTypeToApi, parseUsageExtended } from "./semantic-spans-query.js";

describe("mapSpanTypeToApi", () => {
  it("tool + explicit semantic_kind memory", () => {
    assert.equal(mapSpanTypeToApi("tool", "x", { semantic_kind: "memory" }), "MEMORY");
    assert.equal(mapSpanTypeToApi("tool", "x", { semanticKind: "memory" }), "MEMORY");
  });

  it("tool + memory:// resource without semantic_kind", () => {
    assert.equal(
      mapSpanTypeToApi("tool", "search", {
        resource: { uri: "memory://search?q=hi", access_mode: "read" },
      }),
      "MEMORY",
    );
  });

  it("tool + name heuristics when metadata empty", () => {
    assert.equal(mapSpanTypeToApi("tool", "memory_search", {}), "MEMORY");
    assert.equal(mapSpanTypeToApi("tool", "kb_vector_search", {}), "MEMORY");
    assert.equal(mapSpanTypeToApi("tool", "read", {}), "TOOL");
  });

  it("skills.* wins over generic tool", () => {
    assert.equal(mapSpanTypeToApi("tool", "skills.run", {}), "SKILL");
  });
});

describe("parseUsageExtended", () => {
  it("maps top-level input/output numeric aliases to prompt/completion", () => {
    const u = parseUsageExtended(JSON.stringify({ input: 12, output: 34 }));
    assert.equal(u.prompt_tokens, 12);
    assert.equal(u.completion_tokens, 34);
    assert.ok(u.total_tokens != null && u.total_tokens >= 46);
  });

  it("reads top-level cacheRead and total (Opik span usage_json shape)", () => {
    const u = parseUsageExtended(
      JSON.stringify({ input: 100, output: 20, total: 500, cacheRead: 380 }),
    );
    assert.equal(u.prompt_tokens, 100);
    assert.equal(u.completion_tokens, 20);
    assert.equal(u.cache_read_tokens, 380);
    assert.equal(u.total_tokens, 500);
  });
});
