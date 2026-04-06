/**
 * usage 字段别名与字符串数字收敛；运行：`pnpm --filter @crabagent/web test`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateThreadLlmOutputUsage, usageFromTracePayload } from "./trace-payload-usage";

describe("usageFromTracePayload", () => {
  it("Anthropic 顶层 input_tokens / output_tokens", () => {
    const u = usageFromTracePayload({
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    assert.equal(u.prompt, 10);
    assert.equal(u.completion, 20);
    assert.equal(u.prompt + u.completion, 30);
  });

  it("Gemini usageMetadata：promptTokenCount / candidatesTokenCount", () => {
    const u = usageFromTracePayload({
      usage: {
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      },
    });
    assert.equal(u.prompt, 3);
    assert.equal(u.completion, 4);
  });

  it("字符串数字与分项合计", () => {
    const u = usageFromTracePayload({
      usage: { prompt_tokens: "12", completion_tokens: "34" },
    });
    assert.equal(u.prompt, 12);
    assert.equal(u.completion, 34);
  });

  it("嵌套 usage.usage 与 usageMetadata", () => {
    const u = usageFromTracePayload({
      usage: {
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          usageMetadata: { totalTokenCount: 99 },
        },
      },
    });
    assert.equal(u.prompt, 1);
    assert.equal(u.completion, 2);
    assert.equal(u.total, 99);
  });

  it("顶层 usageMetadata 补充", () => {
    const u = usageFromTracePayload({
      usage: {},
      usageMetadata: { promptTokenCount: 7, outputTokenCount: 8 },
    });
    assert.equal(u.prompt, 7);
    assert.equal(u.completion, 8);
  });
});

describe("aggregateThreadLlmOutputUsage", () => {
  it("汇总多条 llm_output", () => {
    const agg = aggregateThreadLlmOutputUsage([
      { type: "llm_output", payload: { usage: { input_tokens: 1, output_tokens: 2 } } },
      { type: "llm_output", payload: { usage: { prompt_tokens: 3, completion_tokens: 4 } } },
      { type: "message_received", payload: {} },
    ]);
    assert.equal(agg.llmOutputCount, 2);
    assert.equal(agg.prompt, 4);
    assert.equal(agg.completion, 6);
    assert.equal(agg.displayTotal, 10);
  });

  it("仅有 API total_tokens、无分项时计入 displayTotal", () => {
    const agg = aggregateThreadLlmOutputUsage([
      { type: "llm_output", payload: { usage: { total_tokens: 42 } } },
    ]);
    assert.equal(agg.prompt, 0);
    assert.equal(agg.completion, 0);
    assert.equal(agg.displayTotal, 42);
  });

  it("有分项时 displayTotal 不含 cache_read", () => {
    const agg = aggregateThreadLlmOutputUsage([
      {
        type: "llm_output",
        payload: { usage: { prompt_tokens: 100, completion_tokens: 50, cache_read_tokens: 999 } },
      },
    ]);
    assert.equal(agg.cacheRead, 999);
    assert.equal(agg.displayTotal, 150);
  });
});
