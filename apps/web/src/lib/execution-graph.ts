import { collectorAuthHeaders } from "@/lib/collector";
import { conversationExecutionGraphPath, traceExecutionGraphPath } from "@/lib/collector-api-paths";

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
  /** Span: start/end (epoch ms). */
  start_time_ms?: number | null;
  end_time_ms?: number | null;
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
