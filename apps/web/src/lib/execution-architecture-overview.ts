import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import {
  inferInboundChannelFromThreadKey,
  type PipelineInboundChannel,
} from "@/lib/arch-pipeline-channel";
import type { ExecutionGraphNodeDto, ExecutionGraphResponseDto } from "@/lib/execution-graph";

export type { PipelineInboundChannel } from "@/lib/arch-pipeline-channel";

export type ArchPipelineStage =
  | "inbound"
  | "gateway"
  | "runner"
  | "llm"
  | "tools"
  | "response";

export type ArchPipelineNodeData = {
  stage: ArchPipelineStage;
  /** 入站阶段：由 thread_key 推断的渠道（用于图标）。 */
  inboundChannel?: PipelineInboundChannel;
  /** 合并画布时向下连到 Span 明细的桥接边（Runner / LLM / Tools）。 */
  showFrameworkBridge?: boolean;
  /** First LLM span id in this trace (opens step drawer). */
  llmSpanId?: string | null;
  traceId: string;
  modelLabel?: string | null;
  providerLabel?: string | null;
  toolNames: string[];
  toolMode: "parallel" | "sequential" | null;
  llmRoundCount: number;
  hasToolLoopBack: boolean;
};

const PIPELINE_NODE_W = 208;
const PIPELINE_NODE_H = 108;

export function architecturePipelineNodeSize(): { w: number; h: number } {
  return { w: PIPELINE_NODE_W, h: PIPELINE_NODE_H };
}

/** 选出主 trace（会话图取最新或 focus）及其 span 切片，供流水线与合并画布复用。 */
export function pickPrimaryTraceContext(
  data: ExecutionGraphResponseDto,
  options?: { focusTraceId?: string },
): {
  primary: ExecutionGraphNodeDto;
  traceId: string;
  traceHeaderNodeId: string;
  spans: ExecutionGraphNodeDto[];
  llmSpans: ExecutionGraphNodeDto[];
  toolLike: ExecutionGraphNodeDto[];
  primaryLlm: ExecutionGraphNodeDto | undefined;
  firstToolLike: ExecutionGraphNodeDto | undefined;
  inboundChannel: PipelineInboundChannel;
} | null {
  const traceHeaders = data.nodes.filter((n) => n.node_role === "trace");
  const focus = options?.focusTraceId?.trim();
  let primary: ExecutionGraphNodeDto | undefined = traceHeaders.find(
    (t) => t.trace_id === focus || t.id === `th:${focus}`,
  );
  if (!primary) {
    primary = [...traceHeaders].sort((a, b) => (b.created_at_ms ?? 0) - (a.created_at_ms ?? 0))[0];
  }
  if (!primary) {
    return null;
  }
  const tid = primary.trace_id;
  const spans = data.nodes.filter((n) => n.node_role === "span" && n.trace_id === tid);
  const llmSpans = spans.filter((n) => n.kind === "LLM");
  const toolLike = spans.filter((n) =>
    ["TOOL", "SKILL", "MEMORY", "GUARDRAIL", "AGENT_LOOP", "IO"].includes(n.kind),
  );
  const inboundChannel = inferInboundChannelFromThreadKey(data.thread_key);
  return {
    primary,
    traceId: tid,
    traceHeaderNodeId: `th:${tid}`,
    spans,
    llmSpans,
    toolLike,
    primaryLlm: llmSpans[0],
    firstToolLike: toolLike[0],
    inboundChannel,
  };
}

/**
 * 从 execution graph 聚合一条「主 trace」上的 span，生成接近 OpenClaw 架构示意（入站→网关→Runner→LLM→工具→回流/出站）。
 */
