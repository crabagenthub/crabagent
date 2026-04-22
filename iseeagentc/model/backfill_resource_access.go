package model

import (
	"database/sql"
	"fmt"
	"time"

	"iseeagentc/internal/ingest"
	"iseeagentc/internal/sqltables"
)

// BackfillAgentResourceAccess fills agent_resource_access for existing spans with resource metadata that lack a row.
func BackfillAgentResourceAccess(db *sql.DB, limit int) (inserted int, err error) {
	if db == nil {
		return 0, nil
	}
	if limit <= 0 {
		limit = 300
	}

	// Find spans with resource metadata that don't have a corresponding row in agent_resource_access
	q := fmt.Sprintf(`SELECT s.span_id, s.trace_id, s.name, s.span_type,
	s.start_time_ms, s.end_time_ms, s.duration_ms, s.workspace_name,
	s.input_json, s.output_json, s.error_info_json, s.metadata_json
	FROM %s s
	WHERE s.metadata_json IS NOT NULL
	AND s.metadata_json LIKE '{"resource":%%'
	AND NOT EXISTS (SELECT 1 FROM %s r WHERE r.span_id = s.span_id)
	LIMIT ?`, "agent_spans", sqltables.TableAgentResourceAccess)

	rows, err := db.Query(q, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	now := time.Now().UnixMilli()
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	for rows.Next() {
		var spanID, traceID, name, spanType, workspaceName string
		var inputJSON, outputJSON, errorInfoJSON, metadataJSON sql.NullString
		var startTimeMs, endTimeMs, durationMs sql.NullInt64

		err := rows.Scan(
			&spanID, &traceID, &name, &spanType,
			&startTimeMs, &endTimeMs, &durationMs, &workspaceName,
			&inputJSON, &outputJSON, &errorInfoJSON, &metadataJSON,
		)
		if err != nil {
			return inserted, err
		}

		var inputJSONPtr, outputJSONPtr, errorInfoJSONPtr, metadataJSONPtr *string
		if inputJSON.Valid {
			inputJSONPtr = &inputJSON.String
		}
		if outputJSON.Valid {
			outputJSONPtr = &outputJSON.String
		}
		if errorInfoJSON.Valid {
			errorInfoJSONPtr = &errorInfoJSON.String
		}
		if metadataJSON.Valid {
			metadataJSONPtr = &metadataJSON.String
		}

		err = ingest.SyncAgentResourceAccessRow(
			tx, db, now,
			spanID, traceID,
			name, spanType, startTimeMs.Int64, endTimeMs.Int64, durationMs.Int64, workspaceName,
			inputJSONPtr, outputJSONPtr, errorInfoJSONPtr, metadataJSONPtr,
			nil, nil, nil, nil, nil,
		)
		if err != nil {
			return inserted, err
		}
		inserted++
	}

	if err := tx.Commit(); err != nil {
		return inserted, err
	}
	return inserted, nil
}
