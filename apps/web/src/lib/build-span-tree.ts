import type { SemanticSpanRow } from "@/lib/semantic-spans";

export type SpanTreeNode = SemanticSpanRow & {
  children: SpanTreeNode[];
  loopRound?: number;
};

export function assignLoopRounds(rows: SemanticSpanRow[]): Map<string, number> {
  const loops = rows
    .filter((r) => r.type === "AGENT_LOOP")
    .sort((a, b) => a.start_time - b.start_time || a.span_id.localeCompare(b.span_id));
  const m = new Map<string, number>();
  loops.forEach((r, i) => m.set(r.span_id, i + 1));
  return m;
}

export function buildSpanForest(rows: SemanticSpanRow[]): SpanTreeNode[] {
  const loopRounds = assignLoopRounds(rows);
  const map = new Map<string, SpanTreeNode>();
  for (const r of rows) {
    map.set(r.span_id, { ...r, children: [], loopRound: loopRounds.get(r.span_id) });
  }
  const roots: SpanTreeNode[] = [];
  for (const n of map.values()) {
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  const sortCh = (a: SpanTreeNode, b: SpanTreeNode) =>
    a.start_time - b.start_time || a.span_id.localeCompare(b.span_id);
  function sortRecursive(nodes: SpanTreeNode[]) {
    nodes.sort(sortCh);
    for (const c of nodes) {
      if (c.children.length) {
        sortRecursive(c.children);
      }
    }
  }
  sortRecursive(roots);
  return roots;
}

/** Keep nodes whose name/type/id matches, or that have matching descendants. */
export function filterSpanForest(forest: SpanTreeNode[], query: string): SpanTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return forest;
  }
  const walk = (n: SpanTreeNode): SpanTreeNode | null => {
    const kids = n.children.map(walk).filter((x): x is SpanTreeNode => x != null);
    const self =
      n.name.toLowerCase().includes(q) ||
      n.type.toLowerCase().includes(q) ||
      n.span_id.toLowerCase().includes(q);
    if (self || kids.length > 0) {
      return { ...n, children: kids };
    }
    return null;
  };
  return forest.map(walk).filter((x): x is SpanTreeNode => x != null);
}
