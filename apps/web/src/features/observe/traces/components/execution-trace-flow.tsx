"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import "@xyflow/react/dist/style.css";
import "./execution-trace-flow.css";
import { IconClose } from "@arco-design/web-react/icon";
import { Maximize2, MessageSquare, Minimize2, ShieldAlert } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { ArchPipelineNode } from "@/components/arch-pipeline-node";
import { TraceSpanRunPanel } from "@/features/observe/traces/components/trace-span-run-panel";
import { Drawer, DrawerClose } from "@/components/ui/drawer";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import {
  buildArchitecturePipelineGraph,
  layoutArchitecturePipeline,
  pickPrimaryTraceContext,
  type ArchPipelineNodeData,
} from "@/lib/execution-architecture-overview";
import {
  layoutDagreTb,
  refineLlmToolFanoutLayout,
  EXEC_GRAPH_NODE_W,
} from "@/lib/execution-graph-layout";
import { loadExecutionGraph, type ExecutionGraphNodeDto } from "@/lib/execution-graph";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { formatDurationMs } from "@/lib/trace-records";
import { LlmModelIcon, MemoryBranchesIcon, ToolWrenchIcon } from "@/icons";
import { cn } from "@/lib/utils";

const NODE_W = EXEC_GRAPH_NODE_W;
/** Includes inner “call time” strip. */
const NODE_H = 118;
const NODE_TRACE_H = 72;
/** Extra height when showing tool batch mode (parallel/sequential). */
const NODE_TOOL_MODE_EXTRA = 16;
/** 合并画布：流水线在上，Span dagre 在下，纵向留白。 */
const MERGED_SPAN_GRAPH_Y_OFFSET = 200;

/** 边颜色（与边类型对应）。不使用 strokeDasharray，以便 React Flow `animated` 的流动虚线动画生效。 */
function edgeStrokeForKind(edgeKind: string): string {
  switch (edgeKind) {
    case "cross_trace":
      return "rgb(139 92 246)";
    case "trace_lineage":
      return "rgb(236 72 153)";
    case "trace_to_root":
      return "rgb(148 163 184)";
    case "span_parent_parallel":
      return "rgb(34 197 94)";
    case "span_parent_sequential":
      return "rgb(217 119 6)";
    case "span_parent_memory":
      return "rgb(245 158 11)";
    default:
      return "rgb(100 116 139)";
  }
}

function spanKindBorder(kind: string): string {
  const k = kind.toUpperCase();
  if (k === "LLM") {
    return "border-sky-400/80 bg-sky-500/10";
  }
  if (k === "TOOL") {
    return "border-emerald-400/80 bg-emerald-500/10";
  }
  if (k === "SKILL") {
    return "border-violet-400/80 bg-violet-500/10";
  }
  if (k === "MEMORY") {
    return "border-amber-400/80 bg-amber-500/10";
  }
  if (k === "AGENT_LOOP") {
    return "border-orange-400/80 bg-orange-500/10";
  }
  if (k === "GUARDRAIL") {
    return "border-red-400/70 bg-red-500/10";
  }
  return "border-neutral-400/70 bg-neutral-500/10";
}

function traceKindBorder(kind: string): string {
  if (kind.includes("EXTERNAL")) {
    return "border-sky-500/80 bg-sky-500/15";
  }
  if (kind.includes("SUBAGENT")) {
    return "border-violet-500/80 bg-violet-500/15";
  }
  if (kind.includes("ASYNC")) {
    return "border-amber-500/80 bg-amber-500/15";
  }
  if (kind.includes("SYSTEM")) {
    return "border-neutral-500/80 bg-neutral-500/15";
  }
  return "border-slate-400/80 bg-slate-500/10";
}

