import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSpanTypeToApi } from "./semantic-spans-query.js";

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
