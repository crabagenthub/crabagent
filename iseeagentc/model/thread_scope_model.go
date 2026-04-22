package model

import (
	"database/sql"
	"strings"
)

var threadScopeRecursiveBody = `
  SELECT thread_id, workspace_name, project_name FROM ` + CT.Threads + ` WHERE thread_id = ?
  UNION ALL
  SELECT th.thread_id, th.workspace_name, th.project_name
  FROM ` + CT.Threads + ` th
  INNER JOIN thread_scope ts
    ON th.parent_thread_id = ts.thread_id
   AND th.workspace_name = ts.workspace_name
   AND th.project_name = ts.project_name`

func TracesInConversationScopeSQL(orderAsc bool) string {
	dir := "DESC"
	dirID := "DESC"
	if orderAsc {
		dir = "ASC"
		dirID = "ASC"
	}
	return `
WITH RECURSIVE thread_scope AS (` + threadScopeRecursiveBody + `)
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
FROM ` + CT.Traces + ` t
WHERE EXISTS (SELECT 1 FROM thread_scope s WHERE s.thread_id = t.thread_id AND s.workspace_name = t.workspace_name AND s.project_name = t.project_name)
   OR t.thread_id = ?
ORDER BY t.created_at_ms ` + dir + `, t.trace_id ` + dirID
}

type TraceRowScoped struct {
	TraceID          string
	ThreadID         sql.NullString
	WorkspaceName    string
	ProjectName      string
	ParentTurnRef    sql.NullString
	TraceType        string
	SubagentThreadID sql.NullString
	Name             sql.NullString
	InputJSON        sql.NullString
	OutputJSON       sql.NullString
	MetadataJSON     sql.NullString
	SettingJSON      sql.NullString
	CreatedAtMs      sql.NullInt64
	UpdatedAtMs      sql.NullInt64
	EndedAtMs        sql.NullInt64
	DurationMs       sql.NullInt64
	IsComplete       sql.NullInt64
}

func QueryTracesInConversationScope(db QueryDB, threadKey string, orderAsc bool) ([]TraceRowScoped, error) {
	key := strings.TrimSpace(threadKey)
	if key == "" {
		return nil, nil
	}
	rows, err := db.Query(TracesInConversationScopeSQL(orderAsc), key, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TraceRowScoped
	for rows.Next() {
		var r TraceRowScoped
		if err := rows.Scan(
			&r.TraceID, &r.ThreadID, &r.WorkspaceName, &r.ProjectName, &r.ParentTurnRef, &r.TraceType,
			&r.SubagentThreadID, &r.Name, &r.InputJSON, &r.OutputJSON, &r.MetadataJSON, &r.SettingJSON,
			&r.CreatedAtMs, &r.UpdatedAtMs, &r.EndedAtMs, &r.DurationMs, &r.IsComplete,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
