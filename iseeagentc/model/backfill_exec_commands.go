package model

import (
	"database/sql"
	"fmt"
	"time"

	"iseeagentc/internal/shellexec"
)

// BackfillAgentExecCommands fills agent_exec_commands for existing shell-like tool spans that lack a row.
func BackfillAgentExecCommands(db *sql.DB, limit int) (inserted int, err error) {
	if db == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = 300
	}
	cfg := shellexec.LoadResourceAuditConfig()
	q := fmt.Sprintf(`SELECT s.span_id FROM `+CT.Spans+` s WHERE %s
 AND NOT EXISTS (SELECT 1 FROM `+CT.ExecCommands+` e WHERE e.span_id = s.span_id)
 LIMIT ?`, ShellToolWhereSQL)
	rows, err := db.Query(q, limit)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			rows.Close()
			return 0, err
		}
		if sid != "" {
			ids = append(ids, sid)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return 0, nil
	}
	recs, err := fetchShellRowsBySpanIDs(db, ids)
	if err != nil {
		return 0, err
	}
	now := time.Now().UnixMilli()
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	inserted, err = syncShellSpanRecordsToExecCommands(tx, db, now, cfg, recs)
	if err != nil {
		return inserted, err
	}
	if err := tx.Commit(); err != nil {
		return inserted, err
	}
	return inserted, nil
}
