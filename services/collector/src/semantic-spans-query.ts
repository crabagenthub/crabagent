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

export function parseUsageExtended(usageJson: string | null | undefined): {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cache_read_tokens: number | null;
  usage_breakdown: Record<string, number>;
} {
  const raw = usageJson?.trim();
  if (!raw) {
    return {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cache_read_tokens: null,
      usage_breakdown: {},
    };
  }
  const o = parseJsonObject(usageJson);
  if (Object.keys(o).length === 0) {
    return {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cache_read_tokens: null,
      usage_breakdown: {},
    };
  }

  const um =
    o.usageMetadata && typeof o.usageMetadata === "object" && !Array.isArray(o.usageMetadata)
      ? (o.usageMetadata as Record<string, unknown>)
      : {};
  const usageNested =
    o.usage && typeof o.usage === "object" && !Array.isArray(o.usage)
      ? (o.usage as Record<string, unknown>)
      : {};
  const umNested =
    usageNested.usageMetadata &&
    typeof usageNested.usageMetadata === "object" &&
    !Array.isArray(usageNested.usageMetadata)
      ? (usageNested.usageMetadata as Record<string, unknown>)
      : {};

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

  const pick = (...vals: unknown[]): number | null => {
    for (const v of vals) {
      const n = num(v);
      if (n != null) return n;
    }
    return null;
  };

  const prompt =
    pick(
      o.prompt_tokens,
      o.promptTokens,
      um.promptTokenCount,
      um.inputTokenCount,
      usageNested.prompt_tokens,
      usageNested.promptTokens,
      usageNested.prompt_token_count,
      usageNested.input_tokens,
      usageNested.inputTokens,
      usageNested.promptTokenCount,
      usageNested.inputTokenCount,
      umNested.promptTokenCount,
      umNested.inputTokenCount,
    ) ?? 0;
  const completion =
    pick(
      o.completion_tokens,
      o.completionTokens,
      um.candidatesTokenCount,
      um.outputTokenCount,
      usageNested.completion_tokens,
      usageNested.completionTokens,
      usageNested.completion_token_count,
      usageNested.output_tokens,
      usageNested.outputTokens,
      usageNested.candidatesTokenCount,
      usageNested.outputTokenCount,
      umNested.candidatesTokenCount,
      umNested.outputTokenCount,
    ) ?? 0;
  const cacheRead = pick(
    o.cache_read_tokens,
    o.cacheReadTokens,
    um.cachedContentTokenCount,
    o.cached_prompt_tokens,
    um.cacheReadInputTokens,
    usageNested.cache_read_tokens,
    usageNested.cacheReadTokens,
    umNested.cachedContentTokenCount,
    umNested.cacheReadInputTokens,
  );
  const totalExplicit = pick(
    o.total_tokens,
    o.totalTokens,
    um.totalTokenCount,
    um.totalTokens,
    o.totalTokenCount,
    usageNested.total_tokens,
    usageNested.totalTokens,
    usageNested.totalTokenCount,
    umNested.totalTokenCount,
    umNested.totalTokens,
  );

  const usage_breakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "usageMetadata") continue;
    const n = num(v);
    if (n != null) {
      usage_breakdown[k] = n;
    }
  }
  for (const [k, v] of Object.entries(um)) {
    const n = num(v);
    if (n != null) {
      usage_breakdown[`usageMetadata.${k}`] = n;
    }
  }
  for (const [k, v] of Object.entries(usageNested)) {
    if (k === "usageMetadata") continue;
    const n = num(v);
    if (n != null) {
      usage_breakdown[`usage.${k}`] = n;
    }
  }
  for (const [k, v] of Object.entries(umNested)) {
    const n = num(v);
    if (n != null) {
      usage_breakdown[`usage.usageMetadata.${k}`] = n;
    }
  }

  const sumPc = prompt + completion;
  const total =
    totalExplicit ??
    (sumPc > 0
      ? sumPc + (cacheRead ?? 0)
      : cacheRead != null && cacheRead > 0
        ? cacheRead
        : Object.keys(usage_breakdown).length > 0
          ? pick(
              usage_breakdown.total_tokens,
              usage_breakdown["usageMetadata.totalTokenCount"],
              usage_breakdown["usageMetadata.totalTokens"],
            )
          : null);

  const hasUsage =
    totalExplicit != null ||
    sumPc > 0 ||
    (cacheRead != null && cacheRead > 0) ||
    Object.keys(usage_breakdown).length > 0;

  if (!hasUsage) {
    return {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cache_read_tokens: null,
      usage_breakdown: {},
    };
  }

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cache_read_tokens: cacheRead,
    usage_breakdown,
  };
}

/** Align with openclaw-trace-plugin `resource-audit` + common agent tool names. */
function normalizeSemanticKind(metadata: Record<string, unknown>): string {
  const sk = metadata.semantic_kind ?? metadata.semanticKind;
  if (typeof sk !== "string") {
    return "";
  }
  return sk.trim().toLowerCase();
}