function callTimeLabel(d: ExecutionGraphNodeDto): { main: string; dur: string | null } {
  if (d.node_role === "trace") {
    const ms = d.created_at_ms ?? null;
    const main = ms != null && ms > 0 ? formatTraceDateTimeFromMs(ms) : "—";
    const dm = d.duration_ms;
    if (dm != null && Number.isFinite(dm) && dm > 0) {
      return { main, dur: formatDurationMs(dm) };
    }
    return { main, dur: null };
  }
  const st = d.start_time_ms ?? null;
  const en = d.end_time_ms ?? null;
  const main = st != null && st > 0 ? formatTraceDateTimeFromMs(st) : "—";
  let dur: string | null = null;
  if (st != null && en != null && en >= st) {
    dur = formatDurationMs(en - st);
  } else {
    const dm = d.duration_ms;
    if (dm != null && Number.isFinite(dm) && dm > 0) {
      dur = formatDurationMs(dm);
    }
  }
  return { main, dur };
}

function spanKindDisplay(kind: string, t: (key: string) => string): string {
  const k = kind.toUpperCase();
  switch (k) {
    case "LLM":
      return t("execKindLLM");
    case "TOOL":
      return t("execKindTOOL");
    case "SKILL":
      return t("execKindSKILL");
    case "MEMORY":
      return t("execKindMEMORY");
    case "AGENT_LOOP":
      return t("execKindAGENT_LOOP");
    case "GUARDRAIL":
      return t("execKindGUARDRAIL");
    case "IO":
      return t("execKindIO");
    default:
      return kind;
  }
}

