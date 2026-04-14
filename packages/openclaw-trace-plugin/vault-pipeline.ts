import type { RedactionRule } from "./redactor.js";
import { Redactor } from "./redactor.js";
import { sortRulesByPolicyPriority } from "./policy-priority.js";
import type { EncryptedVaultStore } from "./vault-store.js";
import { normalizePolicyPatternForJsRegExp } from "./policy-pattern-normalize.js";

export type PolicyAction =
  | "data_mask"
  | "abort_run"
  | "input_guard"
  | "audit_only";

export type ExtendedRedactionRule = RedactionRule & {
  severity?: "low" | "high" | "critical";
  policyAction?: PolicyAction;
};

export type SanitizeOutcome = {
  /** 改写后的对象（深拷贝） */
  value: unknown;
  /** 是否拒写会话（before_message_write block） */
  block: boolean;
  /** enforce 下替换次数 */
  replacements: number;
  /** observe 或双轨：本会话检测到的敏感处数量 */
  shadowHits: number;
};

function applyReplace(
  match: string,
  rule: ExtendedRedactionRule,
  vault: EncryptedVaultStore | null,
  vaultEnabled: boolean,
): string {
  const action = rule.policyAction ?? (rule.redactType === "block" ? "abort_run" : "data_mask");
  switch (action) {
    case "abort_run":
    case "input_guard":
      return "[REDACTED_POLICY]";
    case "audit_only":
      return match;
    case "data_mask":
    default:
      if (vaultEnabled && vault) {
        return vault.putPlaintext(rule.name || "pii", match);
      }
      return new Redactor([rule]).redactString(match);
  }
}

export function compileRules(rules: ExtendedRedactionRule[]): Map<string, RegExp> {
  const m = new Map<string, RegExp>();
  for (const r of rules) {
    if (!r.enabled) {
      continue;
    }
    try {
      const { source, flags } = normalizePolicyPatternForJsRegExp(r.pattern);
      m.set(r.id, new RegExp(source, flags));
    } catch {
      /* skip */
    }
  }
  return m;
}

/**
 * 对单段文本按规则处理：observe 只计数；enforce 替换。
 */
export function processTextSegment(
  text: string,
  rules: ExtendedRedactionRule[],
  regexById: Map<string, RegExp>,
  opts: { vault: EncryptedVaultStore | null; vaultEnabled: boolean },
): { text: string; shadowHits: number; replacements: number; block: boolean } {
  let shadowHits = 0;
  let replacements = 0;
  let block = false;
  let out = text;

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const re = regexById.get(rule.id);
    if (!re) {
      continue;
    }
    const action = rule.policyAction ?? (rule.redactType === "block" ? "abort_run" : "data_mask");
    if (action === "abort_run") {
      re.lastIndex = 0;
      if (re.test(out)) {
        block = true;
        out = "[Crabagent: message blocked by data security policy]";
        replacements += 1;
        break;
      }
      re.lastIndex = 0;
      continue;
    }
    if (action === "audit_only") {
      const m = out.match(re);
      if (m) {
        shadowHits += m.length;
      }
      continue;
    }

    re.lastIndex = 0;
    const newStr = out.replace(re, (match) => {
      replacements += 1;
      return applyReplace(match, rule, opts.vault, opts.vaultEnabled);
    });
    out = newStr;
  }

  return { text: out, shadowHits, replacements, block };
}

export function deepSanitizeStrings(
  input: unknown,
  rules: ExtendedRedactionRule[],
  opts: { vault: EncryptedVaultStore | null; vaultEnabled: boolean },
  precompiledRegexById?: Map<string, RegExp>,
): SanitizeOutcome {
  const orderedRules = sortRulesByPolicyPriority(rules);
  const regexById = precompiledRegexById ?? compileRules(orderedRules);
  let shadowHits = 0;
  let replacements = 0;
  let block = false;

  const walk = (v: unknown): unknown => {
    if (block) {
      return v;
    }
    if (typeof v === "string") {
      const r = processTextSegment(v, orderedRules, regexById, opts);
      shadowHits += r.shadowHits;
      replacements += r.replacements;
      if (r.block) {
        block = true;
      }
      return r.text;
    }
    if (!v || typeof v !== "object") {
      return v;
    }
    if (Array.isArray(v)) {
      return v.map((x) => walk(x));
    }
    const o = v as Record<string, unknown>;
    const next: Record<string, unknown> = { ...o };
    for (const k of Object.keys(next)) {
      next[k] = walk(next[k]);
    }
    return next;
  };

  const value = walk(input);
  return {
    value: block ? input : value,
    block,
    shadowHits,
    replacements,
  };
}
