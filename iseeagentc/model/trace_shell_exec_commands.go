package model

import (
	"database/sql"
	"fmt"
	"math"
	"strings"

	"iseeagentc/internal/shellexec"
	"iseeagentc/internal/sqlutil"
)

// agent_exec_commands 与 agent_traces 联结后的时间表达式（与原先 span+trace 语义对齐）。
func shellExecTimeMsExpr() string {
	return "COALESCE(e.start_time_ms, t.created_at_ms, 0)"
}

// shellThreadThJoinTraces 与 trace_shell_query_impl.shellThreadThJoinOn 相同语义，可指定 traces 表别名。
func shellThreadThJoinTraces(trAlias string) string {
	return fmt.Sprintf(`th.thread_id = %[1]s.thread_id
 AND th.workspace_name = %[1]s.workspace_name
 AND th.project_name = %[1]s.project_name`, trAlias)
}

func shellExecFromJoin() string {
	return `FROM ` + CT.ExecCommands + ` e INNER JOIN ` + CT.Traces + ` t ON t.trace_id = e.trace_id`
}

func buildExecCommandsWhere(db *sql.DB, q ShellExecBaseQuery) shellWhere {
	parts := []string{"1=1"}
	var params []any

	if q.SinceMs != nil && *q.SinceMs > 0 {
		parts = append(parts, shellExecTimeMsExpr()+` >= ?`)
		params = append(params, int64(math.Floor(float64(*q.SinceMs))))
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		parts = append(parts, shellExecTimeMsExpr()+` <= ?`)
		params = append(params, int64(math.Floor(float64(*q.UntilMs))))
	}
	if tid := strings.TrimSpace(q.TraceID); tid != "" {
		parts = append(parts, `e.trace_id = ?`)
		params = append(params, tid)
	}
	if sid := strings.TrimSpace(q.SpanID); sid != "" {
		parts = append(parts, `e.span_id = ?`)
		params = append(params, sid)
	}
	if wn := strings.TrimSpace(q.WorkspaceName); wn != "" {
		parts = append(parts, `LOWER(TRIM(COALESCE(e.workspace_name, t.workspace_name, ''))) = LOWER(TRIM(?))`)
		params = append(params, wn)
	}
	if ch := clampFacetFilter(q.Channel); ch != "" {
		parts = append(parts, `e.channel_name = ?`)
		params = append(params, ch)
	}
	if ag := clampFacetFilter(q.Agent); ag != "" {
		parts = append(parts, `e.agent_name = ?`)
		params = append(params, ag)
	}
	if cc := strings.TrimSpace(q.CommandContains); cc != "" {
		sub := cc
		if len(sub) > 200 {
			sub = sub[:200]
		}
		pat := "%" + strings.ReplaceAll(sub, `\`, `\\`) + "%"
		if sqlutil.IsSQLite(db) {
			parts = append(parts, `(instr(lower(e.command), lower(?)) > 0 OR instr(lower(e.command_key), lower(?)) > 0)`)
			params = append(params, sub, sub)
		} else {
			parts = append(parts, `(LOWER(e.command) LIKE LOWER(?) OR LOWER(e.command_key) LIKE LOWER(?))`)
			params = append(params, pat, pat)
		}
	}
	if q.MinDurationMs != nil && *q.MinDurationMs >= 0 {
		parts = append(parts, `COALESCE(e.duration_ms, 0) >= ?`)
		params = append(params, int64(math.Floor(float64(*q.MinDurationMs))))
	}
	if q.MaxDurationMs != nil && *q.MaxDurationMs >= 0 {
		parts = append(parts, `COALESCE(e.duration_ms, 0) <= ?`)
		params = append(params, int64(math.Floor(float64(*q.MaxDurationMs))))
	}
	return shellWhere{SQL: strings.Join(parts, " AND "), Params: params}
}

// BuildShellExecCountSQLFromExec 基于 agent_exec_commands 的总数（审计明细分页）。
func BuildShellExecCountSQLFromExec(db *sql.DB, q ShellExecBaseQuery) (string, []any) {
	w := buildExecCommandsWhere(db, q)
	sq := fmt.Sprintf(`SELECT COUNT(*) AS c %s WHERE %s`, shellExecFromJoin(), w.SQL)
	return sqlutil.RebindIfPostgres(db, sq), w.Params
}

type shellExecRecord struct {
	SpanID             string
	TraceID            string
	WorkspaceName      sql.NullString
	ProjectName        sql.NullString
	ThreadKey          sql.NullString
	AgentName          sql.NullString
	ChannelName        sql.NullString
	SpanName           string
	StartTimeMs        sql.NullInt64
	EndTimeMs          sql.NullInt64
	DurationMs         sql.NullInt64
	Command            string
	CommandKey         string
	Category           string
	Platform           string
	Status             sql.NullString
	ErrorInfo          sql.NullString
	StdoutLen          int64
	StderrLen          int64
	EstTokens          int64
	EstUsd             float64
	TokenRisk          int
	CmdNF              int
	Perm               int
	IllArg             int
	UserID             sql.NullString
	InputJSON          sql.NullString
	OutputJSON         sql.NullString
	ErrorInfoJSON      sql.NullString
	MetadataJSON       sql.NullString
	ThreadMetadataJSON sql.NullString
}

func scanShellExecRecordCore(sc interface {
	Scan(dest ...any) error
}) (shellExecRecord, error) {
	var r shellExecRecord
	err := sc.Scan(
		&r.SpanID, &r.TraceID,
		&r.WorkspaceName, &r.ProjectName, &r.ThreadKey, &r.AgentName, &r.ChannelName,
		&r.SpanName, &r.StartTimeMs, &r.EndTimeMs, &r.DurationMs,
		&r.Command, &r.CommandKey, &r.Category, &r.Platform,
		&r.Status, &r.ErrorInfo,
		&r.StdoutLen, &r.StderrLen, &r.EstTokens, &r.EstUsd,
		&r.TokenRisk, &r.CmdNF, &r.Perm, &r.IllArg,
		&r.UserID,
	)
	return r, err
}

func scanShellExecRecordWithSpan(sc interface {
	Scan(dest ...any) error
}) (shellExecRecord, error) {
	var r shellExecRecord
	err := sc.Scan(
		&r.SpanID, &r.TraceID,
		&r.WorkspaceName, &r.ProjectName, &r.ThreadKey, &r.AgentName, &r.ChannelName,
		&r.SpanName, &r.StartTimeMs, &r.EndTimeMs, &r.DurationMs,
		&r.Command, &r.CommandKey, &r.Category, &r.Platform,
		&r.Status, &r.ErrorInfo,
		&r.StdoutLen, &r.StderrLen, &r.EstTokens, &r.EstUsd,
		&r.TokenRisk, &r.CmdNF, &r.Perm, &r.IllArg,
		&r.UserID,
		&r.InputJSON, &r.OutputJSON, &r.ErrorInfoJSON, &r.MetadataJSON, &r.ThreadMetadataJSON,
	)
	return r, err
}

func shellExecSelectCols() string {
	return `e.span_id, e.trace_id,
 e.workspace_name, e.project_name, e.thread_key, e.agent_name, e.channel_name,
 e.span_name, e.start_time_ms, e.end_time_ms, e.duration_ms,
 e.command, e.command_key, e.category, e.platform,
 e.status, e.error_info,
 e.stdout_len, e.stderr_len, e.est_tokens, e.est_usd,
 e.token_risk, e.command_not_found, e.permission_denied, e.illegal_arg_hint,
 e.user_id`
}

func shellExecRecordToSpanRow(r shellExecRecord, cfg shellexec.ResourceAuditConfig) shellexec.SpanRow {
	nm := sql.NullString{String: r.SpanName, Valid: strings.TrimSpace(r.SpanName) != ""}
	st := sql.NullString{String: "tool", Valid: true}

	// Convert status to success bool for shellexec
	var success sql.NullInt64
	if r.Status.Valid {
		if r.Status.String == "success" {
			success = sql.NullInt64{Int64: 1, Valid: true}
		} else {
			success = sql.NullInt64{Int64: 0, Valid: true}
		}
	}

	p := shellexec.ParsedShellSpanFromExecDB(
		r.Command, r.CommandKey, r.Category, r.Platform,
		sql.NullInt64{}, success,
		int(r.StdoutLen), int(r.StderrLen),
		int(r.EstTokens), r.EstUsd,
		r.TokenRisk != 0,
		r.CmdNF != 0, r.Perm != 0, r.IllArg != 0,
		r.UserID,
		cfg,
	)
	return shellexec.SpanRow{
		SpanID:      r.SpanID,
		TraceID:     r.TraceID,
		Name:        nm,
		SpanType:    st,
		StartTimeMs: r.StartTimeMs,
		EndTimeMs:   r.EndTimeMs,
		DurationMs:  r.DurationMs,
		ThreadKey:   r.ThreadKey,
		AgentName:   r.AgentName,
		ChannelName: r.ChannelName,
		Preparsed:   &p,
	}
}

func fetchExecSpanIDRowsForSummary(db *sql.DB, whereSQL string, wp []any, cap int) ([]shellIDRow, error) {
	base := shellExecFromJoin() + ` WHERE ` + whereSQL
	var cnt int
	cq := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT COUNT(*) AS c %s`, base))
	if err := db.QueryRow(cq, wp...).Scan(&cnt); err != nil {
		return nil, err
	}
	if cnt == 0 {
		return nil, nil
	}
	if cnt <= cap {
		q := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT e.span_id, e.start_time_ms %s`, base))
		rows, err := db.Query(q, wp...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var raw []struct {
			SpanID      any
			StartTimeMs any
		}
		for rows.Next() {
			var sid any
			var stm any
			if err := rows.Scan(&sid, &stm); err != nil {
				return nil, err
			}
			raw = append(raw, struct {
				SpanID      any
				StartTimeMs any
			}{sid, stm})
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return normalizeShellIDRows(raw), nil
	}
	q := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT e.span_id, e.start_time_ms %s ORDER BY e.start_time_ms DESC, e.span_id DESC LIMIT ?`, base))
	args := append(append([]any{}, wp...), cap)
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var raw []struct {
		SpanID      any
		StartTimeMs any
	}
	for rows.Next() {
		var sid any
		var stm any
		if err := rows.Scan(&sid, &stm); err != nil {
			return nil, err
		}
		raw = append(raw, struct {
			SpanID      any
			StartTimeMs any
		}{sid, stm})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		q2 := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT e.span_id, e.start_time_ms %s LIMIT ?`, base))
		args2 := append(append([]any{}, wp...), cap)
		rows2, err := db.Query(q2, args2...)
		if err != nil {
			return nil, err
		}
		defer rows2.Close()
		for rows2.Next() {
			var sid any
			var stm any
			if err := rows2.Scan(&sid, &stm); err != nil {
				return nil, err
			}
			raw = append(raw, struct {
				SpanID      any
				StartTimeMs any
			}{sid, stm})
		}
		if err := rows2.Err(); err != nil {
			return nil, err
		}
	}
	return normalizeShellIDRows(raw), nil
}

func fetchExecRowsBySpanIDs(db *sql.DB, ids []string, cfg shellexec.ResourceAuditConfig) ([]shellexec.SpanRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	byID := make(map[string]shellExecRecord, len(ids))
	for i := 0; i < len(ids); i += shellInChunk {
		end := i + shellInChunk
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[i:end]
		ph := strings.Repeat("?,", len(chunk))
		ph = ph[:len(ph)-1]
		q := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT %s %s WHERE e.span_id IN (%s)`, shellExecSelectCols(), shellExecFromJoin(), ph))
		args := make([]any, len(chunk))
		for j, id := range chunk {
			args[j] = id
		}
		rows, err := db.Query(q, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			r, err := scanShellExecRecordCore(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			byID[r.SpanID] = r
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	out := make([]shellexec.SpanRow, 0, len(ids))
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			out = append(out, shellExecRecordToSpanRow(r, cfg))
		}
	}
	return out, nil
}

