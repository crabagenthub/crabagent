import type Database from "better-sqlite3";
import { TRACE_ROW_TOKEN_INTEGER_EXPR } from "./opik-tokens-sql.js";
import { queryTracesInConversationScope, type TraceRowScoped } from "./thread-scope-query.js";
import { mapSpanTypeToApi, parseUsageExtended } from "./semantic-spans-query.js";

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

/** OpenClaw trace 插件写入 `opik_traces.metadata_json.tool_execution_mode`。 */
function parseToolExecutionModeFromTraceMeta(
  meta: Record<string, unknown>,
): "parallel" | "sequential" | null {
  const raw = meta.tool_execution_mode ?? meta.toolExecutionMode;
  if (typeof raw !== "string") {
    return null;
  }
  const s = raw.trim().toLowerCase();
  if (s === "parallel" || s === "sequential") {
    return s;
  }
  return null;
}

/** 与 trace-records-query 中 trace 行 `end_time` 推导一致。 */
function traceEndTimeMs(tr: TraceRowScoped): number | null {
  const created = tr.created_at_ms != null ? Number(tr.created_at_ms) : NaN;
  const ended = tr.ended_at_ms != null ? Number(tr.ended_at_ms) : NaN;
  const dur = tr.duration_ms != null ? Number(tr.duration_ms) : 0;
  const updated = tr.updated_at_ms != null ? Number(tr.updated_at_ms) : NaN;
  if (Number.isFinite(ended)) return ended;
  if (Number.isFinite(created) && dur > 0) return created + dur;
  if (Number.isFinite(updated)) return updated;
  if (Number.isFinite(created)) return created;
  return null;
}

function traceDurationMs(tr: TraceRowScoped, endMs: number | null): number | null {
  const created = tr.created_at_ms != null ? Number(tr.created_at_ms) : NaN;
  if (endMs != null && Number.isFinite(created) && endMs >= created) {
    return endMs - created;
  }
  const d = tr.duration_ms != null ? Number(tr.duration_ms) : NaN;
  if (Number.isFinite(d) && d > 0) return d;
  return null;
}

function loadTraceTokenTotals(db: Database.Database, traceIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (traceIds.length === 0) return out;
  const ph = traceIds.map(() => "?").join(", ");
  const sql = `SELECT t.trace_id, CAST(COALESCE(${TRACE_ROW_TOKEN_INTEGER_EXPR}, 0) AS INTEGER) AS total_tokens
FROM opik_traces t WHERE t.trace_id IN (${ph})`;
  const rows = db.prepare(sql).all(...traceIds) as { trace_id: string; total_tokens: number | null }[];
  for (const r of rows) {
    out.set(String(r.trace_id), Number(r.total_tokens) || 0);
  }
  return out;
}

