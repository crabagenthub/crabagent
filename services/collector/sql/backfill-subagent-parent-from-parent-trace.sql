-- 一次性修复：subagent 线程 parent_thread_id 仍为空，但某条 trace 的 metadata.parent_turn_id 指向**另一线程**上的父 trace。
-- 与 opik-batch-ingest 中 backfillSubagentThreadParentsFromTraces 逻辑一致。
-- 建议在 backfill-subagent-parent-from-metadata.sql 之后执行（先锚点、再 trace 树）。
--
-- 用法（SQLite）：
--   sqlite3 /path/to/opik.db < services/collector/sql/backfill-subagent-parent-from-parent-trace.sql

UPDATE opik_threads AS th
SET parent_thread_id = (
  SELECT p.thread_id
  FROM opik_traces AS t
  INNER JOIN opik_traces AS p ON COALESCE(
    NULLIF(TRIM(json_extract(t.metadata_json, '$.parent_turn_id')), ''),
    NULLIF(TRIM(json_extract(t.metadata_json, '$.parentTurnId')), '')
  ) = p.trace_id
  WHERE t.thread_id = th.thread_id
    AND t.workspace_name = th.workspace_name
    AND t.project_name = th.project_name
    AND p.thread_id IS NOT NULL
    AND TRIM(p.thread_id) != ''
    AND p.thread_id != t.thread_id
  ORDER BY t.created_at_ms ASC
  LIMIT 1
)
WHERE th.thread_type = 'subagent'
  AND (th.parent_thread_id IS NULL OR TRIM(th.parent_thread_id) = '');
