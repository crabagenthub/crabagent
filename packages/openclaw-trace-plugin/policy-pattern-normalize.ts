/**
 * 与 Collector 侧语义一致：修正常见笔误，使 `mysql+pymysql://`、句末匹配等能命中。
 */
export function normalizePolicyPatternForMatching(pattern: string): string {
  let p = String(pattern ?? "").trim();
  if (!p) {
    return p;
  }
  p = p.replace(new RegExp("\\\\b\\(\\s+\\(", "g"), "\\b((");
  if (!p.includes("mysql(?:\\+")) {
    p = p.replace(/\(\?:mysql\|/gi, "(?:mysql(?:\\+[a-zA-Z0-9]+)?|");
    p = p.replace(/\(\?:mariadb\|/gi, "(?:mariadb(?:\\+[a-zA-Z0-9]+)?|");
    p = p.replace(/\|mysql\|/gi, "|mysql(?:\\+[a-zA-Z0-9]+)?|");
    p = p.replace(/\|mariadb\|/gi, "|mariadb(?:\\+[a-zA-Z0-9]+)?|");
    // URI 方案兼容：mysql:// 与 mariadb:// 扩展到 mysql+driver:// 形态
    p = p.replace(/mysql:\\\/\\\//gi, "mysql(?:\\\\+[a-zA-Z0-9]+)?:\\\\/\\\\/");
    p = p.replace(/mariadb:\\\/\\\//gi, "mariadb(?:\\\\+[a-zA-Z0-9]+)?:\\\\/\\\\/");
    // 兼容历史模板仅匹配 `mysql:host=...`：补充 mysql:// 与 mysql+driver://
    p = p.replace(
      /mysql:host=\\S\+/gi,
      "(?:mysql(?:\\\\+[a-zA-Z0-9]+)?:\\\\/\\\\/\\\\S+|mysql:host=\\\\S+)",
    );
  }
  p = p.replace(/\]\+\s+\|/g, "]+|");
  p = p.replace(/\s+\)\s*(\(\?=\[\\s"'\u0060\]\|\$\))/g, ")$1");
  return p;
}

/**
 * 兼容历史 PCRE 前缀 `(?i)`：JS 不支持该分组，转换为 `i` flag。
 */
export function normalizePolicyPatternForJsRegExp(pattern: string): { source: string; flags: string } {
  let source = normalizePolicyPatternForMatching(pattern);
  let flags = "g";
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    flags += "i";
  }
  // 兼容 `/.../i` 形式：Collector 可能存入带分隔符的表达式。
  if (source.startsWith("/")) {
    let slashPos = -1;
    for (let i = source.length - 1; i > 0; i -= 1) {
      if (source[i] !== "/") {
        continue;
      }
      let bs = 0;
      for (let j = i - 1; j >= 0 && source[j] === "\\"; j -= 1) {
        bs += 1;
      }
      if (bs % 2 === 0) {
        slashPos = i;
        break;
      }
    }
    if (slashPos > 0) {
      const suffix = source.slice(slashPos + 1).trim();
      if (!suffix || /^[a-z]+$/i.test(suffix)) {
        source = source.slice(1, slashPos);
        for (const ch of suffix) {
          if (!flags.includes(ch)) {
            flags += ch;
          }
        }
      }
    }
  }
  return { source, flags };
}