// FetchShellExecRowsForSummary 从 agent_exec_commands 加载摘要聚合行（带 Preparsed）。
func FetchShellExecRowsForSummary(db *sql.DB, q ShellExecBaseQuery) ([]shellexec.SpanRow, bool, error) {
	w := buildExecCommandsWhere(db, q)
	cap := summaryScanCap + 1
	idRows, err := fetchExecSpanIDRowsForSummary(db, w.SQL, w.Params, cap)
	if err != nil {
		return nil, false, err
	}
	sortShellIDRows(idRows, "desc")
	capped := len(idRows) > summaryScanCap
	fetchIDs := make([]string, 0, summaryScanCap)
	for i := 0; i < len(idRows) && i < summaryScanCap; i++ {
		fetchIDs = append(fetchIDs, idRows[i].SpanID)
	}
	cfg := shellexec.LoadResourceAuditConfig()
	rows, err := fetchExecRowsBySpanIDs(db, fetchIDs, cfg)
	if err != nil {
		return nil, false, err
	}
	return rows, capped, nil
}

func shellExecRecordToListItem(r shellExecRecord, cfg shellexec.ResourceAuditConfig) ShellExecListItem {
	// Convert status to success bool for shellexec
	var success sql.NullInt64
	if r.Status.Valid {
		if r.Status.String == "success" {
			success = sql.NullInt64{Int64: 1, Valid: true}
		} else {
			success = sql.NullInt64{Int64: 0, Valid: true}
		}
	}

	p := shellexec.ParsedShellSpanFromExecDB(
		r.Command, r.CommandKey, r.Category, r.Platform,
		sql.NullInt64{}, success,
		int(r.StdoutLen), int(r.StderrLen),
		int(r.EstTokens), r.EstUsd,
		r.TokenRisk != 0,
		r.CmdNF != 0, r.Perm != 0, r.IllArg != 0,
		r.UserID,
		cfg,
	)
	tool := "tool"
	return ShellExecListItem{
		SpanID:             r.SpanID,
		TraceID:            r.TraceID,
		Name:               strPtrOrNil(r.SpanName),
		SpanType:           &tool,
		StartTimeMs:        sqlNullInt64Ptr(r.StartTimeMs),
		EndTimeMs:          sqlNullInt64Ptr(r.EndTimeMs),
		DurationMs:         sqlNullInt64Ptr(r.DurationMs),
		InputJSON:          nullStrPtrToStrPtr(r.InputJSON),
		OutputJSON:         nullStrPtrToStrPtr(r.OutputJSON),
		ErrorInfoJSON:      nullStrPtrToStrPtr(r.ErrorInfoJSON),
		MetadataJSON:       nullStrPtrToStrPtr(r.MetadataJSON),
		ThreadMetadataJSON: nullStrPtrToStrPtr(r.ThreadMetadataJSON),
		ThreadKey:          nullStrPtrToStrPtr(r.ThreadKey),
		AgentName:          nullStrPtrToStrPtr(r.AgentName),
		ChannelName:        nullStrPtrToStrPtr(r.ChannelName),
		Parsed:             ToParsedShellSpanLite(p),
	}
}

