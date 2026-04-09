export type RedactionType = "mask" | "hash" | "block";

export interface RedactionRule {
  id: string;
  name: string;
  pattern: string; // RegExp string
  redactType: RedactionType;
  targets: string[]; // e.g. ["input_json", "output_json", "prompt", "assistantTexts"]
  enabled: boolean;
}

export class Redactor {
  private rules: RedactionRule[] = [];
  private regexCache: Map<string, RegExp> = new Map();

  constructor(rules: RedactionRule[] = []) {
    this.updateRules(rules);
  }

  updateRules(rules: RedactionRule[]) {
    this.rules = rules.filter((r) => r.enabled);
    this.regexCache.clear();
    for (const rule of this.rules) {
      try {
        this.regexCache.set(rule.id, new RegExp(rule.pattern, "g"));
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
      const regex = this.regexCache.get(rule.id);
      if (!regex) continue;

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
