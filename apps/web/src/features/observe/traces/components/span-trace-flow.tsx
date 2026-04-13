"use client";

import { useTranslations } from "next-intl";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { memo, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { buildSpanForest, type SpanTreeNode } from "@/lib/build-span-tree";
import { collectSkillsUsedFromSemanticSpans } from "@/lib/trace-skills-used";
import { cn } from "@/lib/utils";

const NODE_W = 220;
const NODE_H = 108;

function layoutDagreTb(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) {
    return [];
  }
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 56, marginx: 16, marginy: 16 });
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    if (!pos) {
      return { ...n, position: { x: 0, y: 0 } };
    }
    return {
      ...n,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    };
  });
}

function collectSpanNodesEdges(roots: SpanTreeNode[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const walk = (n: SpanTreeNode) => {
    nodes.push({
      id: n.span_id,
      type: "spanCard",
      position: { x: 0, y: 0 },
      data: { payload: n },
    });
    for (const c of n.children) {
      edges.push({
        id: `${n.span_id}->${c.span_id}`,
        source: n.span_id,
        target: c.span_id,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "rgb(100 116 139)" },
        style: { strokeWidth: 1.25, stroke: "rgb(148 163 184)" },
      });
      walk(c);
    }
  };
  for (const r of roots) {
    walk(r);
  }
  return { nodes, edges };
}

const SpanFlowCard = memo(function SpanFlowCardFn(props: NodeProps) {
  const t = useTranslations("Traces");
  const n = (props.data as { payload: SpanTreeNode }).payload;
  const tok = n.total_tokens;
  const model = n.model_name?.trim() || "—";
  const typeClass =
    n.type === "LLM" || n.type === "TOOL" || n.type === "SKILL"
      ? n.type === "SKILL"
        ? "border-violet-400/70 bg-violet-500/10"
        : n.type === "LLM"
          ? "border-sky-400/70 bg-sky-500/10"
          : "border-emerald-400/70 bg-emerald-500/10"
      : "border-neutral-400/60 bg-neutral-500/10";

  return (
    <div
      className={cn(
        "w-[220px] rounded-lg border-2 px-2 py-1.5 text-left text-[10px] shadow-sm",
        "bg-card text-card-foreground",
        typeClass,
      )}
    >
      <div className="font-mono text-[9px] text-muted-foreground">{n.span_id}</div>
      <div className="mt-0.5 line-clamp-2 text-[11px] font-semibold leading-snug">{n.name || n.type}</div>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{t("traceGraphType")}</span>
          <span className="font-medium text-foreground">{n.type}</span>
        </div>
        <div className="flex justify-between gap-2 tabular-nums">
          <span>{t("traceGraphTokens")}</span>
          <span className="font-medium text-foreground">
            {tok != null && Number.isFinite(tok) ? tok.toLocaleString() : "—"}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{t("traceGraphModel")}</span>
          <span className="line-clamp-1 text-right font-medium text-foreground" title={model}>
            {model}
          </span>
        </div>
      </div>
    </div>
  );
});

const nodeTypes = { spanCard: SpanFlowCard };

export type SpanTraceFlowProps = {
  items: SemanticSpanRow[];
  /** When true, only show LLM / TOOL / SKILL / AGENT_LOOP / MEMORY (drops noisy IO). */
  semanticOnly?: boolean;
  className?: string;
};

function filterSemantic(items: SemanticSpanRow[]): SemanticSpanRow[] {
  const keep = new Set(["LLM", "TOOL", "SKILL", "AGENT_LOOP", "MEMORY", "GUARDRAIL"]);
  return items.filter((s) => keep.has(s.type));
}

function SpanTraceFlowInner({ items, semanticOnly = true, className }: SpanTraceFlowProps) {
  const t = useTranslations("Traces");
  const rows = useMemo(() => (semanticOnly ? filterSemantic(items) : items), [items, semanticOnly]);

  const { initialNodes, initialEdges } = useMemo(() => {
    if (rows.length === 0) {
      return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };
    }
    const forest = buildSpanForest(rows);
    const { nodes, edges } = collectSpanNodesEdges(forest);
    const laid = layoutDagreTb(nodes, edges);
    return { initialNodes: laid, initialEdges: edges };
  }, [rows]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const skillsSummary = useMemo(() => collectSkillsUsedFromSemanticSpans(rows), [rows]);

  if (rows.length === 0) {
    return (
      <div className={cn("flex min-h-[200px] items-center p-4 text-sm text-muted-foreground", className)}>
        {t("spanFlowNoSpans")}
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      {skillsSummary.length > 0 ? (
        <div className="shrink-0 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{t("traceGraphSkills")}: </span>
          {skillsSummary.map((s) => s.label).join(", ")}
        </div>
      ) : null}
      <div className="relative min-h-[min(60vh,480px)] w-full flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.15}
          maxZoom={1.5}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={14} size={1} />
          <Controls showInteractive={false} />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>
    </div>
  );
}

export function SpanTraceFlow(props: SpanTraceFlowProps) {
  return (
    <ReactFlowProvider>
      <SpanTraceFlowInner {...props} />
    </ReactFlowProvider>
  );
}
