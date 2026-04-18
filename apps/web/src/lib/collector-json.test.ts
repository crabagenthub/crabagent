/**
 * 运行：`pnpm --filter @crabagent/web test`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectorErrorMessage,
  collectorItemsArray,
  parseCollectorBody,
  readCollectorFetchResult,
  readCollectorHealthResult,
  unwrapCollectorResult,
} from "./collector-json";

describe("collector-json：仅 Go 信封", () => {
  it("拒绝顶层直出业务 JSON", () => {
    const legacy = { items: [{ id: 1 }], total: 1 };
    assert.throws(() => unwrapCollectorResult(legacy), /envelope/);
    assert.throws(() => parseCollectorBody(legacy), /envelope/);
  });

  it("无 code/request_id 的 result 键不视为信封", () => {
    const ambiguous = { result: "payload", foo: 1 };
    assert.throws(() => unwrapCollectorResult(ambiguous), /envelope/);
  });

  it("Go 信封解包到 result", () => {
    const env = {
      code: 200,
      message: "",
      request_id: "rid-1",
      result: { items: [], total: 0 },
    };
    assert.deepEqual(unwrapCollectorResult(env), { items: [], total: 0 });
  });

  it("collectorErrorMessage：信封顶层 message", () => {
    const raw = { code: 400, message: "bad", request_id: "r", result: null };
    assert.equal(collectorErrorMessage(raw), "bad");
  });

  it("collectorErrorMessage：Go WriteErrorResponse message.global", () => {
    const raw = {
      success: false,
      code: "ParamError",
      message: { global: "参数无效" },
      status: 400,
      log_id: "x",
    };
    assert.equal(collectorErrorMessage(raw), "参数无效");
  });

  it("collectorErrorMessage：顶层 error 字符串", () => {
    assert.equal(collectorErrorMessage({ error: "unauthorized" }), "unauthorized");
  });

  it("readCollectorFetchResult：成功解包信封", async () => {
    const res = new Response(
      JSON.stringify({ code: 200, message: "", request_id: "r1", result: { items: [1], total: 1 } }),
      { status: 200 },
    );
    const data = await readCollectorFetchResult<{ items: number[]; total: number }>(res);
    assert.deepEqual(data, { items: [1], total: 1 });
  });

  it("readCollectorFetchResult：HTTP 200 且 JSON 为 null 时返回空对象", async () => {
    const res = new Response(JSON.stringify(null), { status: 200 });
    const data = await readCollectorFetchResult<{ items?: number[] }>(res);
    assert.deepEqual(data, {});
  });

  it("readCollectorFetchResult：信封 result 为数组时原样返回（如策略列表）", async () => {
    const res = new Response(
      JSON.stringify({ code: 200, message: "", request_id: "r-arr", result: [{ id: "a" }] }),
      { status: 200 },
    );
    const data = await readCollectorFetchResult<{ id: string }[]>(res);
    assert.deepEqual(data, [{ id: "a" }]);
  });

  it("collectorItemsArray：非数组返回空数组", () => {
    assert.deepEqual(collectorItemsArray<number>({ a: 1 }), []);
    assert.deepEqual(collectorItemsArray<number>(null), []);
    assert.deepEqual(collectorItemsArray<number>([2, 3]), [2, 3]);
  });

  it("readCollectorFetchResult：失败抛出信封 message", async () => {
    const res = new Response(
      JSON.stringify({ code: 400, message: "bad request", request_id: "r2", result: null }),
      { status: 400 },
    );
    await assert.rejects(readCollectorFetchResult(res, "fallback"), (e: Error) => {
      assert.equal(e.message, "bad request");
      return true;
    });
  });

  it("readCollectorFetchResult：失败且无服务端文案时用 fallback", async () => {
    const res = new Response(JSON.stringify({}), { status: 502 });
    await assert.rejects(readCollectorFetchResult(res, "自定义失败"), (e: Error) => {
      assert.equal(e.message, "自定义失败");
      return true;
    });
  });

  it("readCollectorFetchResult：HTTP 200 但信封 code>=400 仍视为失败", async () => {
    const res = new Response(
      JSON.stringify({
        code: 503,
        message: "upstream timeout",
        request_id: "r3",
        result: null,
      }),
      { status: 200 },
    );
    await assert.rejects(readCollectorFetchResult(res, "fallback"), (e: Error) => {
      assert.equal(e.message, "upstream timeout");
      return true;
    });
  });

  it("readCollectorFetchResult：HTTP 200 信封 code>=400 且无 message 时用 HTTP code 文案", async () => {
    const res = new Response(
      JSON.stringify({ code: 500, request_id: "r4", result: null }),
      { status: 200 },
    );
    await assert.rejects(readCollectorFetchResult(res), (e: Error) => {
      assert.equal(e.message, "HTTP 500");
      return true;
    });
  });

  it("readCollectorHealthResult：非信封顶层 health 拒绝", async () => {
    const body = { ok: true, service: "crabagent-collector" };
    const res = new Response(JSON.stringify(body), { status: 200 });
    await assert.rejects(readCollectorHealthResult(res), /envelope/);
  });

  it("readCollectorHealthResult：Go 信封解包 result", async () => {
    const inner = { ok: true, service: "crabagent-collector-go", primary_ready: true };
    const res = new Response(
      JSON.stringify({ code: 200, message: "", request_id: "h1", result: inner }),
      { status: 200 },
    );
    const data = await readCollectorHealthResult<typeof inner>(res);
    assert.deepEqual(data, inner);
  });
});
