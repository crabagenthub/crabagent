import { sortRulesByPolicyPriority } from "./policy-priority.js";
import { normalizePolicyPatternForJsRegExp } from "./policy-pattern-normalize.js";

export type RedactionType = "mask" | "hash" | "block";

export interface RedactionRule {
  id: string;
  name: string;
  pattern: string; // RegExp string
  redactType: RedactionType;
  targets: string[]; // e.g. ["input_json", "output_json", "prompt", "assistantTexts"]
  enabled: boolean;
  /** Collector 扩展字段：严重等级 */
  severity?: string;
  /** 策略动作（与 redactType 并存时优先语义以本字段为准，见 vault-pipeline） */
  policyAction?: string;
}

export type RedactionAuditFinding = {
  policy_id: string;
  policy_name: string;
  match_count: number;
  policy_action: string;
  redact_type: RedactionType;
};

export type RedactionAuditInterceptionMeta = {
  version: number;
  intercepted: boolean;
  mode: "enforce" | "observe";
  hit_count: number;
  tags: string[];
  policy_ids: string[];
};

export type RedactionAuditSummary = {
  findings: RedactionAuditFinding[];
  hit_count: number;
  intercepted: number;
  observe_only: number;
  interception: RedactionAuditInterceptionMeta | null;
};

export class Redactor {
  private rules: RedactionRule[] = [];
  private regexCache: Map<string, RegExp> = new Map();

  constructor(rules: RedactionRule[] = []) {
    this.updateRules(rules);
  }

  updateRules(rules: RedactionRule[]) {
    this.rules = sortRulesByPolicyPriority(rules.filter((r) => r.enabled));
    this.regexCache.clear();
    for (const rule of this.rules) {
      try {
        const { source, flags } = normalizePolicyPatternForJsRegExp(rule.pattern);
        this.regexCache.set(rule.id, new RegExp(source, flags));
      } catch (err) {
        console.error(`[Redactor] Invalid pattern for rule ${rule.id}: ${rule.pattern}`, err);
      }
    }
  }

  /**
   * 递归遍历并脱敏对象中的指定字段。
   * 如果字段名在 targets 中，或者字段值是字符串且包含敏感信息（可选策略）。
   */
  redactObject(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    const newObj: any = { ...obj };
    for (const key in newObj) {
      const value = newObj[key];

      // 1. 如果值是字符串，尝试对所有规则进行全局脱敏（不限于特定 key）
      if (typeof value === "string") {
        newObj[key] = this.redactString(value);
      } 
      // 2. 如果值是对象/数组，递归处理
      else if (typeof value === "object") {
        newObj[key] = this.redactObject(value);
      }
    }
    return newObj;
  }

  redactString(text: string): string {
    let result = text;
    for (const rule of this.rules) {
      const action = String(rule.policyAction ?? (rule.redactType === "block" ? "abort_run" : "data_mask"))
        .trim()
        .toLowerCase();
      if (action === "abort_run" || action === "audit_only") {
        continue;
      }
      const regex = this.regexCache.get(rule.id);
      if (!regex) continue;

      try {
        result = result.replace(regex, (match) => {
          switch (rule.redactType) {
            case "mask":
              return this.applyMask(match);
            case "hash":
              return `[HASH:${this.simpleHash(match)}]`;
            case "block":
              return "[REDACTED]";
            default:
              return match;
          }
        });
      } catch (err) {
        console.error(`[Redactor] match/replace failed rule=${rule.id} name=${rule.name ?? ""}`, err);
      } finally {
        try {
          regex.lastIndex = 0;
        } catch {
          /* ignore */
        }
      }
    }
    return result;
  }

  scanObject(obj: unknown): RedactionAuditSummary {
    if (!obj || typeof obj !== "object") {
      return { findings: [], hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
    }
    let text = "";
    try {
      text = JSON.stringify(obj);
    } catch {
      text = "";
    }
    if (!text) {
      return { findings: [], hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
    }

    const findings: RedactionAuditFinding[] = [];
    for (const rule of this.rules) {
      const regex = this.regexCache.get(rule.id);
      if (!regex) {
        continue;
      }
      let n = 0;
      try {
        regex.lastIndex = 0;
        for (;;) {
          const m = regex.exec(text);
          if (!m) {
            break;
          }
          n += 1;
          if (m[0] === "") {
            regex.lastIndex += 1;
          }
          if (n > 10_000) {
            break;
          }
        }
      } catch (err) {
        console.error(`[Redactor] scan exec failed rule=${rule.id} name=${rule.name ?? ""}`, err);
        n = 0;
      } finally {
        try {
          regex.lastIndex = 0;
        } catch {
          /* ignore */
        }
      }
      if (n <= 0) {
        continue;
      }
      const action = (rule.policyAction ?? "data_mask").toLowerCase();
      findings.push({
        policy_id: rule.id,
        policy_name: rule.name ?? rule.id,
        match_count: n,
        policy_action: action,
        redact_type: rule.redactType,
      });
    }

    if (findings.length === 0) {
      return { findings, hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
    }
    const hit_count = findings.reduce((s, f) => s + f.match_count, 0);
    let enforceHit = false;
    let observeHit = false;
    for (const f of findings) {
      if (f.policy_action === "audit_only") {
        observeHit = true;
        continue;
      }
      enforceHit = true;
    }
    const intercepted = enforceHit ? 1 : 0;
    const observe_only = observeHit && !enforceHit ? 1 : 0;
    const interception: RedactionAuditInterceptionMeta = {
      version: 1,
      intercepted: enforceHit,
      mode: enforceHit ? "enforce" : "observe",
      hit_count,
      tags: [...new Set(findings.map((f) => f.policy_name))],
      policy_ids: [...new Set(findings.map((f) => f.policy_id))],
    };
    return { findings, hit_count, intercepted, observe_only, interception };
  }

  private applyMask(match: string): string {
    if (match.length <= 4) return "****";
    // 保留前后部分，中间遮蔽
    const prefixLen = Math.floor(match.length / 4);
    const suffixLen = Math.floor(match.length / 4);
    const maskLen = match.length - prefixLen - suffixLen;
    return (
      match.slice(0, prefixLen) +
      "*".repeat(maskLen) +
      match.slice(match.length - suffixLen)
    );
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
