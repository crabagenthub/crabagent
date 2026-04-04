import type Database from "better-sqlite3";

/**
 * Recursive thread scope: seed rows in `opik_threads` with `thread_id = ?`, then all descendants via `parent_thread_id`.
 * Used for merged main + subagent conversation views (plan §4.6).
 */
const THREAD_SCOPE_RECURSIVE_BODY = `
  SELECT thread_id, workspace_name, project_name FROM opik_threads WHERE thread_id = ?
  UNION ALL
  SELECT th.thread_id, th.workspace_name, th.project_name
  FROM opik_threads th
  INNER JOIN thread_scope ts
    ON th.parent_thread_id = ts.thread_id
   AND th.workspace_name = ts.workspace_name
   AND th.project_name = ts.project_name`;

/** Also include traces whose `thread_id` matches key but thread row may be missing from scope (legacy / minimal ingest). */
export function tracesInConversationScopeSql(orderAsc: boolean): string {
  const dir = orderAsc ? "ASC" : "DESC";
  const dirId = orderAsc ? "ASC" : "DESC";
  return `
WITH RECURSIVE thread_scope AS (${THREAD_SCOPE_RECURSIVE_BODY})
SELECT t.trace_id,
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
FROM opik_traces t
WHERE EXISTS (SELECT 1 FROM thread_scope s WHERE s.thread_id = t.thread_id AND s.workspace_name = t.workspace_name AND s.project_name = t.project_name)
   OR t.thread_id = ?
ORDER BY t.created_at_ms ${dir}, t.trace_id ${dirId}`;
}

export type TraceRowScoped = {
  trace_id: string;
  thread_id: string | null;
  workspace_name: string;
  project_name: string;
  /** 来自 `metadata_json.parent_turn_id` / `parentTurnId`（已无 `opik_traces.parent_trace_id` 列）。 */
  parent_turn_ref: string | null;
  trace_type: string;
  subagent_thread_id: string | null;
  name: string | null;
  input_json: string | null;
  output_json: string | null;
  metadata_json: string | null;
  setting_json: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  ended_at_ms: number | null;
  duration_ms: number | null;
  is_complete: number | null;
};

export function queryTracesInConversationScope(
  db: Database.Database,
  threadKey: string,
  orderAsc: boolean,
): TraceRowScoped[] {
  const key = threadKey.trim();
  if (!key) {
    return [];
  }
  const sql = tracesInConversationScopeSql(orderAsc);
  return db.prepare(sql).all(key, key) as TraceRowScoped[];
}
