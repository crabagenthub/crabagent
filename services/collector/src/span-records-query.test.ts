import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSpanRecordRow } from "./span-records-query.js";

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
});
