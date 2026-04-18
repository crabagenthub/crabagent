import { collectorAuthHeaders } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
import { COLLECTOR_API } from "@/lib/collector-api-paths";

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
  /** Preferred total from usage JSON; may include cache-read billable semantics. */
  total_tokens: number | null;
  cache_read_tokens: number | null;
  /** Numeric fields flattened from `usage_json` (for tooltips / debug). */
  usage_breakdown: Record<string, number>;
  context_full: string | null;
  context_sent: string | null;
};

export async function loadSemanticSpans(
  baseUrl: string,
  apiKey: string,
  traceId: string,
): Promise<{
  trace_id: string;
  items: SemanticSpanRow[];
  /** From `opik_traces.input_json` when present (e.g. OpenClaw `systemPrompt`, full `prompt`). */
  trace_input: Record<string, unknown> | null;
}> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("trace_id", traceId.trim());
  const res = await fetch(`${b}${COLLECTOR_API.traceSpans}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  const raw = await readCollectorFetchResult<{
    trace_id?: string;
    items?: Partial<SemanticSpanRow>[];
    trace_input?: unknown;
  }>(res, `trace spans HTTP ${res.status}`);
  const items = collectorItemsArray<Partial<SemanticSpanRow>>(raw.items).map((r) => normalizeSemanticSpan(r));
  const ti = raw.trace_input;
  const trace_input =
    ti && typeof ti === "object" && !Array.isArray(ti) ? (ti as Record<string, unknown>) : null;
  return { trace_id: raw.trace_id ?? traceId.trim(), items, trace_input };
}

function normalizeSemanticSpan(r: Partial<SemanticSpanRow>): SemanticSpanRow {
  const ub =
    r.usage_breakdown && typeof r.usage_breakdown === "object" && !Array.isArray(r.usage_breakdown)
      ? (r.usage_breakdown as Record<string, number>)
      : {};
  return {
    span_id: String(r.span_id ?? ""),
    trace_id: String(r.trace_id ?? ""),
    parent_id:
      r.parent_id == null || String(r.parent_id).trim() === "" ? null : String(r.parent_id),
    module: String(r.module ?? ""),
    type: String(r.type ?? ""),
    name: String(r.name ?? ""),
    input: r.input && typeof r.input === "object" && !Array.isArray(r.input) ? r.input : {},
    output: r.output && typeof r.output === "object" && !Array.isArray(r.output) ? r.output : {},
    metadata: r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? r.metadata : {},
    start_time: Number(r.start_time) || 0,
    end_time: r.end_time != null && Number.isFinite(Number(r.end_time)) ? Number(r.end_time) : null,
    error: r.error != null ? String(r.error) : null,
    model_name: r.model_name != null ? String(r.model_name) : null,
    prompt_tokens: r.prompt_tokens != null && Number.isFinite(Number(r.prompt_tokens)) ? Number(r.prompt_tokens) : null,
    completion_tokens:
      r.completion_tokens != null && Number.isFinite(Number(r.completion_tokens)) ? Number(r.completion_tokens) : null,
    total_tokens: r.total_tokens != null && Number.isFinite(Number(r.total_tokens)) ? Number(r.total_tokens) : null,
    cache_read_tokens:
      r.cache_read_tokens != null && Number.isFinite(Number(r.cache_read_tokens)) ? Number(r.cache_read_tokens) : null,
    usage_breakdown: ub,
    context_full: r.context_full != null ? String(r.context_full) : null,
    context_sent: r.context_sent != null ? String(r.context_sent) : null,
  };
}
