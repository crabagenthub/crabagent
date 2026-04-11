import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpanRecordsWhere, mapSpanRecordRow } from "./span-records-query.js";

describe("buildSpanRecordsWhere", () => {
  it("timeout filter requires non-empty error_info (aligns list_status CASE; avoids success rows whose output mentions timeout)", () => {
    const { whereSql } = buildSpanRecordsWhere({
      limit: 10,
      offset: 0,
      order: "desc",
      listStatuses: ["timeout"],
    });
    assert.match(whereSql, /error_info_json/);
    assert.match(whereSql, /<> ''/);
  });

  it("spanType=llm adds span_type predicate", () => {
    const { whereSql } = buildSpanRecordsWhere({
      limit: 10,
      offset: 0,
      order: "desc",
      spanType: "llm",
    });
    assert.match(whereSql, /lower\(s\.span_type\)/);
    assert.match(whereSql, /\?/);
  });
});

describe("mapSpanRecordRow", () => {
  it("parses usage_json for prompt/completion/cache alongside total_tokens expr", () => {
    const row = mapSpanRecordRow({
      span_id: "s1",
      trace_id: "t1",
      parent_span_id: null,
      name: "x",
      span_type: "llm",
      start_time_ms: 1,
      end_time_ms: 2,
      duration_ms: 1,
      model: "gpt",
      provider: null,
      is_complete: 1,
      input_preview: null,
      output_preview: null,
      thread_key: "tk",
      workspace_name: "default",
      project_name: "openclaw",
      agent_name: null,
      channel_name: null,
      total_tokens: 99,
      usage_json: JSON.stringify({ prompt_tokens: 40, completion_tokens: 50, cache_read_tokens: 9, total_tokens: 99 }),
      list_status: "success",
    });
    assert.equal(row.prompt_tokens, 40);
    assert.equal(row.completion_tokens, 50);
    assert.equal(row.cache_read_tokens, 9);
    assert.equal(row.total_tokens, 99);
  });

  it("derives duration_ms from end - start when duration_ms is null", () => {
    const row = mapSpanRecordRow({
      span_id: "s1",
      trace_id: "t1",
      parent_span_id: null,
      name: "x",
      span_type: "tool",
      start_time_ms: 1000,
      end_time_ms: 1350,
      duration_ms: null,
      model: null,
      provider: null,
      is_complete: 1,
      input_preview: null,
      output_preview: null,
      thread_key: "tk",
      workspace_name: "default",
      project_name: "openclaw",
      agent_name: null,
      channel_name: null,
      total_tokens: 0,
      usage_json: null,
      list_status: "success",
    });
    assert.equal(row.duration_ms, 350);
  });
});
