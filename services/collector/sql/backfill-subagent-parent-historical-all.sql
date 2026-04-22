-- 历史 subagent 行 parent_thread_id 全量修复（两步，按顺序执行）。
-- 执行前请备份数据库。
--
-- 用法（SQLite）：
--   sqlite3 /path/to/opik.db < services/collector/sql/backfill-subagent-parent-historical-all.sql

-- 1) 从 trace metadata 的 anchor 字段回填
UPDATE opik_threads AS th
SET parent_thread_id = (
  SELECT COALESCE(
    NULLIF(TRIM(json_extract(t.metadata_json, '$.anchor_parent_thread_id')), ''),
    NULLIF(TRIM(json_extract(t.metadata_json, '$.anchorParentThreadId')), '')
  )
  FROM opik_traces AS t
  WHERE t.thread_id = th.thread_id
    AND t.workspace_name = th.workspace_name
    AND t.project_name = th.project_name
    AND t.metadata_json IS NOT NULL
    AND TRIM(t.metadata_json) != ''
    AND (
      NULLIF(TRIM(json_extract(t.metadata_json, '$.anchor_parent_thread_id')), '') IS NOT NULL
      OR NULLIF(TRIM(json_extract(t.metadata_json, '$.anchorParentThreadId')), '') IS NOT NULL
    )
  ORDER BY t.created_at_ms ASC
  LIMIT 1
)
WHERE th.thread_type = 'subagent'
  AND (th.parent_thread_id IS NULL OR TRIM(th.parent_thread_id) = '');

-- 2) 仍为空时，从 metadata.parent_turn_id → 父 trace 所在 thread_id 回填
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
