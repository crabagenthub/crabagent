package model

import (
	"database/sql"
	"strings"

	"iseeagentc/internal/ingest"
)

type OpikBatchResponse = ingest.OpikBatchResult

func ApplyOpikBatchDB(db QueryDB, body interface{}) (*OpikBatchResponse, error) {
	if db == nil {
		return &OpikBatchResponse{}, nil
	}
	return applyOpikBatch(db, body)
}

func applyOpikBatch(db QueryDB, body interface{}) (*OpikBatchResponse, error) {
	return ingest.ApplyOpikBatch(db, body)
}

func QueryLegacyTracesDB(db QueryDB, limit int) ([]map[string]interface{}, error) {
	if db == nil {
		return []map[string]interface{}{}, nil
	}
	rows, err := db.Query(`SELECT COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) AS thread_key, trace_id AS trace_root_id,
 NULL AS event_id, NULL AS session_id, NULL AS session_key, NULL AS agent_id, NULL AS agent_name, 'opik_trace' AS type,
 datetime(created_at_ms / 1000, 'unixepoch') AS created_at, 1 AS event_count, NULL AS channel, name AS chat_title
 FROM ` + CT.Traces + ` ORDER BY created_at_ms DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]map[string]interface{}, 0)
	for rows.Next() {
		var threadKey, traceRoot, typ, created, title interface{}
		var eid, sid, skey, aid, aname, ch sql.NullString
		var ec int64
		if err := rows.Scan(&threadKey, &traceRoot, &eid, &sid, &skey, &aid, &aname, &typ, &created, &ec, &ch, &title); err != nil {
			return nil, err
		}
		items = append(items, map[string]interface{}{
			"thread_key": threadKey, "trace_root_id": traceRoot, "event_id": nil, "session_id": nil, "session_key": nil,
			"agent_id": nil, "agent_name": nil, "type": typ, "created_at": created, "event_count": ec, "channel": nil, "chat_title": title,
		})
	}
	return items, nil
}

func QuerySessionTraceRootDB(db QueryDB, sessionID string) (string, error) {
	if db == nil {
		return "", sql.ErrNoRows
	}
	var traceID sql.NullString
	err := db.QueryRow(`
SELECT trace_id
FROM ` + CT.Traces + `
WHERE COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) = ?
ORDER BY created_at_ms ASC
LIMIT 1`, sessionID).Scan(&traceID)
	if err != nil {
		return "", err
	}
	if !traceID.Valid || strings.TrimSpace(traceID.String) == "" {
		return "", sql.ErrNoRows
	}
	return traceID.String, nil
}

func DeleteSessionDB(db QueryDB, sessionID string) (int64, error) {
	if db == nil {
		return 0, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.Query(`
SELECT trace_id
FROM ` + CT.Traces + `
WHERE COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) = ?`, sessionID)
	if err != nil {
		return 0, err
	}
	var traceIDs []string
	for rows.Next() {
		var tid string
		if err := rows.Scan(&tid); err == nil && strings.TrimSpace(tid) != "" {
			traceIDs = append(traceIDs, tid)
		}
	}
	_ = rows.Close()

	for _, tid := range traceIDs {
		_, _ = tx.Exec(`DELETE FROM ` + CT.SecurityAuditLogs + ` WHERE trace_id = ?`, tid)
	}
	res, err := tx.Exec(`
DELETE FROM ` + CT.Traces + `
WHERE COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) = ?`, sessionID)
	if err != nil {
		return 0, err
	}
	_, _ = tx.Exec(`DELETE FROM ` + CT.Threads + ` WHERE thread_id = ?`, sessionID)
	deleted, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return deleted, nil
}
