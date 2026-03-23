/** Minimal shape for timeline/list rows; avoids importing heavy tree component types. */
export type TraceEventRunIdSource = {
  run_id?: string | null;
  payload?: unknown;
};

/**
 * OpenClaw / collector may expose run id on the row (`run_id`) or only inside `payload`
 * (`run_id` / `runId`) depending on ingest version and serialization.
 */
export function eventRunId(e: TraceEventRunIdSource): string {
  const top = typeof e.run_id === "string" ? e.run_id.trim() : "";
  if (top) {
    return top;
  }
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  const a = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
  if (a) {
    return a;
  }
  const b = typeof payload.runId === "string" ? payload.runId.trim() : "";
  return b;
}
