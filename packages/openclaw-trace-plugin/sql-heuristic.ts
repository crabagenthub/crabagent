/**
 * 轻量启发式：判断工具输出是否像大量 SQL / 数据库 dump（用于可选截断或标记）。
 * 无 NLP，仅关键字 + 长度，避免阻塞热路径。
 */
const SQLISH = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|UNION|CREATE\s+TABLE)\b/gi;

export function looksLikeSqlDump(text: string, opts?: { minLen?: number }): boolean {
  const minLen = opts?.minLen ?? 800;
  if (text.length < minLen) {
    return false;
  }
  const hits = (text.match(SQLISH) ?? []).length;
  return hits >= 3;
}