function spanWallDurationMs(startMs: number | null, endMs: number | null): number | null {
  if (startMs == null || endMs == null) return null;
  const a = Number(startMs);
  const b = Number(endMs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

export type ExecutionGraphNode = {
  id: string;
  trace_id: string;
  thread_id: string | null;
  /** opik_traces.trace_type for the owning trace. */
  trace_type: string;
  /** Synthetic trace header vs real span. */
  node_role: "trace" | "span";
  /** Semantic kind: LLM, TOOL, SKILL, MEMORY, AGENT_LOOP, GUARDRAIL, IO, or TRACE_* for headers. */
  kind: string;
  name: string | null;
  model: string | null;
  provider: string | null;
  total_tokens: number;
  /** Trace header: `opik_traces.created_at_ms`. */
  created_at_ms: number | null;
  /** Span：span 起止；Trace 头：与 trace 列表同源（created / 推导 end）。 */
  start_time_ms: number | null;
  end_time_ms: number | null;
  /** Trace 头：墙钟耗时；Span：`end_time_ms - start_time_ms`（可算时）。 */
  duration_ms: number | null;
  /**
   * 来自 `opik_traces.metadata_json.tool_execution_mode`：本回合工具批次的并发 / 串行调度。
   * 标在 trace 头节点与 LLM span 上；其它 span 为 null。
   */
  tool_execution_mode: "parallel" | "sequential" | null;
};

export type ExecutionGraphEdge = {
  id: string;
  source: string;
  target: string;
  /**
   * span_parent | span_parent_parallel | span_parent_sequential | trace_to_root | cross_trace | trace_lineage
   * parallel/sequential 仅用于 LLM→（工具类）子 span 的边。
   */
  edge_kind: string;
  /** 与 edge_kind 中 parallel/sequential 一致；便于客户端省略分支解析。 */
  tool_batch_mode?: "parallel" | "sequential" | null;
};

export type ExecutionGraphResponse = {
  thread_key: string;
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
  truncated: boolean;
  max_nodes: number;
};

const DEFAULT_MAX = 500;
const ABS_MAX = 1200;

function clampMax(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) {
    return DEFAULT_MAX;
  }
  const x = Math.floor(n);
  if (x < 50) {
    return 50;
  }
  if (x > ABS_MAX) {
    return ABS_MAX;
  }
  return x;
}

type RawSpan = {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string | null;
  span_type: string;
  model: string | null;
  provider: string | null;
  metadata_json: string | null;
  start_time_ms: number | null;
  end_time_ms: number | null;
  usage_json: string | null;
  si: number;
};

function loadTraceRowScoped(db: Database.Database, traceId: string): TraceRowScoped | undefined {
  return db
    .prepare(
      `SELECT t.trace_id,
              t.thread_id,
              t.workspace_name,
              t.project_name,
              COALESCE(
                NULLIF(TRIM(json_extract(t.metadata_json, '$.parent_turn_id')), ''),
                NULLIF(TRIM(json_extract(t.metadata_json, '$.parentTurnId')), '')
              ) AS parent_turn_ref,
              t.trace_type,
              t.subagent_thread_id,
              t.name,
              t.input_json,
              t.output_json,
              t.metadata_json,
              t.setting_json,
              t.created_at_ms,
              t.updated_at_ms,
              t.ended_at_ms,
              t.duration_ms,
              t.is_complete
       FROM opik_traces t WHERE t.trace_id = ?`,
    )
    .get(traceId.trim()) as TraceRowScoped | undefined;
}

/**
 * Seed trace + ancestor chain + all descendant traces linked via metadata.parent_turn_id
 * within the same conversation scope (so subagent runs appear with cross_trace edges).
 */
function selectTraceFamilyForFocus(db: Database.Database, seedTraceId: string): TraceRowScoped[] {
  const row = loadTraceRowScoped(db, seedTraceId);
  if (!row) {
    return [];
  }
  const threadId = row.thread_id != null ? String(row.thread_id).trim() : "";
  if (!threadId) {
    return [row];
  }
  const all = queryTracesInConversationScope(db, threadId, true);
  const byId = new Map(all.map((r) => [r.trace_id, r]));
  const selected = new Set<string>();

  let cur: TraceRowScoped | undefined = row;
  while (cur) {
    selected.add(cur.trace_id);
    const parentRef: string = cur.parent_turn_ref != null ? String(cur.parent_turn_ref).trim() : "";
    cur = parentRef.length > 0 && byId.has(parentRef) ? byId.get(parentRef) : undefined;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const r of all) {
      const pref = r.parent_turn_ref != null ? String(r.parent_turn_ref).trim() : "";
      if (pref && selected.has(pref) && !selected.has(r.trace_id)) {
        selected.add(r.trace_id);
        changed = true;
      }
    }
  }

  return all.filter((r) => selected.has(r.trace_id));
}

function traceTypeToHeaderKind(tt: string): string {
  const t = tt.trim().toLowerCase();
  if (t === "external") {
    return "TRACE_EXTERNAL";
  }
  if (t === "subagent") {
    return "TRACE_SUBAGENT";
  }
  if (t === "async_command") {
    return "TRACE_ASYNC";
  }
  if (t === "system") {
    return "TRACE_SYSTEM";
  }
  return `TRACE_${t.toUpperCase() || "UNKNOWN"}`;
}

function loadSpansForTraces(db: Database.Database, traceIds: string[]): RawSpan[] {
  if (traceIds.length === 0) {
    return [];
  }
  const ph = traceIds.map(() => "?").join(", ");
  const sql = `
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.model,
       s.provider,
       s.metadata_json,
       s.start_time_ms,
       s.end_time_ms,
       s.usage_json,
       COALESCE(s.sort_index, 0) AS si
FROM opik_spans s
WHERE s.trace_id IN (${ph})
ORDER BY s.trace_id ASC, si ASC, s.span_id ASC`;
  return db.prepare(sql).all(...traceIds) as RawSpan[];
}

/**
 * Span-level execution graph + optional trace header nodes + cross-trace edges from metadata.parent_turn_id.
 */