export function buildArchitecturePipelineGraph(
  data: ExecutionGraphResponseDto,
  options?: { focusTraceId?: string },
): { nodes: Node[]; edges: Edge[] } {
  const ctx = pickPrimaryTraceContext(data, options);
  if (!ctx) {
    return { nodes: [], edges: [] };
  }

  const { primary, traceId: tid, llmSpans, toolLike, primaryLlm, inboundChannel } = ctx;

  const mode = primary.tool_execution_mode ?? primaryLlm?.tool_execution_mode ?? null;
  const toolNames = toolLike
    .map((s) => {
      const nm = s.name?.trim();
      if (nm) {
        return nm;
      }
      if (s.kind === "MEMORY") {
        return "memory";
      }
      return s.kind.toLowerCase();
    })
    .slice(0, 12);

  const llmRoundCount = Math.max(1, llmSpans.length);
  const hasToolLoopBack = llmSpans.length > 1 && toolLike.length > 0;

  const shared: Pick<
    ArchPipelineNodeData,
    "traceId" | "toolNames" | "toolMode" | "llmRoundCount" | "hasToolLoopBack"
  > = {
    traceId: tid,
    toolNames,
    toolMode: mode,
    llmRoundCount,
    hasToolLoopBack,
  };

  const nodes: Node[] = [
    {
      id: "arch-inbound",
      type: "archPipeline",
      position: { x: 0, y: 0 },
      data: { stage: "inbound", inboundChannel, ...shared } satisfies ArchPipelineNodeData,
    },
    {
      id: "arch-gateway",
      type: "archPipeline",
      position: { x: 0, y: 0 },
      data: { stage: "gateway", ...shared } satisfies ArchPipelineNodeData,
    },
    {
      id: "arch-runner",
      type: "archPipeline",
      position: { x: 0, y: 0 },
      data: { stage: "runner", ...shared } satisfies ArchPipelineNodeData,
    },
    {
      id: "arch-llm",
      type: "archPipeline",
      position: { x: 0, y: 0 },
      data: {
        stage: "llm",
        llmSpanId: primaryLlm?.id ?? null,
        modelLabel: primaryLlm?.model ?? null,
        providerLabel: primaryLlm?.provider ?? null,
        ...shared,
      } satisfies ArchPipelineNodeData,
    },
    {
      id: "arch-tools",
      type: "archPipeline",
      position: { x: 0, y: 0 },
      data: { stage: "tools", ...shared } satisfies ArchPipelineNodeData,
    },
    {
      id: "arch-response",
      type: "archPipeline",
      position: { x: 0, y: 0 },
      data: { stage: "response", ...shared } satisfies ArchPipelineNodeData,
    },
  ];

  const mk = (stroke: string) => ({
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: stroke,
  });

  const edges: Edge[] = [
    {
      id: "e-in-gw",
      source: "arch-inbound",
      target: "arch-gateway",
      style: { stroke: "rgb(148 163 184)", strokeWidth: 1.4 },
      markerEnd: mk("rgb(148 163 184)"),
    },
    {
      id: "e-gw-run",
      source: "arch-gateway",
      target: "arch-runner",
      style: { stroke: "rgb(148 163 184)", strokeWidth: 1.4 },
      markerEnd: mk("rgb(148 163 184)"),
    },
    {
      id: "e-run-llm",
      source: "arch-runner",
      target: "arch-llm",
      style: { stroke: "rgb(56 189 248)", strokeWidth: 1.5 },
      markerEnd: mk("rgb(56 189 248)"),
    },
    {
      id: "e-llm-tools",
      source: "arch-llm",
      target: "arch-tools",
      style: { stroke: "rgb(52 211 153)", strokeWidth: 1.5 },
      markerEnd: mk("rgb(52 211 153)"),
    },
    {
      id: "e-tools-out",
      source: "arch-tools",
      target: "arch-response",
      style: { stroke: "rgb(167 139 250)", strokeWidth: 1.5 },
      markerEnd: mk("rgb(167 139 250)"),
    },
  ];

  if (hasToolLoopBack) {
    edges.push({
      id: "e-tools-llm-loop",
      source: "arch-tools",
      target: "arch-llm",
      style: {
        stroke: "rgb(251 191 36)",
        strokeWidth: 1.35,
      },
      markerEnd: mk("rgb(251 191 36)"),
    });
  }

  return { nodes, edges };
}

/** 固定横向流水线，接近参考架构图（避免 dagre 处理回边）。 */
export function layoutArchitecturePipeline(nodes: Node[]): Node[] {
  if (nodes.length === 0) {
    return [];
  }
  const gap = 228;
  const order = [
    "arch-inbound",
    "arch-gateway",
    "arch-runner",
    "arch-llm",
    "arch-tools",
    "arch-response",
  ];
  const map = new Map(nodes.map((n) => [n.id, n]));
  const out: Node[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const n = map.get(id);
    if (!n) {
      continue;
    }
    out.push({
      ...n,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      position: { x: i * gap, y: 0 },
    });
  }
  return out;
}
