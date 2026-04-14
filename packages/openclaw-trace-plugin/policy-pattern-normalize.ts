/**
 * 策略正则：仅 trim，与 Collector / 插件内 `new RegExp(source, "g")` 语义一致。
 */
export function normalizePolicyPatternForMatching(pattern: string): string {
  return String(pattern ?? "").trim();
}

/** @returns 供 `new RegExp(source, flags)` 使用的拆分；flags 固定为 `g`。 */
export function normalizePolicyPatternForJsRegExp(pattern: string): { source: string; flags: string } {
  const source = normalizePolicyPatternForMatching(pattern);
  return { source, flags: "g" };
}
