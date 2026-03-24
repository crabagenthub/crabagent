import type Database from "better-sqlite3";

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

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

export function querySemanticSpansByTraceId(db: Database.Database, traceId: string): SemanticSpanRow[] {
  const rows = db
    .prepare(
      `SELECT s.span_id,
              s.trace_id,
              s.parent_id,
              s.module,
              s.type,
              s.name,
              s.input,
              s.output,
              s.start_time,
              s.end_time,
              s.error,
              s.metadata,
              g.model_name,
              g.prompt_tokens,
              g.completion_tokens,
              g.context_full,
              g.context_sent
       FROM spans s
       LEFT JOIN generations g ON g.span_id = s.span_id
       WHERE s.trace_id = ?
       ORDER BY s.start_time ASC, s.span_id ASC`,
    )
    .all(traceId.trim()) as Record<string, unknown>[];

  return rows.map((r) => ({
    span_id: String(r.span_id ?? ""),
    trace_id: String(r.trace_id ?? ""),
    parent_id: r.parent_id == null || String(r.parent_id).trim() === "" ? null : String(r.parent_id),
    module: String(r.module ?? ""),
    type: String(r.type ?? ""),
    name: String(r.name ?? ""),
    input: parseJsonObject(r.input != null ? String(r.input) : "{}"),
    output: parseJsonObject(r.output != null ? String(r.output) : "{}"),
    metadata: parseJsonObject(r.metadata != null ? String(r.metadata) : "{}"),
    start_time: Number(r.start_time) || 0,
    end_time: r.end_time == null ? null : Number(r.end_time),
    error: r.error == null ? null : String(r.error),
    model_name: r.model_name == null ? null : String(r.model_name),
    prompt_tokens: r.prompt_tokens == null ? null : Number(r.prompt_tokens),
    completion_tokens: r.completion_tokens == null ? null : Number(r.completion_tokens),
    context_full: r.context_full == null ? null : String(r.context_full),
    context_sent: r.context_sent == null ? null : String(r.context_sent),
  }));
}
