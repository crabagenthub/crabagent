import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "./db.js";
import {
  mapSpanTypeToApi,
  parseUsageExtended,
  querySemanticSpansByTraceId,
  resolveCanonicalTraceIdForSpanQuery,
} from "./semantic-spans-query.js";

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

describe("resolveCanonicalTraceIdForSpanQuery", () => {
  it("resolves thread_key to trace_id when spans exist under UUID", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-span-resolve-"));
    const dbPath = path.join(dir, "t.db");
    const db = openDatabase(dbPath);
    try {
      const threadKey = "agent:main:feishu:group:oc_demo123";
      const traceUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      db.prepare(
        `INSERT INTO opik_threads (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
         VALUES (?, 'default', 'openclaw', 'main', 1, 1)`,
      ).run(threadKey);
      db.prepare(
        `INSERT INTO opik_traces (
          trace_id, thread_id, workspace_name, project_name, trace_type,
          created_at_ms, is_complete, created_from
        ) VALUES (?, ?, 'default', 'openclaw', 'external', 1000, 1, 'test')`,
      ).run(traceUuid, threadKey);
      db.prepare(
        `INSERT INTO opik_spans (span_id, trace_id, name, span_type, is_complete, start_time_ms)
         VALUES ('span-1', ?, 'm', 'llm', 1, 1000)`,
      ).run(traceUuid);

      assert.equal(resolveCanonicalTraceIdForSpanQuery(db, traceUuid), traceUuid);
      assert.equal(resolveCanonicalTraceIdForSpanQuery(db, threadKey), traceUuid);

      const byUuid = querySemanticSpansByTraceId(db, traceUuid);
      const canonicalFromThread = resolveCanonicalTraceIdForSpanQuery(db, threadKey);
      const spansAfterResolve = querySemanticSpansByTraceId(db, canonicalFromThread);
      assert.equal(byUuid.length, 1);
      assert.equal(spansAfterResolve.length, 1);
      assert.equal(spansAfterResolve[0]!.span_id, "span-1");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