const ExecFlowNode = memo(function ExecFlowNodeFn(props: NodeProps) {
  const t = useTranslations("Traces");
  const d = (props.data as { payload: ExecutionGraphNodeDto }).payload;
  const isTrace = d.node_role === "trace";

  const title = isTrace ? t("execNodeTraceTitle") : d.name?.trim() || d.kind;

  const kindDisplay = (() => {
    if (isTrace) {
      if (d.kind.includes("EXTERNAL")) {
        return t("execKindTraceExternal");
      }
      if (d.kind.includes("SUBAGENT")) {
        return t("execKindTraceSubagent");
      }
      if (d.kind.includes("ASYNC")) {
        return t("execKindTraceAsync");
      }
      if (d.kind.includes("SYSTEM")) {
        return t("execKindTraceSystem");
      }
      return d.trace_type;
    }
    return spanKindDisplay(d.kind, t);
  })();

  const { main: callTimeMain, dur: callTimeDur } = callTimeLabel(d);
  const batchMode = d.tool_execution_mode ?? null;
  const showToolBatch =
    batchMode === "parallel" || batchMode === "sequential";

  const ci = !isTrace ? (d.crabagent_interception ?? null) : null;
  const secHit =
    ci && typeof ci.hit_count === "number" && Number.isFinite(ci.hit_count) ? Math.max(0, ci.hit_count) : 0;
  const secIntercepted = ci?.intercepted === true;
  const secMode = typeof ci?.mode === "string" && ci.mode ? String(ci.mode) : "—";
  const showSec = !isTrace && secHit > 0;

  return (
    <div
      className={cn(
        "relative w-[230px] rounded-lg border-2 px-2 py-1.5 text-left text-[10px] shadow-sm",
        "bg-card text-card-foreground",
        isTrace ? traceKindBorder(d.kind) : spanKindBorder(d.kind),
        showSec &&
          (secIntercepted
            ? "border-amber-500/90 ring-1 ring-amber-500/40"
            : "border-slate-400/85 ring-1 ring-slate-400/30 dark:border-zinc-500/80 dark:ring-zinc-500/25"),
      )}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-slate-400"
      />
      <div className="mb-1 rounded border border-border/80 bg-muted/30 px-1.5 py-0.5 text-[9px] leading-snug">
        <span className="text-muted-foreground">{t("execNodeCallTime")}</span>
        <span className="ml-1 font-medium text-foreground">{callTimeMain}</span>
        {callTimeDur ? <span className="text-muted-foreground"> · {callTimeDur}</span> : null}
      </div>
      <div className="font-mono text-[9px] leading-tight text-muted-foreground">{d.id}</div>
      <div className="mt-0.5 flex items-start gap-1.5">
        {isTrace ? (
          <MessageSquare
            className={cn(
              "mt-0.5 size-4 shrink-0",
              d.kind.includes("EXTERNAL")
                ? "text-sky-600 dark:text-sky-400"
                : d.kind.includes("SUBAGENT")
                  ? "text-violet-600 dark:text-violet-400"
                  : d.kind.includes("ASYNC")
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
            )}
            strokeWidth={2}
            aria-hidden
          />
        ) : d.kind === "MEMORY" ? (
          <MemoryBranchesIcon
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
        ) : d.kind === "TOOL" ? (
          <ToolWrenchIcon
            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        ) : d.kind === "LLM" ? (
          <LlmModelIcon
            className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400"
            aria-hidden
          />
        ) : null}
        <div className="line-clamp-2 min-w-0 flex-1 text-[11px] font-semibold leading-snug">{title}</div>
        {showSec ? (
          <span
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            title={t("execNodeSecurityTooltip", { count: secHit, mode: secMode })}
            aria-label={t("execNodeSecurityTooltip", { count: secHit, mode: secMode })}
          >
            <ShieldAlert className="size-4" strokeWidth={2} aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div className="flex justify-between gap-2">
          <span>{t("traceGraphType")}</span>
          <span className="shrink-0 font-medium text-foreground">{kindDisplay}</span>
        </div>
        {!isTrace ? (
          <>
            <div className="flex justify-between gap-2 tabular-nums">
              <span>{t("traceGraphTokens")}</span>
              <span className="font-medium text-foreground">{d.total_tokens.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{t("traceGraphModel")}</span>
              <span className="line-clamp-1 text-right font-medium text-foreground">{d.model ?? "—"}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between gap-2 tabular-nums">
              <span>{t("traceGraphTokens")}</span>
              <span className="font-medium text-foreground">{d.total_tokens.toLocaleString()}</span>
            </div>
            <div className="text-[9px] text-muted-foreground">
              {t("execNodeTraceHint", { tt: d.trace_type })}
            </div>
          </>
        )}
        {isTrace && showToolBatch ? (
          <div className="mt-0.5 rounded border border-emerald-500/25 bg-emerald-500/10 px-1 py-0.5 text-[9px] leading-tight text-foreground">
            <span className="text-muted-foreground">{t("execNodeToolBatch")}</span>
            <span className="ml-1 font-semibold">
              {batchMode === "parallel" ? t("execToolBatchParallel") : t("execToolBatchSequential")}
            </span>
          </div>
        ) : null}
        {!isTrace && d.kind === "LLM" && showToolBatch ? (
          <div className="mt-0.5 rounded border border-sky-500/30 bg-sky-500/10 px-1 py-0.5 text-[9px] leading-tight">
            <span className="text-muted-foreground">{t("execNodeToolBatch")}</span>
            <span className="ml-1 font-semibold text-foreground">
              {batchMode === "parallel" ? t("execToolBatchParallel") : t("execToolBatchSequential")}
            </span>
          </div>
        ) : null}
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-slate-400"
      />
    </div>
  );
});

const nodeTypes = { execCard: ExecFlowNode, archPipeline: ArchPipelineNode };

function FitViewOnChange({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.14, duration: 280 });
    });
    return () => cancelAnimationFrame(id);
  }, [layoutKey, fitView]);
  return null;
}

export type ExecutionTraceFlowProps = {
  variant: "conversation" | "trace";
  baseUrl: string;
  apiKey: string;
  /** Conversation drawer: main thread key. */
  threadId?: string;
  /** Message detail: single trace id. */
  traceId?: string;
  maxNodes?: number;
  className?: string;
  onOpenTrace?: (traceId: string) => void;
  onSelectSpan?: (spanId: string) => void;
};

