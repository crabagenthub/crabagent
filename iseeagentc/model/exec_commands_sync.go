package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"iseeagentc/internal/ingest"
	"iseeagentc/internal/shellexec"
	"iseeagentc/internal/sqlutil"
)

// syncShellSpanRecordsToExecCommands 将已拉取的 shell 工具 span 行写入 agent_exec_commands（与 ingest 路径一致）。
func syncShellSpanRecordsToExecCommands(tx *sql.Tx, db *sql.DB, now int64, cfg shellexec.ResourceAuditConfig, recs []shellSpanRecord) (int, error) {
	inserted := 0
	for _, r := range recs {
		st := ""
		if r.SpanType.Valid {
			st = r.SpanType.String
		}
		nm := ""
		if r.Name.Valid {
			nm = r.Name.String
		}
		var inStr, outStr, errJ, meta *string
		if r.InputJSON.Valid {
			s := r.InputJSON.String
			inStr = &s
		}
		if r.OutputJSON.Valid {
			s := r.OutputJSON.String
			outStr = &s
		}
		if r.ErrorInfoJSON.Valid {
			s := r.ErrorInfoJSON.String
			errJ = &s
		}
		if r.MetadataJSON.Valid {
			s := r.MetadataJSON.String
			meta = &s
		}
		var wsSpan string
		// 必须用 tx.QueryRow：SQLite MaxOpenConns=1 时，持有 tx 再 db.QueryRow 会阻塞等待连接 → 死锁。
		_ = tx.QueryRow(`SELECT workspace_name FROM `+CT.Spans+` WHERE span_id = ?`, r.SpanID).Scan(&wsSpan)
		wsSpan = strings.TrimSpace(wsSpan)

		var parPtr *string
		if r.ParentSpanID.Valid && strings.TrimSpace(r.ParentSpanID.String) != "" {
			p := strings.TrimSpace(r.ParentSpanID.String)
			parPtr = &p
		}
		var wsAug, projAug, tkAug, agAug, chAug *string
		var traceWS, proj, thid sql.NullString
		var ag, ch sql.NullString
		_ = tx.QueryRow(`SELECT workspace_name, project_name, thread_id FROM `+CT.Traces+` WHERE trace_id = ?`, r.TraceID).Scan(&traceWS, &proj, &thid)
		tws := strings.TrimSpace(wsSpan)
		if traceWS.Valid && strings.TrimSpace(traceWS.String) != "" {
			tws = strings.TrimSpace(traceWS.String)
		}
		if tws != "" {
			w := tws
			wsAug = &w
		}
		if proj.Valid && strings.TrimSpace(proj.String) != "" {
			p := strings.TrimSpace(proj.String)
			projAug = &p
		}
		tk := strings.TrimSpace(r.TraceID)
		if thid.Valid && strings.TrimSpace(thid.String) != "" {
			tk = strings.TrimSpace(thid.String)
		}
		tkAug = &tk
		if thid.Valid && proj.Valid && tws != "" {
			_ = tx.QueryRow(`SELECT agent_name, channel_name FROM `+CT.Threads+` WHERE thread_id = ? AND workspace_name = ? AND project_name = ?`,
				thid.String, tws, proj.String).Scan(&ag, &ch)
			if ag.Valid && strings.TrimSpace(ag.String) != "" {
				a := strings.TrimSpace(ag.String)
				agAug = &a
			}
			if ch.Valid && strings.TrimSpace(ch.String) != "" {
				c := strings.TrimSpace(ch.String)
				chAug = &c
			}
		}
		var stm, etm, dtm int64
		if r.StartTimeMs.Valid {
			stm = r.StartTimeMs.Int64
		}
		if r.EndTimeMs.Valid {
			etm = r.EndTimeMs.Int64
		}
		if r.DurationMs.Valid {
			dtm = r.DurationMs.Int64
		}
		if err := ingest.SyncAgentExecCommandRow(tx, db, now, cfg, r.SpanID, r.TraceID, parPtr, nm, st,
			stm, etm, dtm, tws, inStr, outStr, errJ, meta, wsAug, projAug, tkAug, agAug, chAug, true); err != nil {
			return inserted, err
		}
		inserted++
	}
	return inserted, nil
}

