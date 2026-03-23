import type { TraceTimelineEvent } from "@/components/trace-timeline-tree";

/** Typical OpenClaw pipeline stages we surface in the detail summary (order matters for display). */
export const PIPELINE_TYPE_ORDER: string[] = [
  "message_received",
  "session_start",
  "before_model_resolve",
  "before_prompt_build",
  "hook_contribution",
  "context_prune_applied",
  "model_stream_context",
  "llm_input",
  "llm_output",
  "before_tool_call",
  "after_tool_call",
  "agent_end",
];

export type PipelineCoverage = {
  /** Distinct `type` values in this slice, stable order */
  orderedTypes: string[];
  /** Count per type */
  counts: Record<string, number>;
  /** Subset of PIPELINE_TYPE_ORDER not seen (optional diagnostics) */
  missingStages: string[];
};

export function pipelineCoverageFromEvents(events: TraceTimelineEvent[]): PipelineCoverage {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const t = typeof e.type === "string" && e.type.trim() ? e.type.trim() : "—";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const orderedTypes: string[] = [];
  const seen = new Set<string>();
  for (const t of PIPELINE_TYPE_ORDER) {
    if ((counts[t] ?? 0) > 0) {
      orderedTypes.push(t);
      seen.add(t);
    }
  }
  for (const t of Object.keys(counts).sort()) {
    if (!seen.has(t)) {
      orderedTypes.push(t);
    }
  }
  const missingStages = PIPELINE_TYPE_ORDER.filter((t) => (counts[t] ?? 0) === 0);
  return { orderedTypes, counts, missingStages };
}
