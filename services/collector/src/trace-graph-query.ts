import type Database from "better-sqlite3";
import { queryTracesInConversationScope } from "./thread-scope-query.js";
import { TRACE_ROW_TOKEN_INTEGER_EXPR } from "./opik-tokens-sql.js";

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

export type TraceGraphSkillSummary = {
  name: string;
  skill_id?: string;
};

export type TraceGraphNode = {
  id: string;
  thread_id: string | null;
  trace_type: string;
  /** 来自 metadata `parent_turn_id` / `parentTurnId`。 */
  parent_turn_ref: string | null;
  subagent_thread_id: string | null;
  name: string | null;
  is_complete: number;
  created_at_ms: number | null;
  /** 与 trace 列表同源 token 聚合。 */
  total_tokens: number;
  tool_call_count: number;
  /** 按 sort_index 第一条 llm span。 */
  primary_model: string | null;
  primary_provider: string | null;
  /** 本 trace 内所有 llm span 的去重 model 名（非空）。 */
  llm_models: string[];
  /** semantic_kind === skill 的 tool span。 */
  skills: TraceGraphSkillSummary[];
  total_cost: number | null;
  /** 预留：策略/合规标签（商业化扩展）。 */
  policy_tags: string[];
};

export type TraceGraphEdge = {
  id: string;
  source: string;
  target: string;
  /** Child trace type (for edge styling). */
  trace_type: string;
  /** 预留：边上成本估计（商业化扩展）。 */
  cost_estimate: number | null;
  policy_tags: string[];
};

export type TraceGraphResponse = {
  thread_key: string;
  nodes: TraceGraphNode[];
  edges: TraceGraphEdge[];
  /** 是否因 max_nodes 截断。 */
  truncated: boolean;
  max_nodes: number;
};

const DEFAULT_MAX_NODES = 80;
const ABS_MAX_NODES = 200;

function clampMaxNodes(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) {
    return DEFAULT_MAX_NODES;
  }
  const x = Math.floor(n);
  if (x < 1) {
    return 1;
  }
  if (x > ABS_MAX_NODES) {
    return ABS_MAX_NODES;
  }
  return x;
}

type SpanRow = {
  trace_id: string;
  span_type: string;
  name: string;
  model: string | null;
  provider: string | null;
  metadata_json: string | null;
  si: number;
};

function buildAggregatesFromSpans(
  spanRows: SpanRow[],
): Map<
  string,
  {
    primary_model: string | null;
    primary_provider: string | null;
    llm_models: string[];
    skills: TraceGraphSkillSummary[];
  }
> {
  const byTrace = new Map<
    string,
    {
      firstLlm: { model: string | null; provider: string | null } | null;
      llmModels: Set<string>;
      skills: TraceGraphSkillSummary[];
      skillKeys: Set<string>;
    }
  >();

  for (const r of spanRows) {
    const tid = r.trace_id;
    if (!byTrace.has(tid)) {
      byTrace.set(tid, {
        firstLlm: null,
        llmModels: new Set(),
        skills: [],
        skillKeys: new Set(),
      });
    }
    const rec = byTrace.get(tid)!;
    const st = String(r.span_type ?? "").toLowerCase();

    if (st === "llm") {
      if (rec.firstLlm == null) {
        rec.firstLlm = { model: r.model, provider: r.provider };
      }
      const m = r.model != null ? String(r.model).trim() : "";
      if (m) {
        rec.llmModels.add(m);
      }
    }

    if (st === "tool") {
      const meta = parseJsonObject(r.metadata_json != null ? String(r.metadata_json) : null);
      const sk =
        typeof meta.semantic_kind === "string"
          ? meta.semantic_kind.trim().toLowerCase()
          : typeof meta.semanticKind === "string"
            ? String(meta.semanticKind).trim().toLowerCase()
            : "";
      if (sk === "skill") {
        const sid =
          typeof meta.skill_id === "string"
            ? meta.skill_id.trim()
            : typeof meta.skillId === "string"
              ? String(meta.skillId).trim()
              : "";
        const sn =
          typeof meta.skill_name === "string"
            ? meta.skill_name.trim()
            : typeof meta.skillName === "string"
              ? String(meta.skillName).trim()
              : "";
        const nm = String(r.name ?? "").trim();
        const label = (sn || sid || nm).trim();
        if (!label) {
          continue;
        }
        const key = (sid || label).toLowerCase();
        if (rec.skillKeys.has(key)) {
          continue;
        }
        rec.skillKeys.add(key);
        const entry: TraceGraphSkillSummary = { name: label };
        if (sid) {
          entry.skill_id = sid;
        }
        rec.skills.push(entry);
      }
    }
  }

  const out = new Map<
    string,
    {
      primary_model: string | null;
      primary_provider: string | null;
      llm_models: string[];
      skills: TraceGraphSkillSummary[];
    }
  >();

  for (const [tid, v] of byTrace) {
    const pm = v.firstLlm?.model != null ? String(v.firstLlm.model).trim() : "";
    const pp = v.firstLlm?.provider != null ? String(v.firstLlm.provider).trim() : "";
    out.set(tid, {
      primary_model: pm || null,
      primary_provider: pp || null,
      llm_models: [...v.llmModels].sort((a, b) => a.localeCompare(b)),
      skills: v.skills,
    });
  }
  return out;
}

