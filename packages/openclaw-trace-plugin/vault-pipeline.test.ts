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
  return [{ ...base, interceptMode: "enforce", policyAction: "mask", severity: "high" }];
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
});
