import {
  effectivePolicyActionForPriority,
  policyActionPriorityRank,
} from "./policy-query.js";

export type RedactionType = "mask" | "hash" | "block";

export interface RedactionRule {
  id: string;
  name: string;
  pattern: string;
  redactType: RedactionType;
  targets: string[];
  enabled: boolean;
  severity?: string;
  policyAction?: string;
  interceptMode?: string;
}

function isAuditOnlyAction(action: string | undefined): boolean {
  return String(action ?? "")
    .trim()
    .toLowerCase() === "audit_only";
}

export class Redactor {
  private rules: RedactionRule[] = [];
  private regexCache: Map<string, RegExp> = new Map();

  constructor(rules: RedactionRule[] = []) {
    this.updateRules(rules);
  }

  updateRules(rules: RedactionRule[]) {
    this.rules = rules
      .filter((r) => r.enabled)
      .slice()
      .sort((a, b) => {
        const ra = policyActionPriorityRank(
          effectivePolicyActionForPriority(a.policyAction, a.redactType),
        );
        const rb = policyActionPriorityRank(
          effectivePolicyActionForPriority(b.policyAction, b.redactType),
        );
        if (rb !== ra) {
          return rb - ra;
        }
        return a.id.localeCompare(b.id);
      });
    this.regexCache.clear();
    for (const rule of this.rules) {
      try {
        this.regexCache.set(rule.id, new RegExp(rule.pattern, "g"));
      } catch (err) {
        console.error(`[Redactor] Invalid pattern for rule ${rule.id}: ${rule.pattern}`, err);
      }
    }
  }

  redactObject(obj: unknown): unknown {
    if (!obj || typeof obj !== "object") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }
    const newObj: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    for (const key in newObj) {
      const value = newObj[key];
      if (typeof value === "string") {
        newObj[key] = this.redactString(value);
      } else if (typeof value === "object") {
        newObj[key] = this.redactObject(value);
      }
    }
    return newObj;
  }

  redactString(text: string): string {
    let result = text;
    for (const rule of this.rules) {
      if (isAuditOnlyAction(rule.policyAction)) {
        continue;
      }
      const regex = this.regexCache.get(rule.id);
      if (!regex) {
        continue;
      }
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
    }
    return result;
  }

  private applyMask(match: string): string {
    if (match.length <= 4) {
      return "****";
    }
    const prefixLen = Math.floor(match.length / 4);
    const suffixLen = Math.floor(match.length / 4);
    const maskLen = match.length - prefixLen - suffixLen;
    return match.slice(0, prefixLen) + "*".repeat(maskLen) + match.slice(match.length - suffixLen);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}