export function queryConversationExecutionGraph(
  db: Database.Database,
  threadKey: string,
  options?: { maxNodes?: number },
): ExecutionGraphResponse {
  const maxNodes = clampMax(options?.maxNodes);
  const key = threadKey.trim();
  if (!key) {
    return { thread_key: "", nodes: [], edges: [], truncated: false, max_nodes: maxNodes };
  }
  const traceRows = queryTracesInConversationScope(db, key, true);
  return buildExecutionGraphFromTraces(db, key, traceRows, maxNodes);
}

/**
 * Single-trace focus graph (message detail / inspect): seed trace + linked parent/child traces
 * in the same session (parent_turn_id), spans inside each, and cross_trace edges between traces.
 */
export function queryTraceExecutionGraph(
  db: Database.Database,
  traceId: string,
  options?: { maxNodes?: number },
): ExecutionGraphResponse {
  const maxNodes = clampMax(options?.maxNodes);
  const tid = traceId.trim();
  if (!tid) {
    return { thread_key: "", nodes: [], edges: [], truncated: false, max_nodes: maxNodes };
  }
  const traceRows = selectTraceFamilyForFocus(db, tid);
  if (traceRows.length === 0) {
    return { thread_key: tid, nodes: [], edges: [], truncated: false, max_nodes: maxNodes };
  }
  const threadKey =
    (traceRows[0]!.thread_id != null ? String(traceRows[0]!.thread_id).trim() : "") || tid;
  return buildExecutionGraphFromTraces(db, threadKey, traceRows, maxNodes);
}