export type ExecutionTraceFlowVariant = ExecutionTraceFlowProps["variant"];

function ExecutionTraceFlowInner({
  variant,
  baseUrl,
  apiKey,
  threadId,
  traceId,
  maxNodes = 500,
  className,
  onOpenTrace,
  onSelectSpan,
}: ExecutionTraceFlowProps) {
  const t = useTranslations("Traces");
  const [spanStepDrawer, setSpanStepDrawer] = useState<{ traceId: string; spanId: string } | null>(null);
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const graphShellRef = useRef<HTMLDivElement>(null);
  const focusTraceId = variant === "trace" ? traceId?.trim() : undefined;

  useEffect(() => {
    const onFs = () => {
      setGraphFullscreen(document.fullscreenElement === graphShellRef.current);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleGraphFullscreen = useCallback(() => {
    const el = graphShellRef.current;
    if (!el) {
      return;
    }
    if (!document.fullscreenElement) {
      const req = el.requestFullscreen?.bind(el) ?? (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen?.bind(el);
      void req?.();
    } else {
      void document.exitFullscreen?.();
    }
  }, []);

  const q = useQuery({
    queryKey: [
      COLLECTOR_QUERY_SCOPE.executionGraph,
      variant,
      baseUrl,
      apiKey,
      threadId ?? "",
      traceId ?? "",
      maxNodes,
    ],
    queryFn: () =>
      loadExecutionGraph(baseUrl, apiKey, {
        threadId: variant === "conversation" ? threadId : undefined,
        traceId: variant === "trace" ? traceId : undefined,
        maxNodes,
      }),
    enabled:
      baseUrl.trim().length > 0 &&
      (variant === "conversation" ? Boolean(threadId?.trim()) : Boolean(traceId?.trim())),
  });

  const spanStepQuery = useQuery({
    queryKey: [
      COLLECTOR_QUERY_SCOPE.traceSpans,
      "execution-graph-span-drawer",
      baseUrl,
      apiKey,
      spanStepDrawer?.traceId ?? "",
    ],
    queryFn: () => loadSemanticSpans(baseUrl, apiKey, spanStepDrawer!.traceId),
    enabled:
      spanStepDrawer != null &&
      baseUrl.trim().length > 0 &&
      apiKey.trim().length > 0 &&
      spanStepDrawer.traceId.trim().length > 0,
  });

  const drawerSpanRow = useMemo(() => {
    if (!spanStepDrawer) {
      return null;
    }
    return spanStepQuery.data?.items.find((s) => s.span_id === spanStepDrawer.spanId) ?? null;
  }, [spanStepDrawer, spanStepQuery.data?.items]);

  const { initialNodes, initialEdges } = useMemo(() => {
    const data = q.data;
    if (!data?.nodes.length) {
      return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };
    }

    const heights = new Map<string, number>();
    const execNodes: Node[] = data.nodes.map((n) => {
      const mode = n.tool_execution_mode ?? null;
      const hasMode = mode === "parallel" || mode === "sequential";
      let h = NODE_H;
      if (n.node_role === "trace") {
        h = hasMode ? NODE_TRACE_H + NODE_TOOL_MODE_EXTRA : NODE_TRACE_H;
      } else if (n.kind === "LLM" && hasMode) {
        h = NODE_H + NODE_TOOL_MODE_EXTRA;
      }
      heights.set(n.id, h);
      return {
        id: n.id,
        type: "execCard",
        position: { x: 0, y: 0 },
        data: { payload: n },
      };
    });

    const execEdges: Edge[] = data.edges.map((e) => {
      const stroke = edgeStrokeForKind(e.edge_kind);
      const showFanoutLabel =
        e.edge_kind === "span_parent_parallel" || e.edge_kind === "span_parent_sequential";
      const label =
        e.edge_kind === "span_parent_parallel"
          ? t("execEdgeLabelParallel")
          : e.edge_kind === "span_parent_sequential"
            ? t("execEdgeLabelSequential")
            : undefined;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: "out",
        targetHandle: "in",
        animated: true,
        data: { edgeKind: e.edge_kind, toolBatchMode: e.tool_batch_mode ?? null },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
        style: { strokeWidth: 1.35, stroke },
        ...(showFanoutLabel && label
          ? {
              label,
              labelStyle:
                e.edge_kind === "span_parent_parallel"
                  ? { fill: "rgb(22 163 74)", fontSize: 11, fontWeight: 600 }
                  : { fill: "rgb(194 65 12)", fontSize: 11, fontWeight: 600 },
              labelBgStyle: { fill: "rgb(255 255 255)", fillOpacity: 0.9 },
              labelBgPadding: [4, 4] as [number, number],
            }
          : {}),
      };
    });

    const { nodes: pipelineNodes, edges: pipelineEdges } = buildArchitecturePipelineGraph(data, {
      focusTraceId,
    });
    if (pipelineNodes.length === 0) {
      const laid = layoutDagreTb(execNodes, execEdges, heights);
      const refined = refineLlmToolFanoutLayout(laid, data, heights);
      return { initialNodes: refined, initialEdges: execEdges };
    }

    const ctx = pickPrimaryTraceContext(data, { focusTraceId });
    const laidPipeline = layoutArchitecturePipeline(pipelineNodes).map((n) => ({
      ...n,
      data: { ...(n.data as ArchPipelineNodeData), showFrameworkBridge: true },
    }));
    const laidSpansRaw = layoutDagreTb(execNodes, execEdges, heights);
    const laidSpansRefined = refineLlmToolFanoutLayout(laidSpansRaw, data, heights);
    const laidSpans = laidSpansRefined.map((n) => ({
      ...n,
      position: {
        x: n.position.x,
        y: n.position.y + MERGED_SPAN_GRAPH_Y_OFFSET,
      },
    }));

    const bridgeEdges: Edge[] = [];
    const hasId = (id: string) => data.nodes.some((n) => n.id === id);
    const pushBridge = (id: string, source: string, target: string) => {
      if (!hasId(target)) {
        return;
      }
      bridgeEdges.push({
        id,
        source,
        target,
        sourceHandle: "bridge",
        targetHandle: "in",
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: "rgb(100 116 139)",
        },
        style: {
          strokeWidth: 1.35,
          stroke: "rgb(100 116 139)",
          strokeDasharray: "5 4",
        },
        zIndex: -2,
      });
    };

    if (ctx) {
      pushBridge("fw-br-runner", "arch-runner", ctx.traceHeaderNodeId);
      if (ctx.primaryLlm?.id) {
        pushBridge("fw-br-llm", "arch-llm", ctx.primaryLlm.id);
      }
      if (ctx.firstToolLike?.id) {
        pushBridge("fw-br-tools", "arch-tools", ctx.firstToolLike.id);
      }
    }

    return {
      initialNodes: [...laidPipeline, ...laidSpans],
      initialEdges: [...pipelineEdges, ...execEdges, ...bridgeEdges],
    };
  }, [q.data, focusTraceId, t]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const fitViewLayoutKey = useMemo(
    () =>
      `${initialNodes.length}:${initialEdges.length}:${graphFullscreen ? "fs" : "in"}`,
    [initialNodes.length, initialEdges.length, graphFullscreen],
  );

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const id = typeof node.id === "string" ? node.id.trim() : "";
      if (!id) {
        return;
      }
      if (node.type === "archPipeline") {
        const d = node.data as ArchPipelineNodeData;
        if (d.stage === "llm" && d.llmSpanId) {
          setSpanStepDrawer({ traceId: d.traceId, spanId: d.llmSpanId });
          onSelectSpan?.(d.llmSpanId);
        }
        return;
      }
      const payload = (node.data as { payload?: ExecutionGraphNodeDto } | undefined)?.payload;
      if (payload?.node_role === "span") {
        setSpanStepDrawer({ traceId: payload.trace_id, spanId: id });
        onSelectSpan?.(id);
        return;
      }
      if (id.startsWith("th:")) {
        const tid = id.slice(3);
        onOpenTrace?.(tid);
        return;
      }
      onSelectSpan?.(id);
    },
    [onOpenTrace, onSelectSpan],
  );

  if (q.isLoading) {
    return (
      <div className={cn("flex min-h-[280px] flex-1 items-center justify-center gap-2 text-sm text-muted-foreground", className)}>
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        {t("loading")}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className={cn("min-h-[280px] flex-1 p-4 text-sm text-destructive", className)}>{String(q.error)}</div>
    );
  }

  if (!q.data?.nodes.length) {
    return (
      <div className={cn("min-h-[280px] flex-1 p-4 text-sm text-muted-foreground", className)}>
        {t("executionGraphEmpty")}
      </div>
    );
  }

  return (
    <div
      ref={graphShellRef}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col bg-background",
        graphFullscreen && "h-screen min-h-screen rounded-none border-0",
        className,
      )}
    >
      {q.data.truncated ? (
        <p className="shrink-0 border-b border-border bg-amber-500/10 px-3 py-2 text-[11px] text-amber-950 dark:text-amber-200/90">
          {t("executionGraphTruncated", { max: String(q.data.max_nodes) })}
        </p>
      ) : null}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-1.5">
        <p className="min-w-0 flex-1 text-[10px] leading-snug text-muted-foreground">{t("executionGraphMergedLegend")}</p>
        <button
          type="button"
          onClick={toggleGraphFullscreen}
          className="shrink-0 rounded-md border border-border bg-muted/40 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-pressed={graphFullscreen}
          aria-label={graphFullscreen ? t("executionGraphFullscreenExit") : t("executionGraphFullscreen")}
          title={graphFullscreen ? t("executionGraphFullscreenExit") : t("executionGraphFullscreen")}
        >
          {graphFullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
        </button>
      </div>
      <div
        className={cn(
          "relative w-full min-h-0 flex-1",
          graphFullscreen ? "" : "min-h-[min(65vh,520px)]",
        )}
      >
        <ReactFlow
          className="exec-flow-graph"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.08}
          maxZoom={1.6}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "smoothstep", animated: true }}
        >
          <FitViewOnChange layoutKey={fitViewLayoutKey} />
          <Background gap={14} size={1} />
          <Controls showInteractive={false} />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>
      {(onOpenTrace || onSelectSpan) && (
        <p className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          {t("executionGraphMergedClickHint")}
        </p>
      )}

      <Drawer
        open={spanStepDrawer != null}
        onOpenChange={(open) => {
          if (!open) {
            setSpanStepDrawer(null);
          }
        }}
        width="min(100vw - 1rem, 44rem)"
        wrapClassName="ca-arco-app-drawer-wrap--overlay"
      >
        <div className="flex h-full min-h-[min(400px,70dvh)] min-w-0 flex-col overflow-hidden bg-background">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{t("executionGraphSpanStepTitle")}</h2>
            <DrawerClose
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("threadDrawerCloseAria")}
            >
              <IconClose className="size-5" aria-hidden />
            </DrawerClose>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {spanStepQuery.isLoading ? (
              <div className="flex min-h-[200px] flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <span className="inline-block size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                {t("loading")}
              </div>
            ) : spanStepQuery.isError ? (
              <p className="p-4 text-sm text-destructive">{String(spanStepQuery.error)}</p>
            ) : drawerSpanRow ? (
              <TraceSpanRunPanel span={drawerSpanRow} chrome="embedded" />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("executionGraphSpanNotFound")}</p>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}

export function ExecutionTraceFlow(props: ExecutionTraceFlowProps) {
  return (
    <ReactFlowProvider>
      <ExecutionTraceFlowInner {...props} />
    </ReactFlowProvider>
  );
}
