package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"iseeagentc/internal/ingest"
	"iseeagentc/internal/sqltables"
)

// resourceAccessSpanRecord represents a span record for resource access sync
type resourceAccessSpanRecord struct {
	SpanID        string
	TraceID       string
	Name          sql.NullString
	SpanType      sql.NullString
	StartTimeMs   sql.NullInt64
	EndTimeMs     sql.NullInt64
	DurationMs    sql.NullInt64
	InputJSON     sql.NullString
	OutputJSON    sql.NullString
	ErrorInfoJSON sql.NullString
	MetadataJSON  sql.NullString
}

// syncSpanRecordsToResourceAccess writes span records with resource metadata to agent_resource_access
func syncSpanRecordsToResourceAccess(tx *sql.Tx, db *sql.DB, now int64, recs []resourceAccessSpanRecord) (int, error) {
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
		_ = tx.QueryRow(`SELECT workspace_name FROM `+CT.Spans+` WHERE span_id = ?`, r.SpanID).Scan(&wsSpan)
		wsSpan = strings.TrimSpace(wsSpan)

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

		if err := ingest.SyncAgentResourceAccessRow(tx, db, now, r.SpanID, r.TraceID, nm, st,
			stm, etm, dtm, tws, inStr, outStr, errJ, meta, wsAug, projAug, tkAug, agAug, chAug); err != nil {
			return inserted, err
		}
		inserted++
	}
	return inserted, nil
}

// ResyncAgentResourceAccessOptions defines options for resyncing resource access data
type ResyncResourceAccessOptions struct {
	SinceMs   *int64
	UntilMs   *int64
	TraceID   *string
	Workspace *string
	BatchSize int
	MaxRows   int
}

// ResyncAgentResourceAccess recalculates and upserts agent_resource_access from agent_spans
func ResyncAgentResourceAccess(db *sql.DB, opts ResyncResourceAccessOptions) (totalUpserted int, err error) {
	if db == nil {
		return 0, nil
	}
	if opts.BatchSize <= 0 {
		opts.BatchSize = 300
	}

	// Build WHERE clause for spans with resource metadata
	where := "metadata_json IS NOT NULL AND metadata_json LIKE '%\"resource\":%'"
	args := []interface{}{}

	if opts.SinceMs != nil {
		where += " AND start_time_ms >= ?"
		args = append(args, *opts.SinceMs)
	}
	if opts.UntilMs != nil {
		where += " AND start_time_ms <= ?"
		args = append(args, *opts.UntilMs)
	}
	if opts.TraceID != nil && *opts.TraceID != "" {
		where += " AND trace_id = ?"
		args = append(args, *opts.TraceID)
	}
	if opts.Workspace != nil && *opts.Workspace != "" {
		where += " AND workspace_name = ?"
		args = append(args, *opts.Workspace)
	}

	q := fmt.Sprintf(`SELECT span_id FROM `+CT.Spans+` WHERE %s LIMIT ?`, where)
	queryArgs := append(args, opts.BatchSize)

	totalUpserted = 0
	for {
		if opts.MaxRows > 0 && totalUpserted >= opts.MaxRows {
			break
		}

		rows, err := db.Query(q, queryArgs...)
		if err != nil {
			return totalUpserted, err
		}

		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return totalUpserted, err
			}
			if id != "" {
				ids = append(ids, id)
			}
		}
		rows.Close()

		if len(ids) == 0 {
			break
		}

		recs, err := fetchResourceAccessSpanRecords(db, ids)
		if err != nil {
			return totalUpserted, err
		}

		now := time.Now().UnixMilli()
		tx, err := db.Begin()
		if err != nil {
			return totalUpserted, err
		}
		defer func() { _ = tx.Rollback() }()

		inserted, err := syncSpanRecordsToResourceAccess(tx, db, now, recs)
		if err != nil {
			return totalUpserted, err
		}
		if err := tx.Commit(); err != nil {
			return totalUpserted, err
		}

		totalUpserted += inserted
		if len(ids) < opts.BatchSize {
			break
		}
	}

	return totalUpserted, nil
}

// fetchResourceAccessSpanRecords fetches span records by IDs for resource access sync
func fetchResourceAccessSpanRecords(db *sql.DB, ids []string) ([]resourceAccessSpanRecord, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]

	q := fmt.Sprintf(`SELECT span_id, trace_id, name, span_type,
		start_time_ms, end_time_ms, duration_ms, input_json, output_json, error_info_json, metadata_json
		FROM %s WHERE span_id IN (%s)`, sqltables.TableAgentSpans, placeholders)

	args := make([]interface{}, len(ids))
	for i, id := range ids {
		args[i] = id
	}

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recs []resourceAccessSpanRecord
	for rows.Next() {
		var r resourceAccessSpanRecord
		err := rows.Scan(
			&r.SpanID, &r.TraceID, &r.Name, &r.SpanType,
			&r.StartTimeMs, &r.EndTimeMs, &r.DurationMs, &r.InputJSON, &r.OutputJSON, &r.ErrorInfoJSON, &r.MetadataJSON,
		)
		if err != nil {
			return nil, err
		}
		recs = append(recs, r)
	}

	return recs, nil
}