function buildExecutionGraphFromTraces(
  db: Database.Database,
  threadKey: string,
  traceRows: TraceRowScoped[],
  maxNodes: number,
): ExecutionGraphResponse {
  if (traceRows.length === 0) {
    return { thread_key: threadKey, nodes: [], edges: [], truncated: false, max_nodes: maxNodes };
  }

  const traceById = new Map<string, TraceRowScoped>();
  for (const r of traceRows) {
    traceById.set(r.trace_id, r);
  }
  const traceIds = [...traceById.keys()];

  let spans = loadSpansForTraces(db, traceIds);
  let truncated = false;
  if (spans.length > maxNodes) {
    spans = spans.slice(0, maxNodes);
    truncated = true;
  }

  const spanIdSet = new Set(spans.map((s) => String(s.span_id)));
  const spansByTrace = new Map<string, RawSpan[]>();
  for (const s of spans) {
    const tid = String(s.trace_id);
    if (!spansByTrace.has(tid)) {
      spansByTrace.set(tid, []);
    }
    spansByTrace.get(tid)!.push(s);
  }

  const nodes: ExecutionGraphNode[] = [];
  const edges: ExecutionGraphEdge[] = [];

  const traceToolModeById = new Map<string, "parallel" | "sequential" | null>();
  for (const tr of traceRows) {
    traceToolModeById.set(
      tr.trace_id,
      parseToolExecutionModeFromTraceMeta(
        parseJsonObject(tr.metadata_json != null ? String(tr.metadata_json) : null),
      ),
    );
  }

  /** Trace header id prefix */
  const th = (traceId: string) => `th:${traceId}`;

  const traceTokenById = loadTraceTokenTotals(db, traceIds);

  for (const tr of traceRows) {
    const tid = tr.trace_id;
    const tt = String(tr.trace_type ?? "external");
    const createdRaw = tr.created_at_ms != null ? Number(tr.created_at_ms) : NaN;
    const createdAtMs = Number.isFinite(createdRaw) ? createdRaw : null;
    const endMs = traceEndTimeMs(tr);
    const durMs = traceDurationMs(tr, endMs);
    nodes.push({
      id: th(tid),
      trace_id: tid,
      thread_id: tr.thread_id,
      trace_type: tt,
      node_role: "trace",
      kind: traceTypeToHeaderKind(tt),
      name: tr.name ?? tt,
      model: null,
      provider: null,
      total_tokens: traceTokenById.get(tid) ?? 0,
      created_at_ms: createdAtMs,
      start_time_ms: createdAtMs,
      end_time_ms: endMs,
      duration_ms: durMs,
      tool_execution_mode: traceToolModeById.get(tid) ?? null,
    });
  }

  const spanKindById = new Map<string, string>();

  for (const s of spans) {
    const meta = parseJsonObject(s.metadata_json != null ? String(s.metadata_json) : null);
    const name = String(s.name ?? "");
    const st = String(s.span_type ?? "general");
    const kind = mapSpanTypeToApi(st, name, meta);
    const sid = String(s.span_id);
    spanKindById.set(sid, kind);
    const usage = parseUsageExtended(s.usage_json != null ? String(s.usage_json) : null);
    const tok = usage.total_tokens != null && Number.isFinite(usage.total_tokens) ? Math.max(0, usage.total_tokens) : 0;
    const stRaw = s.start_time_ms != null ? Number(s.start_time_ms) : NaN;
    const enRaw = s.end_time_ms != null ? Number(s.end_time_ms) : NaN;
    const startMs = Number.isFinite(stRaw) ? stRaw : null;
    const endMs = Number.isFinite(enRaw) ? enRaw : null;
    const traceIdStr = String(s.trace_id);
    const tem =
      kind === "LLM" ? traceToolModeById.get(traceIdStr) ?? null : null;
    nodes.push({
      id: sid,
      trace_id: traceIdStr,
      thread_id: traceById.get(traceIdStr)?.thread_id ?? null,
      trace_type: String(traceById.get(traceIdStr)?.trace_type ?? "external"),
      node_role: "span",
      kind,
      name: name || kind,
      model: s.model != null ? String(s.model) : null,
      provider: s.provider != null ? String(s.provider) : null,
      total_tokens: tok,
      created_at_ms: null,
      start_time_ms: startMs,
      end_time_ms: endMs,
      duration_ms: spanWallDurationMs(startMs, endMs),
      tool_execution_mode: tem,
    });
  }

  /** Span parent edges + trace header -> roots */
  for (const s of spans) {
    const sid = String(s.span_id);
    const tid = String(s.trace_id);
    const pid = s.parent_span_id != null ? String(s.parent_span_id).trim() : "";
    if (pid && spanIdSet.has(pid)) {
      const pk = spanKindById.get(pid);
      const ck = spanKindById.get(sid);
      const mode = traceToolModeById.get(tid) ?? null;
      const toolChild = ck === "TOOL" || ck === "SKILL" || ck === "MEMORY";
      const isLlmToolFanout = pk === "LLM" && toolChild && mode != null;
      let edgeKind: string;
      if (isLlmToolFanout) {
        edgeKind = mode === "parallel" ? "span_parent_parallel" : "span_parent_sequential";
      } else if (pk === "LLM" && ck === "MEMORY") {
        /** LLM→记忆检索（无 tool_execution_mode 时仍与普工具边区分） */
        edgeKind = "span_parent_memory";
      } else {
        edgeKind = "span_parent";
      }
      edges.push({
        id: `sp:${pid}->${sid}`,
        source: pid,
        target: sid,
        edge_kind: edgeKind,
        ...(isLlmToolFanout ? { tool_batch_mode: mode } : {}),
      });
    } else {
      edges.push({
        id: `tr:${tid}->${sid}`,
        source: th(tid),
        target: sid,
        edge_kind: "trace_to_root",
      });
    }
  }

  /** Cross-trace: child trace metadata parent_turn_id points at parent trace_id */
  const traceMetaParent = new Map<string, string>();
  for (const tr of traceRows) {
    const pref = tr.parent_turn_ref != null ? String(tr.parent_turn_ref).trim() : "";
    if (pref && traceById.has(pref) && pref !== tr.trace_id) {
      traceMetaParent.set(tr.trace_id, pref);
    }
  }

  for (const [childTid, parentTid] of traceMetaParent) {
    const parentSpans = spansByTrace.get(parentTid) ?? [];
    const childSpans = spansByTrace.get(childTid) ?? [];
    if (parentSpans.length === 0 || childSpans.length === 0) {
      /** Lineage only between headers */
      edges.push({
        id: `tl:${parentTid}->${childTid}`,
        source: th(parentTid),
        target: th(childTid),
        edge_kind: "trace_lineage",
      });
      continue;
    }
    const sortedParent = [...parentSpans].sort(
      (a, b) =>
        (Number(b.start_time_ms) || 0) - (Number(a.start_time_ms) || 0) ||
        String(b.span_id).localeCompare(String(a.span_id)),
    );
    const lastP = sortedParent[0]!;
    const sortedChild = [...childSpans].sort(
      (a, b) =>
        a.si - b.si ||
        (Number(a.start_time_ms) || 0) - (Number(b.start_time_ms) || 0) ||
        String(a.span_id).localeCompare(String(b.span_id)),
    );
    const firstC = sortedChild[0]!;
    const fromId = String(lastP.span_id);
    const toId = String(firstC.span_id);
    if (fromId !== toId) {
      edges.push({
        id: `xt:${fromId}->${toId}`,
        source: fromId,
        target: toId,
        edge_kind: "cross_trace",
      });
    }
  }

  return {
    thread_key: threadKey,
    nodes,
    edges,
    truncated,
    max_nodes: maxNodes,
  };
}