function loadTraceAggregates(
  db: Database.Database,
  traceIds: string[],
): {
  tokensAndTools: Map<
    string,
    { total_tokens: number; tool_call_count: number; total_cost: number | null }
  >;
  spanDerived: Map<
    string,
    {
      primary_model: string | null;
      primary_provider: string | null;
      llm_models: string[];
      skills: TraceGraphSkillSummary[];
    }
  >;
} {
  const emptyTokens = new Map<
    string,
    { total_tokens: number; tool_call_count: number; total_cost: number | null }
  >();
  const emptySpan = new Map<
    string,
    {
      primary_model: string | null;
      primary_provider: string | null;
      llm_models: string[];
      skills: TraceGraphSkillSummary[];
    }
  >();

  if (traceIds.length === 0) {
    return { tokensAndTools: emptyTokens, spanDerived: emptySpan };
  }

  const placeholders = traceIds.map(() => "?").join(", ");
  const tokenSql = `
SELECT t.trace_id,
       ${TRACE_ROW_TOKEN_INTEGER_EXPR} AS total_tokens,
       (SELECT COUNT(*) FROM opik_spans s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') AS tool_call_count,
       t.total_cost AS total_cost
FROM opik_traces t
WHERE t.trace_id IN (${placeholders})`;

  const tokenRows = db.prepare(tokenSql).all(...traceIds) as {
    trace_id: string;
    total_tokens: number | null;
    tool_call_count: number | null;
    total_cost: number | null;
  }[];

  const tokensAndTools = new Map<
    string,
    { total_tokens: number; tool_call_count: number; total_cost: number | null }
  >();
  for (const r of tokenRows) {
    const tid = String(r.trace_id ?? "");
    tokensAndTools.set(tid, {
      total_tokens: Number(r.total_tokens) || 0,
      tool_call_count: Number(r.tool_call_count) || 0,
      total_cost:
        r.total_cost != null && Number.isFinite(Number(r.total_cost)) ? Number(r.total_cost) : null,
    });
  }

  const spanSql = `
SELECT s.trace_id,
       s.span_type,
       s.name,
       s.model,
       s.provider,
       s.metadata_json,
       COALESCE(s.sort_index, 0) AS si
FROM opik_spans s
WHERE s.trace_id IN (${placeholders})
ORDER BY s.trace_id ASC, si ASC, s.span_id ASC`;

  const spanRows = db.prepare(spanSql).all(...traceIds) as SpanRow[];
  const spanDerived = buildAggregatesFromSpans(spanRows);

  return { tokensAndTools, spanDerived };
}

/**
 * React Flow：合并主 thread + 子链内 traces，边来自 metadata `parent_turn_id`；
 * 节点带 token / 模型 / tools / skills 聚合（与 trace 列表 token 表达式一致）。
 */
export function queryThreadTraceGraph(
  db: Database.Database,
  threadKey: string,
  options?: { maxNodes?: number },
): TraceGraphResponse {
  const maxNodes = clampMaxNodes(options?.maxNodes);
  const key = threadKey.trim();
  if (!key) {
    return { thread_key: "", nodes: [], edges: [], truncated: false, max_nodes: maxNodes };
  }
  let rows = queryTracesInConversationScope(db, key, true);
  const truncated = rows.length > maxNodes;
  if (truncated) {
    rows = rows.slice(0, maxNodes);
  }
  const idSet = new Set(rows.map((r) => r.trace_id));
  const traceIds = [...idSet];

  const { tokensAndTools, spanDerived } = loadTraceAggregates(db, traceIds);

  const nodes: TraceGraphNode[] = rows.map((r) => {
    const tid = r.trace_id;
    const tt = tokensAndTools.get(tid);
    const sp = spanDerived.get(tid);
    const total_tokens = tt?.total_tokens ?? 0;
    const tool_call_count = tt?.tool_call_count ?? 0;
    const total_cost = tt?.total_cost ?? null;
    return {
      id: tid,
      thread_id: r.thread_id,
      trace_type: String(r.trace_type ?? "external"),
      parent_turn_ref: r.parent_turn_ref,
      subagent_thread_id: r.subagent_thread_id,
      name: r.name,
      is_complete: typeof r.is_complete === "number" && Number.isFinite(r.is_complete) ? r.is_complete : 0,
      created_at_ms: r.created_at_ms,
      total_tokens,
      tool_call_count,
      primary_model: sp?.primary_model ?? null,
      primary_provider: sp?.primary_provider ?? null,
      llm_models: sp?.llm_models ?? [],
      skills: sp?.skills ?? [],
      total_cost,
      policy_tags: [],
    };
  });

  const edges: TraceGraphEdge[] = [];
  for (const r of rows) {
    const pid = r.parent_turn_ref != null ? String(r.parent_turn_ref).trim() : "";
    if (!pid || !idSet.has(pid)) {
      continue;
    }
    edges.push({
      id: `${pid}->${r.trace_id}`,
      source: pid,
      target: r.trace_id,
      trace_type: String(r.trace_type ?? "external"),
      cost_estimate: null,
      policy_tags: [],
    });
  }

  return { thread_key: key, nodes, edges, truncated, max_nodes: maxNodes };
}
