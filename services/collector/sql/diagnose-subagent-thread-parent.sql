-- 诊断某条 subagent 线程为何没有 parent_thread_id（替换 :thread_id / 默认 workspace、project）。
-- 用法：
--   sqlite3 /path/to/opik.db
--   .parameter init
--   .parameter set @tid 'agent:email_automatic:subagent:320d128a-19ce-4a3f-8f2f-b9bba'
-- 然后粘贴下方查询；或直接把线程 id 写进 WHERE。

-- 线程行当前状态
SELECT thread_id, workspace_name, project_name, thread_type, parent_thread_id, channel_name
FROM opik_threads
WHERE thread_id = 'agent:email_automatic:subagent:320d128a-19ce-4a3f-8f2f-b9bba';

-- 该线程下 trace：是否有 metadata 锚点
SELECT
  trace_id,
  created_at_ms,
  json_extract(metadata_json, '$.anchor_parent_thread_id') AS anchor_parent_thread_id,
  json_extract(metadata_json, '$.parent_turn_id') AS parent_turn_id
FROM opik_traces
WHERE thread_id = 'agent:email_automatic:subagent:320d128a-19ce-4a3f-8f2f-b9bba'
ORDER BY created_at_ms ASC
LIMIT 20;

-- 若 metadata.parent_turn_id 非空：父 trace 落在哪个 thread（可回填来源）
SELECT
  c.trace_id AS child_trace_id,
  json_extract(c.metadata_json, '$.parent_turn_id') AS parent_turn_id,
  p.thread_id AS parent_trace_thread_id
FROM opik_traces AS c
LEFT JOIN opik_traces AS p ON COALESCE(
  NULLIF(TRIM(json_extract(c.metadata_json, '$.parent_turn_id')), ''),
  NULLIF(TRIM(json_extract(c.metadata_json, '$.parentTurnId')), '')
) = p.trace_id
WHERE c.thread_id = 'agent:email_automatic:subagent:320d128a-19ce-4a3f-8f2f-b9bba'
ORDER BY c.created_at_ms ASC
LIMIT 20;
