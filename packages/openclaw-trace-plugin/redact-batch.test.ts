/**
 * 仅验证插件侧 `redactBatch`：不依赖 Collector。
 * 运行：`pnpm --filter @crabagent/openclaw-trace-plugin exec tsx --test redact-batch.test.ts`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RedactionRule } from "./redactor.js";
import { OpikOpenClawRuntime } from "./opik-runtime.js";

const EMAIL_RE =
  String.raw`\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b`;

function rulesEmailMask(): RedactionRule[] {
  return [
    {
      id: "email-rule",
      name: "email",
      pattern: EMAIL_RE,
      redactType: "mask",
      targets: [],
      enabled: true,
    },
  ];
}

describe("redactBatch（插件侧脱敏）", () => {
  it("遮蔽 traces / spans 内嵌字符串中的邮箱", () => {
    const email = "719756455@qq.com";
    const rt = new OpikOpenClawRuntime("default", "openclaw", { redactionRules: rulesEmailMask() });
    const out = rt.redactBatch({
      traces: [
        {
          trace_id: "t1",
          input: {
            promptPreview: `现在我的邮箱是 ${email} 没有改变`,
            list_input_preview: email,
          },
        },
      ],
      spans: [
        {
          span_id: "s1",
          trace_id: "t1",
          input: { promptPreview: `邮箱 ${email}` },
        },
      ],
    });
    const trIn = out.traces?.[0]?.input as Record<string, unknown> | undefined;
    const spIn = out.spans?.[0]?.input as Record<string, unknown> | undefined;
    assert.ok(trIn && typeof trIn.promptPreview === "string");
    assert.ok(spIn && typeof spIn.promptPreview === "string");
    assert.ok(!String(trIn.promptPreview).includes(email));
    assert.ok(!String(trIn.list_input_preview).includes(email));
    assert.ok(!String(spIn.promptPreview).includes(email));
  });

  it("遮蔽 attachments / feedback / envelope_json 中的邮箱", () => {
    const email = "user@example.com";
    const rt = new OpikOpenClawRuntime("default", "openclaw", { redactionRules: rulesEmailMask() });
    const out = rt.redactBatch({
      attachments: [{ attachment_id: "a1", payload: { note: `contact ${email}` } }],
      feedback: [{ trace_id: "t1", name: "s", value: 1, reason: email }],
      envelope_json: { preview: `x ${email} y` },
    });
    const att = out.attachments?.[0] as Record<string, unknown> | undefined;
    const pay = att?.payload as Record<string, unknown> | undefined;
    assert.ok(pay && typeof pay.note === "string" && !pay.note.includes(email));
    const fb = out.feedback?.[0] as Record<string, unknown> | undefined;
    assert.ok(fb && typeof fb.reason === "string" && !fb.reason.includes(email));
    const env = out.envelope_json as Record<string, unknown> | undefined;
    assert.ok(env && typeof env.preview === "string" && !env.preview.includes(email));
  });
});
