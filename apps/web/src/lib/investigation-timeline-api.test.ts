import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadInvestigationTimeline } from "./investigation-timeline-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("investigation timeline api", () => {
  it("builds query params and unwraps collector envelope", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          code: 200,
          message: "",
          request_id: "rid-itl-1",
          result: {
            items: [
              {
                key: "cmd:span-1",
                event_type: "command",
                time_ms: 1710000000000,
                trace_id: "trace-1",
                span_id: "span-1",
                subject: "ls -la",
                evidence: "exit=0 / risk=false",
                actor: "agent-a",
                target: "ls -la",
                result: "success",
                why_flagged: "heuristic_risk",
                source_page: "/command-analysis",
              },
            ],
            total: 1,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const data = await loadInvestigationTimeline("http://localhost:8080/", "api-key", {
      limit: 120,
      offset: 5,
      order: "desc",
      traceId: "trace-1",
      sinceMs: 1710000000000,
      untilMs: 1710003600000,
      eventType: "command",
      sourcePage: "/command-analysis",
      keyword: "ls -la",
    });

    assert.equal(data.total, 1);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]?.event_type, "command");
    assert.match(requestedUrl, /\/v1\/investigation\/timeline\?/);
    assert.match(requestedUrl, /limit=120/);
    assert.match(requestedUrl, /offset=5/);
    assert.match(requestedUrl, /order=desc/);
    assert.match(requestedUrl, /trace_id=trace-1/);
    assert.match(requestedUrl, /since_ms=1710000000000/);
    assert.match(requestedUrl, /until_ms=1710003600000/);
    assert.match(requestedUrl, /event_type=command/);
    assert.match(requestedUrl, /source_page=%2Fcommand-analysis/);
    assert.match(requestedUrl, /keyword=ls\+-la/);
  });
});
