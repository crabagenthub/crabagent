import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSpanUsagePreviewJson, usagePreviewJsonFromUsage } from "./opik-usage-preview.js";

describe("opik-usage-preview", () => {
  it("usagePreviewJsonFromUsage writes input/output/cacheRead/total", () => {
    assert.equal(
      usagePreviewJsonFromUsage({ total_tokens: 42 }),
      '{"input":0,"output":0,"cacheRead":0,"total":42}',
    );
    assert.equal(
      usagePreviewJsonFromUsage({ prompt_tokens: 10, completion_tokens: 5 }),
      '{"input":10,"output":5,"cacheRead":0,"total":15}',
    );
    assert.equal(
      usagePreviewJsonFromUsage({
        prompt_tokens: 1,
        completion_tokens: 2,
        cache_read_tokens: 3,
      }),
      '{"input":1,"output":2,"cacheRead":3,"total":6}',
    );
  });

  it("resolveSpanUsagePreviewJson prefers usage_preview then usage", () => {
    assert.equal(
      resolveSpanUsagePreviewJson({ usage_preview: '{"total":9}' }, null),
      '{"total":9}',
    );
    assert.equal(
      resolveSpanUsagePreviewJson({ usage: { total_tokens: 7 } }, '{"total":1}'),
      '{"input":0,"output":0,"cacheRead":0,"total":7}',
    );
    assert.equal(resolveSpanUsagePreviewJson({}, '{"total":3}'), '{"total":3}');
  });
});
