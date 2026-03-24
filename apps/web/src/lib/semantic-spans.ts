import { collectorAuthHeaders } from "@/lib/collector";

export type SemanticSpanRow = {
  span_id: string;
  trace_id: string;
  parent_id: string | null;
  module: string;
  type: string;
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  start_time: number;
  end_time: number | null;
  error: string | null;
  model_name: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  context_full: string | null;
  context_sent: string | null;
};

export async function loadSemanticSpans(
  baseUrl: string,
  apiKey: string,
  traceId: string,
): Promise<{ trace_id: string; items: SemanticSpanRow[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("trace_id", traceId.trim());
  const res = await fetch(`${b}/v1/semantic-spans?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<{ trace_id: string; items: SemanticSpanRow[] }>;
}
