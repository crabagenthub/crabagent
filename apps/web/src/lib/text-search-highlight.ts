/** Split `text` into segments for optional search-term highlighting (case-insensitive). */
export function splitHighlight(text: string, q: string): { hit: boolean; v: string }[] {
  const query = q.trim();
  if (!query) {
    return [{ hit: false, v: text }];
  }
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc, "gi");
  const out: { hit: boolean; v: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const s = text;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      out.push({ hit: false, v: s.slice(last, m.index) });
    }
    out.push({ hit: true, v: m[0] });
    last = m.index + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex += 1;
    }
  }
  if (last < s.length) {
    out.push({ hit: false, v: s.slice(last) });
  }
  return out.length > 0 ? out : [{ hit: false, v: text }];
}
