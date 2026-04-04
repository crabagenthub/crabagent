import dagre from "dagre";
import type { Node } from "@xyflow/react";
import { Position } from "@xyflow/react";
import type { ExecutionGraphResponseDto } from "@/lib/execution-graph";

export const EXEC_GRAPH_NODE_W = 230;
const DEFAULT_NODE_H = 118;

/**
 * Dagre TB 布局；略增大间距以便阅读。
 */
export function layoutDagreTb(
  nodes: Node[],
  edges: import("@xyflow/react").Edge[],
  heights: Map<string, number>,
  nodeWidth = EXEC_GRAPH_NODE_W,
): Node[] {
  if (nodes.length === 0) {
    return [];
  }
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 44,
    ranksep: 80,
    marginx: 32,
    marginy: 32,
    ranker: "network-simplex",
  });
  for (const n of nodes) {
    const h = heights.get(n.id) ?? DEFAULT_NODE_H;
    g.setNode(n.id, { width: nodeWidth, height: h });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    const h = heights.get(n.id) ?? DEFAULT_NODE_H;
    if (!pos) {
      return { ...n, position: { x: 0, y: 0 } };
    }
    return {
      ...n,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - h / 2 },
    };
  });
}

function buildSpanChildrenMap(data: ExecutionGraphResponseDto): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of data.edges) {
    if (!e.edge_kind.startsWith("span_parent") && e.edge_kind !== "trace_to_root") {
      continue;
    }
    const arr = m.get(e.source) ?? [];
    arr.push(e.target);
    m.set(e.source, arr);
  }
  return m;
}

function buildParentMap(data: ExecutionGraphResponseDto): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of data.edges) {
    if (e.edge_kind.startsWith("span_parent") || e.edge_kind === "trace_to_root") {
      m.set(e.target, e.source);
    }
  }
  return m;
}

function depthFromRoots(id: string, parentBy: Map<string, string>): number {
  let d = 0;
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = parentBy.get(cur);
    if (!p) {
      break;
    }
    d++;
    cur = p;
  }
  return d;
}

function collectDescendants(rootId: string, childrenMap: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) {
      continue;
    }
    out.add(id);
    for (const c of childrenMap.get(id) ?? []) {
      stack.push(c);
    }
  }
  return out;
}

/**
 * 在 dagre 结果上优化 LLM→工具 扇出：并行同一行展开，串行按时间自上而下排列并保留子树整体平移。
 */
export function refineLlmToolFanoutLayout(
  laidNodes: Node[],
  data: ExecutionGraphResponseDto,
  heights: Map<string, number>,
  nodeWidth = EXEC_GRAPH_NODE_W,
): Node[] {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const childrenMap = buildSpanChildrenMap(data);
  const parentBy = buildParentMap(data);

  const pos = new Map<string, { x: number; y: number }>();
  for (const n of laidNodes) {
    pos.set(n.id, { x: n.position.x, y: n.position.y });
  }

  const getH = (id: string) => heights.get(id) ?? DEFAULT_NODE_H;

  function moveSubtree(rootId: string, dx: number, dy: number) {
    const desc = collectDescendants(rootId, childrenMap);
    for (const id of desc) {
      const p = pos.get(id);
      if (p) {
        p.x += dx;
        p.y += dy;
      }
    }
  }

  function subtreeBottom(rootId: string): number {
    const desc = collectDescendants(rootId, childrenMap);
    let bottom = -Infinity;
    for (const id of desc) {
      const p = pos.get(id);
      if (!p) {
        continue;
      }
      bottom = Math.max(bottom, p.y + getH(id));
    }
    return bottom;
  }

  const llmNodes = data.nodes.filter((n) => n.node_role === "span" && n.kind === "LLM");
  const sortedLlms = [...llmNodes].sort(
    (a, b) => depthFromRoots(b.id, parentBy) - depthFromRoots(a.id, parentBy),
  );

  const RANK_GAP = 72;
  const H_GAP = 22;

  for (const llm of sortedLlms) {
    const pid = llm.id;
    const parallelEdges = data.edges.filter(
      (e) => e.source === pid && e.edge_kind === "span_parent_parallel",
    );
    const sequentialEdges = data.edges.filter(
      (e) => e.source === pid && e.edge_kind === "span_parent_sequential",
    );

    const sortTargets = (targets: string[]) =>
      [...targets].sort((a, b) => {
        const na = nodeById.get(a);
        const nb = nodeById.get(b);
        const ta = na?.start_time_ms ?? 0;
        const tb = nb?.start_time_ms ?? 0;
        if (ta !== tb) {
          return ta - tb;
        }
        return a.localeCompare(b);
      });

    if (parallelEdges.length > 0) {
      const sorted = sortTargets(parallelEdges.map((e) => e.target));
      const p = pos.get(pid);
      if (!p) {
        continue;
      }
      const h = getH(pid);
      const centerX = p.x + nodeWidth / 2;
      const rowY = p.y + h + RANK_GAP;
      const n = sorted.length;
      const totalW = n * nodeWidth + Math.max(0, n - 1) * H_GAP;
      const leftX = centerX - totalW / 2;
      for (let i = 0; i < n; i++) {
        const tid = sorted[i]!;
        const tp = pos.get(tid);
        if (!tp) {
          continue;
        }
        const nx = leftX + i * (nodeWidth + H_GAP);
        const ny = rowY;
        moveSubtree(tid, nx - tp.x, ny - tp.y);
      }
    } else if (sequentialEdges.length > 0) {
      const sorted = sortTargets(sequentialEdges.map((e) => e.target));
      const p = pos.get(pid);
      if (!p) {
        continue;
      }
      const h = getH(pid);
      let yCursor = p.y + h + RANK_GAP;
      for (const tid of sorted) {
        const tp = pos.get(tid);
        if (!tp) {
          continue;
        }
        const nx = p.x;
        const ny = yCursor;
        moveSubtree(tid, nx - tp.x, ny - tp.y);
        yCursor = subtreeBottom(tid) + RANK_GAP;
      }
    }
  }

  return laidNodes.map((n) => {
    const p = pos.get(n.id);
    if (!p) {
      return n;
    }
    return { ...n, position: { x: p.x, y: p.y } };
  });
}