function metadataResourceUri(metadata: Record<string, unknown>): string | undefined {
  const r = metadata.resource;
  if (r == null || typeof r !== "object" || Array.isArray(r)) {
    return undefined;
  }
  const u = (r as { uri?: unknown }).uri;
  return typeof u === "string" && u.trim() ? u.trim() : undefined;
}

/** `skills.run` / `skill.x` — check before memory heuristics. */
function inferSkillFromToolName(toolName: string): boolean {
  const n = toolName.toLowerCase().replace(/-/g, "_").trim();
  if (!n) {
    return false;
  }
  if (n === "skill" || n === "skills") {
    return true;
  }
  return n.startsWith("skills.") || n.startsWith("skill.");
}

/** When `semantic_kind` was not persisted, still surface memory in call graph / span list. */
function inferMemoryFromToolName(toolName: string): boolean {
  const n = toolName.toLowerCase();
  if (!n.trim()) {
    return false;
  }
  if (inferSkillFromToolName(toolName)) {
    return false;
  }
  if (n.includes("memory") || n.includes("recall") || n.includes("rag")) {
    return true;
  }
  return (
    n.includes("search") &&
    (n.includes("kb") || n.includes("knowledge") || n.includes("vector"))
  );
}

function toolSpanSemanticFromMetadata(
  name: string,
  metadata: Record<string, unknown>,
): "MEMORY" | "SKILL" | "TOOL" {
  const sk = normalizeSemanticKind(metadata);
  if (sk === "memory") {
    return "MEMORY";
  }
  if (sk === "skill") {
    return "SKILL";
  }
  const uri = metadataResourceUri(metadata);
  if (uri != null && uri.toLowerCase().startsWith("memory://")) {
    return "MEMORY";
  }
  if (inferSkillFromToolName(name)) {
    return "SKILL";
  }
  if (inferMemoryFromToolName(name)) {
    return "MEMORY";
  }
  return "TOOL";
}

/** Exported for execution-graph batch builder (same semantics as list API `type`). */
export function mapSpanTypeToApi(spanType: string, name: string, metadata: Record<string, unknown>): string {
  const sk = normalizeSemanticKind(metadata);
  if (spanType === "llm") {
    return "LLM";
  }
  if (spanType === "tool") {
    return toolSpanSemanticFromMetadata(name, metadata);
  }
  if (spanType === "guardrail") {
    return "GUARDRAIL";
  }
  if (name === "agent_loop") {
    return "AGENT_LOOP";
  }
  if (sk === "memory") {
    return "MEMORY";
  }
  return "IO";
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
  total_tokens: number | null;
  cache_read_tokens: number | null;
  usage_breakdown: Record<string, number>;
};

export function querySemanticSpansByTraceId(db: Database.Database, traceId: string): SemanticSpanRow[] {
  const rows = db
    .prepare(
      `SELECT s.span_id,
              s.trace_id,
              s.parent_span_id,
              s.span_type,
              s.name,
              s.input_json,
              s.output_json,
              s.start_time_ms,
              s.end_time_ms,
              s.error_info_json,
              s.metadata_json,
              s.usage_json,
              s.model
       FROM opik_spans s
       WHERE s.trace_id = ?
       ORDER BY COALESCE(s.sort_index, 0) ASC, s.start_time_ms ASC, s.span_id ASC`,
    )
    .all(traceId.trim()) as Record<string, unknown>[];

  return rows.map((r) => {
    const meta = parseJsonObject(r.metadata_json != null ? String(r.metadata_json) : "{}");
    const errInfo = parseJsonObject(r.error_info_json != null ? String(r.error_info_json) : "{}");
    const errMsg = errInfo.message ?? errInfo.exception_message;
    const spanType = String(r.span_type ?? "general");
    const name = String(r.name ?? "");
    const apiType = mapSpanTypeToApi(spanType, name, meta);
    const usage = parseUsageExtended(r.usage_json != null ? String(r.usage_json) : null);
    const ctxFull = meta.context_full;
    const ctxSent = meta.context_sent;
    return {
      span_id: String(r.span_id ?? ""),
      trace_id: String(r.trace_id ?? ""),
      parent_id:
        r.parent_span_id == null || String(r.parent_span_id).trim() === ""
          ? null
          : String(r.parent_span_id),
      module: typeof meta.semantic_module === "string" ? meta.semantic_module : spanType,
      type: apiType,
      name,
      input: parseJsonObject(r.input_json != null ? String(r.input_json) : "{}"),
      output: parseJsonObject(r.output_json != null ? String(r.output_json) : "{}"),
      metadata: meta,
      start_time: Number(r.start_time_ms) || 0,
      end_time: r.end_time_ms == null ? null : Number(r.end_time_ms),
      error: typeof errMsg === "string" ? errMsg : null,
      model_name: r.model == null ? null : String(r.model),
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      usage_breakdown: usage.usage_breakdown,
      context_full: typeof ctxFull === "string" ? ctxFull : null,
      context_sent: typeof ctxSent === "string" ? ctxSent : null,
    };
  });
}
