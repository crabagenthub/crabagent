-- 一次性修复：subagent 线程行 parent_thread_id 为空，但已有 trace 在 metadata_json 中写了 anchor。
-- 在部署了 opik-batch-ingest 中 backfillSubagentThreadParentsFromTraceMetadata 之后，新数据会在每批末尾自动补全；
-- 本脚本用于历史库。执行前请备份数据库。
--
-- 若执行后仍有空 parent：库内可能仅有 metadata.parent_turn_id 链而无 anchor 元数据，请再执行：
--   backfill-subagent-parent-from-parent-trace.sql
-- 或一步跑齐：backfill-subagent-parent-historical-all.sql
-- 诊断单线程：diagnose-subagent-thread-parent.sql
--
-- 用法（SQLite）：
--   sqlite3 /path/to/opik.db < services/collector/sql/backfill-subagent-parent-from-metadata.sql

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
