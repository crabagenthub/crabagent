import { collectorAuthHeaders } from "@/lib/collector";
import { conversationExecutionGraphPath, traceExecutionGraphPath } from "@/lib/collector-api-paths";

/**
 * Collector `GET /v1/conversation/:threadId/execution-graph` 与 `GET /v1/trace/execution-graph` 返回的节点。
 * 时间字段均为 epoch ms；trace 头节点 `total_tokens` 与 trace 列表 `TRACE_ROW_TOKEN_INTEGER_EXPR` 一致。
 */
export type ExecutionGraphNodeDto = {
  id: string;
  trace_id: string;
  thread_id: string | null;
  trace_type: string;
  node_role: "trace" | "span";
  kind: string;
  name: string | null;
  model: string | null;
  provider: string | null;
  total_tokens: number;
  /** Trace header: creation time (epoch ms). */
  created_at_ms?: number | null;
  /** Span: start/end (epoch ms)。Trace 头：start=created、end=推导结束时间。 */
  start_time_ms?: number | null;
  end_time_ms?: number | null;
  /** Trace 头 / Span：墙钟耗时（ms），与 Collector execution-graph 一致。 */
  duration_ms?: number | null;
  /** 本回合工具调度：并发 / 串行（来自 trace metadata）。 */
  tool_execution_mode?: "parallel" | "sequential" | null;
};

export type ExecutionGraphEdgeDto = {
  id: string;
  source: string;
  target: string;
  edge_kind: string;
  tool_batch_mode?: "parallel" | "sequential" | null;
};

/** 执行图 API 响应；`nodes` 含合成 trace 头（`node_role: "trace"`）与真实 span。 */
export type ExecutionGraphResponseDto = {
  thread_key: string;
  nodes: ExecutionGraphNodeDto[];
  edges: ExecutionGraphEdgeDto[];
  truncated: boolean;
  max_nodes: number;
};

export type LoadExecutionGraphParams = {
  threadId?: string;
  traceId?: string;
  maxNodes?: number;
};

export async function loadExecutionGraph(
  baseUrl: string,
  apiKey: string,
  params: LoadExecutionGraphParams,
): Promise<ExecutionGraphResponseDto> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  if (params.maxNodes != null && params.maxNodes > 0) {
    sp.set("max_nodes", String(Math.floor(params.maxNodes)));
  }
  const tid = params.threadId?.trim();
  const traceId = params.traceId?.trim();
  if (tid) {
    const path = conversationExecutionGraphPath(tid);
    const q = sp.toString();
    const url = q ? `${b}${path}?${q}` : `${b}${path}`;
    const res = await fetch(url, { headers: collectorAuthHeaders(apiKey) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as ExecutionGraphResponseDto;
  }
  if (traceId) {
    sp.set("trace_id", traceId);
    const url = `${b}${traceExecutionGraphPath()}?${sp.toString()}`;
    const res = await fetch(url, { headers: collectorAuthHeaders(apiKey) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as ExecutionGraphResponseDto;
  }
  throw new Error("loadExecutionGraph: threadId or traceId required");
}
