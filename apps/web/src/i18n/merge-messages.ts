/** 将英文文案作为基底合并进目标 locale，避免漏键时客户端出现 MISSING_MESSAGE。 */
export function deepMergeMessages(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const b = result[key];
    const o = override[key];
    if (
      o !== undefined &&
      o !== null &&
      typeof o === "object" &&
      !Array.isArray(o) &&
      b !== null &&
      typeof b === "object" &&
      !Array.isArray(b)
    ) {
      result[key] = deepMergeMessages(b as Record<string, unknown>, o as Record<string, unknown>);
    } else {
      result[key] = o;
    }
  }
  return result;
}