// ExecCommandsResyncDiagnostics 返回与重跑相关的行数，便于在 upserted=0 时判断是「库空」还是「无 shell 类 tool span」。
func ExecCommandsResyncDiagnostics(db *sql.DB) (allSpans, shellLikeSpans, execCommandRows int64, err error) {
	if db == nil {
		return 0, 0, 0, nil
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM ` + CT.Spans).Scan(&allSpans); err != nil {
		return 0, 0, 0, err
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM ` + CT.Spans + ` s WHERE ` + ShellToolWhereSQL).Scan(&shellLikeSpans); err != nil {
		return 0, 0, 0, err
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM ` + CT.ExecCommands).Scan(&execCommandRows); err != nil {
		return 0, 0, 0, err
	}
	return allSpans, shellLikeSpans, execCommandRows, nil
}

// ResyncExecCommandsOptions 控制 agent_exec_commands 重跑范围（可重复执行，UPSERT）。
type ResyncExecCommandsOptions struct {
	// SinceMs 仅处理 start_time_ms（或 trace.created_at_ms 回退）≥ 该值的 span；nil 表示不限制。
	SinceMs *int64
	// UntilMs 仅处理 ≤ 该值的 span；nil 表示不限制。
	UntilMs *int64
	// Batch 每轮拉取 span_id 数量，默认 400。
	Batch int
	// Once 为 true 时只跑一轮（便于试跑）；默认 false 直到扫完。
	Once bool
	// MaxRows 累计写入上限，0 表示不限制。
	MaxRows int
}

// ResyncAgentExecCommands 从 agent_spans 中按 Shell 规则重算并 UPSERT agent_exec_commands（全量或时间窗）。
// 与实时 ingest 共用 SyncAgentExecCommandRow（此处 trustSQLShellHint=true，与 ShellToolWhereSQL 选集一致），可安全多次执行。
func ResyncAgentExecCommands(db *sql.DB, opts ResyncExecCommandsOptions) (totalUpserted int, err error) {
	if db == nil {
		return 0, nil
	}
	batch := opts.Batch
	if batch <= 0 {
		batch = 400
	}
	cfg := shellexec.LoadResourceAuditConfig()
	offset := 0
	now := time.Now().UnixMilli()

	for {
		if opts.MaxRows > 0 && totalUpserted >= opts.MaxRows {
			break
		}
		lim := batch
		if opts.MaxRows > 0 {
			rest := opts.MaxRows - totalUpserted
			if rest < lim {
				lim = rest
			}
			if lim <= 0 {
				break
			}
		}

		ids, err := selectShellSpanIDsForExecResync(db, opts.SinceMs, opts.UntilMs, lim, offset)
		if err != nil {
			return totalUpserted, err
		}
		if len(ids) == 0 {
			break
		}
		recs, err := fetchShellRowsBySpanIDs(db, ids)
		if err != nil {
			return totalUpserted, err
		}
		tx, err := db.Begin()
		if err != nil {
			return totalUpserted, err
		}
		n, err := syncShellSpanRecordsToExecCommands(tx, db, now, cfg, recs)
		if err != nil {
			_ = tx.Rollback()
			return totalUpserted, err
		}
		if err := tx.Commit(); err != nil {
			return totalUpserted, err
		}
		totalUpserted += n
		offset += len(ids)
		if opts.Once {
			break
		}
		if len(ids) < lim {
			break
		}
	}
	return totalUpserted, nil
}

func selectShellSpanIDsForExecResync(db *sql.DB, sinceMs, untilMs *int64, limit, offset int) ([]string, error) {
	parts := []string{ShellToolWhereSQL}
	var args []any
	if sinceMs != nil && *sinceMs > 0 {
		parts = append(parts, fmt.Sprintf(`COALESCE(s.start_time_ms, %s, 0) >= ?`, traceCreatedAtMsSubSQL))
		args = append(args, *sinceMs)
	}
	if untilMs != nil && *untilMs > 0 {
		parts = append(parts, fmt.Sprintf(`COALESCE(s.start_time_ms, %s, 0) <= ?`, traceCreatedAtMsSubSQL))
		args = append(args, *untilMs)
	}
	q := fmt.Sprintf(`SELECT s.span_id FROM `+CT.Spans+` s WHERE %s ORDER BY s.span_id LIMIT ? OFFSET ?`, strings.Join(parts, " AND "))
	args = append(args, limit, offset)
	q = sqlutil.RebindIfPostgres(db, q)
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			return nil, err
		}
		if sid != "" {
			ids = append(ids, sid)
		}
	}
	return ids, rows.Err()
}
