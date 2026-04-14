import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RedactionRule } from "./redactor.js";
import { deepSanitizeStrings, type ExtendedRedactionRule } from "./vault-pipeline.js";

function rulesEmailMask(): ExtendedRedactionRule[] {
  const base: RedactionRule = {
    id: "e1",
    name: "email",
    pattern: String.raw`\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b`,
    redactType: "mask",
    targets: [],
    enabled: true,
  };
  return [{ ...base, policyAction: "data_mask", severity: "high" }];
}

describe("vault-pipeline", () => {
  it("deepSanitizeStrings 掩码嵌套字符串中的邮箱", () => {
    const rules = rulesEmailMask();
    const email = "u@example.com";
    const out = deepSanitizeStrings({ a: { t: `mail ${email}` } }, rules, { vault: null, vaultEnabled: false });
    const t = (out.value as { a: { t: string } }).a.t;
    assert.ok(!t.includes(email));
    assert.ok(out.replacements >= 1);
  });

  it("多策略命中时 input_guard 优先于 data_mask（与规则数组顺序无关）", () => {
    const pat = String.raw`\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b`;
    const maskRule: ExtendedRedactionRule = {
      id: "z-mask",
      name: "mask-email",
      pattern: pat,
      redactType: "mask",
      targets: [],
      enabled: true,
      policyAction: "data_mask",
    };
    const guardRule: ExtendedRedactionRule = {
      id: "a-guard",
      name: "guard-email",
      pattern: pat,
      redactType: "block",
      targets: [],
      enabled: true,
      policyAction: "input_guard",
    };
    const email = "u@example.com";
    const rulesWrongOrder: ExtendedRedactionRule[] = [maskRule, guardRule];
    const out = deepSanitizeStrings({ t: `x ${email} y` }, rulesWrongOrder, { vault: null, vaultEnabled: false });
    const t = (out.value as { t: string }).t;
    assert.ok(t.includes("[REDACTED_POLICY]"));
    assert.ok(!t.includes(email));
    assert.equal(out.block, false);
  });

  it("多策略命中时 abort_run 优先于 input_guard", () => {
    const pat = String.raw`\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b`;
    const guardRule: ExtendedRedactionRule = {
      id: "g1",
      name: "guard",
      pattern: pat,
      redactType: "block",
      targets: [],
      enabled: true,
      policyAction: "input_guard",
    };
    const abortRule: ExtendedRedactionRule = {
      id: "a1",
      name: "abort",
      pattern: pat,
      redactType: "block",
      targets: [],
      enabled: true,
      policyAction: "abort_run",
    };
    const email = "u@example.com";
    const out = deepSanitizeStrings({ t: email }, [guardRule, abortRule], { vault: null, vaultEnabled: false });
    assert.equal(out.block, true);
    assert.deepEqual(out.value, { t: email });
  });
});
