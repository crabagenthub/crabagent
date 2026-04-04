import type Database from "better-sqlite3";
import { queryTracesInConversationScope } from "./thread-scope-query.js";

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
};

export type TraceGraphEdge = {
  id: string;
  source: string;
  target: string;
  /** Child trace type (for edge styling). */
  trace_type: string;
};

/**
 * React Flow 用：合并主 thread + `parent_thread_id` 子链内全部 traces，边来自 metadata 中的 parent turn 引用。
 */
export function queryThreadTraceGraph(
  db: Database.Database,
  threadKey: string,
): { thread_key: string; nodes: TraceGraphNode[]; edges: TraceGraphEdge[] } {
  const key = threadKey.trim();
  if (!key) {
    return { thread_key: "", nodes: [], edges: [] };
  }
  const rows = queryTracesInConversationScope(db, key, true);
  const nodes: TraceGraphNode[] = rows.map((r) => ({
    id: r.trace_id,
    thread_id: r.thread_id,
    trace_type: String(r.trace_type ?? "external"),
    parent_turn_ref: r.parent_turn_ref,
    subagent_thread_id: r.subagent_thread_id,
    name: r.name,
    is_complete: typeof r.is_complete === "number" && Number.isFinite(r.is_complete) ? r.is_complete : 0,
    created_at_ms: r.created_at_ms,
  }));
  const edges: TraceGraphEdge[] = [];
  for (const r of rows) {
    const pid = r.parent_turn_ref != null ? String(r.parent_turn_ref).trim() : "";
    if (!pid) {
      continue;
    }
    edges.push({
      id: `${pid}->${r.trace_id}`,
      source: pid,
      target: r.trace_id,
      trace_type: String(r.trace_type ?? "external"),
    });
  }
  return { thread_key: key, nodes, edges };
}
