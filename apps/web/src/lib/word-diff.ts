/** Tokenize into alternating whitespace runs and word runs for stable diffs. */
export function tokenizeWithWhitespace(s: string): string[] {
  if (!s.length) {
    return [];
  }
  return s.match(/\s+|\S+/g) ?? [];
}

export type DiffChunk = { type: "equal" | "delete" | "insert"; text: string };

const MAX_TOKENS_PER_SIDE = 14_000;
const MAX_DP_CELLS = 2_500_000;

/** Returns null if inputs are too large for interactive word diff (use line-based fallback). */
export function computeWordDiff(before: string, after: string): DiffChunk[] | null {
  const a = tokenizeWithWhitespace(before);
  const b = tokenizeWithWhitespace(after);
  if (a.length > MAX_TOKENS_PER_SIDE || b.length > MAX_TOKENS_PER_SIDE) {
    return null;
  }
  if (a.length * b.length > MAX_DP_CELLS) {
    return null;
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffChunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "delete", text: a[i]! });
      i++;
    } else {
      out.push({ type: "insert", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "delete", text: a[i]! });
    i++;
  }
  while (j < m) {
    out.push({ type: "insert", text: b[j]! });
    j++;
  }
  return mergeChunks(out);
}

function mergeChunks(chunks: DiffChunk[]): DiffChunk[] {
  if (chunks.length === 0) {
    return [];
  }
  const merged: DiffChunk[] = [{ ...chunks[0]! }];
  for (let k = 1; k < chunks.length; k++) {
    const cur = chunks[k]!;
    const prev = merged[merged.length - 1]!;
    if (prev.type === cur.type) {
      prev.text += cur.text;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}
