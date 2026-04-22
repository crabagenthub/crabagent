-- 一次性修正示例：将误标为 system 的用户回合改为 external，并在 metadata 中把后续 trace 的 parent_turn_id 链到该 external。
-- 执行前请确认 trace_id 与 workspace/project；若库未启用 JSON1，可删掉 json_set 行仅更新列字段。
--
-- 案例：
--   40faac7b-bf2f-4757-9e08-0e91017f0e5b 应为 external（用户回合）
--   389fce7c-98e2-4efd-bb21-0fce4cc26361 的 metadata.parent_turn_id 应指向上述 trace

BEGIN TRANSACTION;

UPDATE opik_traces
SET
  trace_type = 'external',
  metadata_json = json_set(COALESCE(NULLIF(TRIM(metadata_json), ''), '{}'), '$.run_kind', 'external')
WHERE trace_id = '40faac7b-bf2f-4757-9e08-0e91017f0e5b';

UPDATE opik_traces
SET metadata_json = json_set(
  COALESCE(NULLIF(TRIM(metadata_json), ''), '{}'),
  '$.parent_turn_id',
  '40faac7b-bf2f-4757-9e08-0e91017f0e5b'
)
WHERE trace_id = '389fce7c-98e2-4efd-bb21-0fce4cc26361';

COMMIT;
