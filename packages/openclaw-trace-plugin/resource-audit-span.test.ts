import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichToolSpanResourceAudit } from "./resource-audit-span.js";

describe("enrichToolSpanResourceAudit", () => {
  it("tags read_file with file resource", () => {
    const span: Record<string, unknown> = {
      type: "tool",
      name: "read_file",
      input: { params: { path: "/proj/README.md" } },
      output: { result: "hello world content" },
    };
    enrichToolSpanResourceAudit(span);
    const meta = span.metadata as Record<string, unknown>;
    assert.equal(meta.semantic_kind, "file");
    const res = meta.resource as Record<string, unknown>;
    assert.equal(res.uri, "/proj/README.md");
    assert.equal(res.access_mode, "read");
    assert.ok(Number(res.chars) > 0);
    assert.ok(String(res.snippet).includes("hello"));
  });

  it("tags ReadFile with file resource", () => {
    const span: Record<string, unknown> = {
      type: "tool",
      name: "ReadFile",
      input: { params: { path: "/proj/IDENTITY.md" } },
      output: { result: "identity content" },
    };
    enrichToolSpanResourceAudit(span);
    const meta = span.metadata as Record<string, unknown>;
    assert.equal(meta.semantic_kind, "file");
    const res = meta.resource as Record<string, unknown>;
    assert.equal(res.uri, "/proj/IDENTITY.md");
    assert.equal(res.access_mode, "read");
  });

  it("tags memory_search as MEMORY with top_k", () => {
    const span: Record<string, unknown> = {
      type: "tool",
      name: "memory_search",
      input: { params: { query: "billing" } },
      output: {
        result: {
          hits: [{ snippet: "line1", score: 0.82 }],
        },
      },
    };
    enrichToolSpanResourceAudit(span);
    const meta = span.metadata as Record<string, unknown>;
    assert.equal(meta.semantic_kind, "memory");
    assert.ok(String((meta.resource as { uri?: string }).uri).includes("memory://"));
    const out = span.output as Record<string, unknown>;
    assert.ok(Array.isArray(out.top_k));
  });

  it("ignores non-tool spans", () => {
    const span: Record<string, unknown> = { type: "llm", name: "gpt" };
    enrichToolSpanResourceAudit(span);
    assert.equal(span.metadata, undefined);
  });

  it("tags skills.run with semantic_kind skill from params", () => {
    const span: Record<string, unknown> = {
      type: "tool",
      name: "skills.run",
      input: { params: { skillId: "weather_lookup", skillName: "Weather" } },
      output: { result: { ok: true } },
    };
    enrichToolSpanResourceAudit(span);
    const meta = span.metadata as Record<string, unknown>;
    assert.equal(meta.semantic_kind, "skill");
    assert.equal(meta.skill_id, "weather_lookup");
    assert.equal(meta.skill_name, "Weather");
  });

  it("tags arbitrary tool when params carry skill_id only", () => {
    const span: Record<string, unknown> = {
      type: "tool",
      name: "custom_gateway_tool",
      input: { params: { skill_id: "docs-qa" } },
      output: { result: {} },
    };
    enrichToolSpanResourceAudit(span);
    const meta = span.metadata as Record<string, unknown>;
    assert.equal(meta.semantic_kind, "skill");
    assert.equal(meta.skill_id, "docs-qa");
    assert.equal(meta.skill_name, "docs-qa");
  });
});
