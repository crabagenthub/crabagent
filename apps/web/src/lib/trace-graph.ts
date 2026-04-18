import { collectorAuthHeaders } from "@/lib/collector";
import { readCollectorFetchResult } from "@/lib/collector-json";
import { conversationTraceGraphPath } from "@/lib/collector-api-paths";

export type TraceGraphSkillSummary = {
  name: string;
  skill_id?: string;
};

export type TraceGraphNodeDto = {
  id: string;
  thread_id: string | null;
  trace_type: string;
  parent_turn_ref: string | null;
  subagent_thread_id: string | null;
  name: string | null;
  is_complete: number;
  created_at_ms: number | null;
  total_tokens: number;
  tool_call_count: number;
  primary_model: string | null;
  primary_provider: string | null;
  llm_models: string[];
  skills: TraceGraphSkillSummary[];
  total_cost: number | null;
  policy_tags: string[];
};

export type TraceGraphEdgeDto = {
  id: string;
  source: string;
  target: string;
  trace_type: string;
  cost_estimate: number | null;
  policy_tags: string[];
};

export type TraceGraphResponseDto = {
  thread_key: string;
  nodes: TraceGraphNodeDto[];
  edges: TraceGraphEdgeDto[];
  truncated: boolean;
  max_nodes: number;
};

export type LoadTraceGraphParams = {
  /** 默认服务端 80，上限 200 */
  maxNodes?: number;
};

export async function loadTraceGraph(
  baseUrl: string,
  apiKey: string,
  threadId: string,
  params: LoadTraceGraphParams = {},
): Promise<TraceGraphResponseDto> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  if (params.maxNodes != null && params.maxNodes > 0) {
    sp.set("max_nodes", String(Math.floor(params.maxNodes)));
  }
  const q = sp.toString();
  const path = conversationTraceGraphPath(threadId);
  const url = q ? `${b}${path}?${q}` : `${b}${path}`;
  const res = await fetch(url, { headers: collectorAuthHeaders(apiKey) });
  return readCollectorFetchResult<TraceGraphResponseDto>(res, `trace graph HTTP ${res.status}`);
}