func strPtrOrNil(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

// QueryShellExecListFromExec 审计明细分页（数据源 agent_exec_commands）。
func QueryShellExecListFromExec(db *sql.DB, q ShellExecListQuery) (ShellExecListResult, error) {
	var out ShellExecListResult
	w := buildExecCommandsWhere(db, q.ShellExecBaseQuery)
	csql, cparams := BuildShellExecCountSQLFromExec(db, q.ShellExecBaseQuery)
	if err := db.QueryRow(csql, cparams...).Scan(&out.Total); err != nil {
		return out, err
	}
	base := shellExecFromJoin() + ` WHERE ` + w.SQL
	var pageIDs []string
	if out.Total > 0 {
		if out.Total <= shellListJSSortMax {
			qry := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT e.span_id, e.start_time_ms %s`, base))
			rows, err := db.Query(qry, w.Params...)
			if err != nil {
				return out, err
			}
			var raw []struct {
				SpanID      any
				StartTimeMs any
			}
			for rows.Next() {
				var sid any
				var stm any
				if err := rows.Scan(&sid, &stm); err != nil {
					rows.Close()
					return out, err
				}
				raw = append(raw, struct {
					SpanID      any
					StartTimeMs any
				}{sid, stm})
			}
			rows.Close()
			idRows := normalizeShellIDRows(raw)
			sortShellIDRows(idRows, q.Order)
			allIDs := make([]string, len(idRows))
			for i := range idRows {
				allIDs[i] = idRows[i].SpanID
			}
			off := q.Offset
			if off < 0 {
				off = 0
			}
			lim := q.Limit
			if lim < 0 {
				lim = 0
			}
			end := off + lim
			if off > len(allIDs) {
				pageIDs = nil
			} else {
				if end > len(allIDs) {
					end = len(allIDs)
				}
				pageIDs = allIDs[off:end]
			}
		} else {
			dir := "DESC"
			if strings.ToLower(q.Order) == "asc" {
				dir = "ASC"
			}
			q1 := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT e.span_id %s ORDER BY e.start_time_ms %s, e.span_id %s LIMIT ? OFFSET ?`, base, dir, dir))
			args := append(append([]any{}, w.Params...), q.Limit, q.Offset)
			rows, err := db.Query(q1, args...)
			if err != nil {
				return out, err
			}
			var idRaw []string
			for rows.Next() {
				var sid any
				if err := rows.Scan(&sid); err != nil {
					rows.Close()
					return out, err
				}
				idRaw = append(idRaw, fmt.Sprint(sid))
			}
			rows.Close()
			if len(idRaw) == 0 {
				q2 := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT e.span_id %s LIMIT ? OFFSET ?`, base))
				args2 := append(append([]any{}, w.Params...), q.Limit, q.Offset)
				rows2, err := db.Query(q2, args2...)
				if err != nil {
					return out, err
				}
				for rows2.Next() {
					var sid any
					if err := rows2.Scan(&sid); err != nil {
						rows2.Close()
						return out, err
					}
					idRaw = append(idRaw, fmt.Sprint(sid))
				}
				rows2.Close()
			}
			for _, id := range idRaw {
				if id != "" {
					pageIDs = append(pageIDs, id)
				}
			}
		}
	}
	cfg := shellexec.LoadResourceAuditConfig()
	if len(pageIDs) == 0 {
		out.Items = []ShellExecListItem{}
		return out, nil
	}
	ph := strings.Repeat("?,", len(pageIDs))
	ph = ph[:len(ph)-1]
	qFull := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT %s,
 s.input_json, s.output_json, s.error_info_json, s.metadata_json,
 (SELECT th.metadata_json FROM `+CT.Traces+` t2
    LEFT JOIN `+CT.Threads+` th ON `+shellThreadThJoinTraces("t2")+`
  WHERE t2.trace_id = e.trace_id LIMIT 1) AS thread_metadata_json
 %s LEFT JOIN `+CT.Spans+` s ON s.span_id = e.span_id
 WHERE e.span_id IN (%s)`, shellExecSelectCols(), shellExecFromJoin(), ph))
	args := make([]any, len(pageIDs))
	for i, id := range pageIDs {
		args[i] = id
	}
	rows, err := db.Query(qFull, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	byID := make(map[string]shellExecRecord, len(pageIDs))
	for rows.Next() {
		r, err := scanShellExecRecordWithSpan(rows)
		if err != nil {
			return out, err
		}
		byID[r.SpanID] = r
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	items := make([]ShellExecListItem, 0, len(pageIDs))
	for _, id := range pageIDs {
		if r, ok := byID[id]; ok {
			items = append(items, shellExecRecordToListItem(r, cfg))
		}
	}
	out.Items = items
	return out, nil
}

// QueryShellExecDetailFromExec 详情：主数据 agent_exec_commands，可选联表 agent_spans 补预览。
func QueryShellExecDetailFromExec(db *sql.DB, spanID string) (*ShellExecDetailResult, error) {
	id := strings.TrimSpace(spanID)
	if id == "" {
		return nil, nil
	}
	q := sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT %s,
 s.input_json, s.output_json, s.error_info_json, s.metadata_json,
 (SELECT th.metadata_json FROM `+CT.Traces+` t2
    LEFT JOIN `+CT.Threads+` th ON `+shellThreadThJoinTraces("t2")+`
  WHERE t2.trace_id = e.trace_id LIMIT 1) AS thread_metadata_json
 %s LEFT JOIN `+CT.Spans+` s ON s.span_id = e.span_id
 WHERE e.span_id = ?`, shellExecSelectCols(), shellExecFromJoin()))
	row := db.QueryRow(q, id)
	r, err := scanShellExecRecordWithSpan(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	cfg := shellexec.LoadResourceAuditConfig()
	thr := cfg.ShellExec.TokenRisks.StdoutCharsThreshold

	// Convert status to success bool for shellexec
	var success sql.NullInt64
	if r.Status.Valid {
		if r.Status.String == "success" {
			success = sql.NullInt64{Int64: 1, Valid: true}
		} else {
			success = sql.NullInt64{Int64: 0, Valid: true}
		}
	}

	p := shellexec.ParsedShellSpanFromExecDB(
		r.Command, r.CommandKey, r.Category, r.Platform,
		sql.NullInt64{}, success,
		int(r.StdoutLen), int(r.StderrLen),
		int(r.EstTokens), r.EstUsd,
		r.TokenRisk != 0,
		r.CmdNF != 0, r.Perm != 0, r.IllArg != 0,
		r.UserID,
		cfg,
	)
	if r.InputJSON.Valid || r.OutputJSON.Valid || r.ErrorInfoJSON.Valid {
		in := nullStrPtrToStrPtr(r.InputJSON)
		out := nullStrPtrToStrPtr(r.OutputJSON)
		ej := nullStrPtrToStrPtr(r.ErrorInfoJSON)
		meta := nullStrPtrToStrPtr(r.MetadataJSON)
		th := nullStrPtrToStrPtr(r.ThreadMetadataJSON)
		p2 := shellexec.ParseShellSpanRow(in, out, ej, meta, th, cfg, &thr)
		if p2.StdoutPreview != nil {
			p.StdoutPreview = p2.StdoutPreview
		}
		if p2.StderrPreview != nil {
			p.StderrPreview = p2.StderrPreview
		}
	}
	tool := "tool"
	return &ShellExecDetailResult{
		SpanID:             r.SpanID,
		TraceID:            r.TraceID,
		Name:               strPtrOrNil(r.SpanName),
		SpanType:           &tool,
		StartTimeMs:        sqlNullInt64Ptr(r.StartTimeMs),
		EndTimeMs:          sqlNullInt64Ptr(r.EndTimeMs),
		DurationMs:         sqlNullInt64Ptr(r.DurationMs),
		InputJSON:          nullStrPtrToStrPtr(r.InputJSON),
		OutputJSON:         nullStrPtrToStrPtr(r.OutputJSON),
		ErrorInfoJSON:      nullStrPtrToStrPtr(r.ErrorInfoJSON),
		MetadataJSON:       nullStrPtrToStrPtr(r.MetadataJSON),
		ThreadMetadataJSON: nullStrPtrToStrPtr(r.ThreadMetadataJSON),
		ThreadKey:          nullStrPtrToStrPtr(r.ThreadKey),
		AgentName:          nullStrPtrToStrPtr(r.AgentName),
		ChannelName:        nullStrPtrToStrPtr(r.ChannelName),
		Parsed:             p,
	}, nil
}
