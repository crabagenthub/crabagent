package model

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"iseeagentc/internal/shellexec"
)

// --- SQL fragments (shell-exec-query.ts) ---

const shellHintInnerSQL = `(
    lower(trim(COALESCE(s.name, ''))) = 'exec'
    OR instr(lower(COALESCE(s.name, '')), 'bash') > 0
    OR instr(lower(COALESCE(s.name, '')), 'shell') > 0
    OR instr(lower(COALESCE(s.name, '')), 'terminal') > 0
    OR instr(lower(COALESCE(s.name, '')), 'pwsh') > 0
    OR instr(lower(COALESCE(s.name, '')), 'powershell') > 0
    OR instr(lower(COALESCE(s.name, '')), 'zsh') > 0
    OR instr(lower(COALESCE(s.name, '')), 'fish') > 0
    OR lower(trim(COALESCE(s.name, ''))) IN ('sh','ash','dash')
    OR instr(lower(COALESCE(s.name, '')), 'run_terminal') > 0
    OR instr(lower(COALESCE(s.name, '')), 'run_cmd') > 0
    OR instr(lower(COALESCE(s.name, '')), 'runcmd') > 0
    OR instr(lower(COALESCE(s.name, '')), 'subprocess') > 0
    OR instr(lower(COALESCE(s.name, '')), 'sandbox') > 0
    OR instr(lower(COALESCE(s.name, '')), 'local_shell') > 0
    OR instr(lower(COALESCE(s.name, '')), 'exec_command') > 0
    OR instr(lower(COALESCE(s.name, '')), 'execute_command') > 0
    OR instr(lower(COALESCE(s.name, '')), 'process_command') > 0
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.command')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.cmd')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.shell_command')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.command')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.line')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.executable')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.script')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.cwd')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.working_directory')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.workingDirectory')), '') IS NOT NULL
    OR (
      instr(lower(COALESCE(s.input_json, '')), '"cwd"') > 0
      AND instr(lower(COALESCE(s.input_json, '')), '"command"') > 0
    )
  )`

// ShellToolWhereSQL matches SHELL_TOOL_WHERE_SQL in TS.
const ShellToolWhereSQL = `(
  s.span_type = 'tool'
  AND ` + shellHintInnerSQL + `
)`

var traceCreatedAtMsSubSQL = "(SELECT t.created_at_ms FROM " + CT.Traces + " t WHERE t.trace_id = s.trace_id LIMIT 1)"

const shellThreadThJoinOn = `th.thread_id = t.thread_id
 AND th.workspace_name = t.workspace_name
 AND th.project_name = t.project_name`

var shellSelectRow = `
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.start_time_ms,
       s.end_time_ms,
       s.duration_ms,
       s.input_json,
       s.output_json,
       s.error_info_json,
       s.metadata_json,
       CAST(NULL AS TEXT) AS thread_metadata_json,
       s.trace_id AS thread_key,
       CAST(NULL AS TEXT) AS agent_name,
       CAST(NULL AS TEXT) AS channel_name
FROM ` + CT.Spans + ` s
`

var shellSelectRowDetail = `
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.start_time_ms,
       s.end_time_ms,
       s.duration_ms,
       s.input_json,
       s.output_json,
       s.error_info_json,
       s.metadata_json,
       (SELECT th.metadata_json FROM ` + CT.Traces + ` t
          LEFT JOIN ` + CT.Threads + ` th ON ` + shellThreadThJoinOn + `
        WHERE t.trace_id = s.trace_id LIMIT 1) AS thread_metadata_json,
       COALESCE(
         NULLIF(TRIM((SELECT t.thread_id FROM ` + CT.Traces + ` t WHERE t.trace_id = s.trace_id LIMIT 1)), ''),
         s.trace_id
       ) AS thread_key,
       (SELECT th.agent_name FROM ` + CT.Traces + ` t
          LEFT JOIN ` + CT.Threads + ` th ON ` + shellThreadThJoinOn + `
        WHERE t.trace_id = s.trace_id LIMIT 1) AS agent_name,
       (SELECT th.channel_name FROM ` + CT.Traces + ` t
          LEFT JOIN ` + CT.Threads + ` th ON ` + shellThreadThJoinOn + `
        WHERE t.trace_id = s.trace_id LIMIT 1) AS channel_name
FROM ` + CT.Spans + ` s
`

const summaryScanCap = 8000
const shellListJSSortMax = 50_000
const shellInChunk = 900

// --- Query types ---

type ShellExecBaseQuery struct {
	SinceMs         *int64
	UntilMs         *int64
	TraceID         string
	Channel         string
	Agent           string
	CommandContains string
	MinDurationMs   *int64
	MaxDurationMs   *int64
	WorkspaceName   string
}

type ShellExecListQuery struct {
	ShellExecBaseQuery
	Limit  int
	Offset int
	Order  string // "asc" or "desc"
}

func clampFacetFilter(s string) string {
	t := strings.TrimSpace(s)
	if t == "" {
		return ""
	}
	if len(t) > 200 {
		return t[:200]
	}
	return t
}

type shellWhere struct {
	SQL    string
	Params []any
}

func buildShellWhere(q ShellExecBaseQuery) shellWhere {
	parts := []string{ShellToolWhereSQL}
	var params []any

	if q.SinceMs != nil && *q.SinceMs > 0 {
		parts = append(parts, fmt.Sprintf(`COALESCE(s.start_time_ms, %s, 0) >= ?`, traceCreatedAtMsSubSQL))
		params = append(params, int64(math.Floor(float64(*q.SinceMs))))
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		parts = append(parts, fmt.Sprintf(`COALESCE(s.start_time_ms, %s, 0) <= ?`, traceCreatedAtMsSubSQL))
		params = append(params, int64(math.Floor(float64(*q.UntilMs))))
	}
	if tid := strings.TrimSpace(q.TraceID); tid != "" {
		parts = append(parts, `s.trace_id = ?`)
		params = append(params, tid)
	}
	if wn := strings.TrimSpace(q.WorkspaceName); wn != "" {
		parts = append(parts, `EXISTS (SELECT 1 FROM ` + CT.Traces + ` t WHERE t.trace_id = s.trace_id AND lower(t.workspace_name) = lower(?))`)
		params = append(params, wn)
	}
	if ch := clampFacetFilter(q.Channel); ch != "" {
		parts = append(parts, fmt.Sprintf(`EXISTS (SELECT 1 FROM ` + CT.Traces + ` t
        INNER JOIN ` + CT.Threads + ` th ON %s
        WHERE t.trace_id = s.trace_id AND th.channel_name = ?)`, shellThreadThJoinOn))
		params = append(params, ch)
	}
	if ag := clampFacetFilter(q.Agent); ag != "" {
		parts = append(parts, fmt.Sprintf(`EXISTS (SELECT 1 FROM ` + CT.Traces + ` t
        INNER JOIN ` + CT.Threads + ` th ON %s
        WHERE t.trace_id = s.trace_id AND th.agent_name = ?)`, shellThreadThJoinOn))
		params = append(params, ag)
	}
	if cc := strings.TrimSpace(q.CommandContains); cc != "" {
		sub := cc
		if len(sub) > 200 {
			sub = sub[:200]
		}
		parts = append(parts, `(instr(lower(COALESCE(s.input_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(s.name, '')), lower(?)) > 0)`)
		params = append(params, sub, sub)
	}
	if q.MinDurationMs != nil && *q.MinDurationMs >= 0 {
		parts = append(parts, `COALESCE(s.duration_ms, 0) >= ?`)
		params = append(params, int64(math.Floor(float64(*q.MinDurationMs))))
	}
	if q.MaxDurationMs != nil && *q.MaxDurationMs >= 0 {
		parts = append(parts, `COALESCE(s.duration_ms, 0) <= ?`)
		params = append(params, int64(math.Floor(float64(*q.MaxDurationMs))))
	}
	return shellWhere{SQL: strings.Join(parts, " AND "), Params: params}
}

// BuildShellExecCountSQL 已弃用：请使用 BuildShellExecCountSQLFromExec（数据源 agent_exec_commands）。
func BuildShellExecCountSQL(q ShellExecBaseQuery) (string, []any) {
	w := buildShellWhere(q)
	return fmt.Sprintf(`SELECT COUNT(*) AS c FROM ` + CT.Spans + ` s WHERE %s`, w.SQL), w.Params
}

// --- Row scanning ---

type shellSpanRecord struct {
	SpanID             string
	TraceID            string
	ParentSpanID       sql.NullString
	Name               sql.NullString
	SpanType           sql.NullString
	StartTimeMs        sql.NullInt64
	EndTimeMs          sql.NullInt64
	DurationMs         sql.NullInt64
	InputJSON          sql.NullString
	OutputJSON         sql.NullString
	ErrorInfoJSON      sql.NullString
	MetadataJSON       sql.NullString
	ThreadMetadataJSON sql.NullString
	ThreadKey          sql.NullString
	AgentName          sql.NullString
	ChannelName        sql.NullString
}

func scanShellSpanRecord(scanner interface {
	Scan(dest ...any) error
}) (shellSpanRecord, error) {
	var r shellSpanRecord
	err := scanner.Scan(
		&r.SpanID, &r.TraceID, &r.ParentSpanID, &r.Name, &r.SpanType,
		&r.StartTimeMs, &r.EndTimeMs, &r.DurationMs,
		&r.InputJSON, &r.OutputJSON, &r.ErrorInfoJSON, &r.MetadataJSON,
		&r.ThreadMetadataJSON, &r.ThreadKey, &r.AgentName, &r.ChannelName,
	)
	return r, err
}

func nullStrPtrToStrPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	v := ns.String
	return &v
}

func sqlNullInt64Ptr(ni sql.NullInt64) *int64 {
	if !ni.Valid {
		return nil
	}
	v := ni.Int64
	return &v
}

// ShellExecDbSnapshot mirrors TS ShellExecDbSnapshot.
type ShellExecDbSnapshot struct {
	ToolSpans         int         `json:"tool_spans"`
	ShellLikeSpans    int         `json:"shell_like_spans"`
	ExecCommandRows   int         `json:"exec_command_rows"`
	TopToolNames      []NameCount `json:"top_tool_names"`
	DBBasename        string      `json:"db_basename"`
}

type NameCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// QueryShellExecDbSnapshot implements queryShellExecDbSnapshot.
func QueryShellExecDbSnapshot(db *sql.DB, dbBasename string) (ShellExecDbSnapshot, error) {
	var snap ShellExecDbSnapshot
	if dbBasename == "" {
		snap.DBBasename = "(unknown)"
	} else {
		snap.DBBasename = dbBasename
	}
	if err := db.QueryRow(`SELECT COUNT(*) AS c FROM ` + CT.Spans + ` WHERE span_type = 'tool'`).Scan(&snap.ToolSpans); err != nil {
		return snap, err
	}
	if err := db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) AS c FROM ` + CT.Spans + ` s WHERE %s`, ShellToolWhereSQL)).Scan(&snap.ShellLikeSpans); err != nil {
		return snap, err
	}
	if err := db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) AS c FROM %s`, CT.ExecCommands)).Scan(&snap.ExecCommandRows); err != nil {
		return snap, err
	}
	rows, err := db.Query(`SELECT COALESCE(NULLIF(TRIM(name), ''), '(unnamed)') AS nm, COUNT(*) AS c
       FROM ` + CT.Spans + ` WHERE span_type = 'tool'
       GROUP BY nm ORDER BY c DESC LIMIT 12`)
	if err != nil {
		return snap, err
	}
	defer rows.Close()
	for rows.Next() {
		var nm string
		var c int
		if err := rows.Scan(&nm, &c); err != nil {
			return snap, err
		}
		snap.TopToolNames = append(snap.TopToolNames, NameCount{Name: nm, Count: c})
	}
	return snap, rows.Err()
}

type shellIDRow struct {
	SpanID      string
	StartTimeMs *int64
}

func normalizeShellIDRows(rows []struct {
	SpanID      any
	StartTimeMs any
}) []shellIDRow {
	out := make([]shellIDRow, 0, len(rows))
	for _, raw := range rows {
		sid := fmt.Sprint(raw.SpanID)
		if sid == "" {
			continue
		}
		var st *int64
		if raw.StartTimeMs != nil {
			switch v := raw.StartTimeMs.(type) {
			case int64:
				st = &v
			case float64:
				if isFiniteFloat(v) {
					x := int64(v)
					st = &x
				}
			case []byte:
				if n, err := strconv.ParseInt(string(v), 10, 64); err == nil {
					st = &n
				}
			}
		}
		out = append(out, shellIDRow{SpanID: sid, StartTimeMs: st})
	}
	return out
}

func fetchShellSpanIDRowsForSummary(db *sql.DB, whereSQL string, wp []any, cap int) ([]shellIDRow, error) {
	var cnt int
	if err := db.QueryRow(fmt.Sprintf(`SELECT COUNT(*) AS c FROM ` + CT.Spans + ` s WHERE %s`, whereSQL), wp...).Scan(&cnt); err != nil {
		return nil, err
	}
	if cnt == 0 {
		return nil, nil
	}
	if cnt <= cap {
		rows, err := db.Query(fmt.Sprintf(`SELECT s.span_id, s.start_time_ms FROM ` + CT.Spans + ` s WHERE %s`, whereSQL), wp...)
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
	q := fmt.Sprintf(`SELECT s.span_id, s.start_time_ms FROM ` + CT.Spans + ` s WHERE %s ORDER BY s.start_time_ms DESC, s.span_id DESC LIMIT ?`, whereSQL)
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
		q2 := fmt.Sprintf(`SELECT s.span_id, s.start_time_ms FROM ` + CT.Spans + ` s WHERE %s LIMIT ?`, whereSQL)
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

func sortShellIDRows(rows []shellIDRow, order string) {
	dir := 1
	if strings.ToLower(order) != "asc" {
		dir = -1
	}
	sort.Slice(rows, func(i, j int) bool {
		ti := int64(0)
		if rows[i].StartTimeMs != nil {
			ti = *rows[i].StartTimeMs
		}
		tj := int64(0)
		if rows[j].StartTimeMs != nil {
			tj = *rows[j].StartTimeMs
		}
		if ti != tj {
			if dir < 0 {
				return ti > tj
			}
			return ti < tj
		}
		cmp := strings.Compare(rows[i].SpanID, rows[j].SpanID)
		if dir < 0 {
			return cmp > 0
		}
		return cmp < 0
	})
}

func fetchShellRowsBySpanIDs(db *sql.DB, ids []string) ([]shellSpanRecord, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	byID := make(map[string]shellSpanRecord, len(ids))
	for i := 0; i < len(ids); i += shellInChunk {
		end := i + shellInChunk
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[i:end]
		ph := strings.Repeat("?,", len(chunk))
		ph = ph[:len(ph)-1]
		q := fmt.Sprintf(`%s WHERE s.span_id IN (%s)`, shellSelectRow, ph)
		args := make([]any, len(chunk))
		for j, id := range chunk {
			args[j] = id
		}
		rows, err := db.Query(q, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			r, err := scanShellSpanRecord(rows)
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
	out := make([]shellSpanRecord, 0, len(ids))
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}



// Re-export shell parsing / summary types from internal/shellexec for API stability.
type (
	ShellCommandCategory  = shellexec.ShellCommandCategory
	ResourceAuditConfig   = shellexec.ResourceAuditConfig
	ShellExecConfig       = shellexec.ShellExecConfig
	ShellCommandSemantics = shellexec.ShellCommandSemantics
	CommandCategories     = shellexec.CommandCategories
	DiagnosticPatterns    = shellexec.DiagnosticPatterns
	ShellCommandAstNode   = shellexec.ShellCommandAstNode
	ShellCommandAst       = shellexec.ShellCommandAst
	ParsedShellSpan       = shellexec.ParsedShellSpan
	ParsedShellSpanLite   = shellexec.ParsedShellSpanLite
	ShellSummaryJSON      = shellexec.ShellSummaryJSON
	ShellSummaryTotals    = shellexec.ShellSummaryTotals
	TrendDay              = shellexec.TrendDay
	DailyRiskDay          = shellexec.DailyRiskDay
	CommandCount          = shellexec.CommandCount
	SlowestEntry          = shellexec.SlowestEntry
	LoopAlert             = shellexec.LoopAlert
	TokenRiskEntry        = shellexec.TokenRiskEntry
	ShellDiagnostics      = shellexec.ShellDiagnostics
	ChainPreview          = shellexec.ChainPreview
	ChainStep             = shellexec.ChainStep
	RedundantReadHint     = shellexec.RedundantReadHint
	MetricBucket          = shellexec.MetricBucket
)

const (
	CategoryFile    = shellexec.CategoryFile
	CategoryNetwork = shellexec.CategoryNetwork
	CategorySystem  = shellexec.CategorySystem
	CategoryProcess = shellexec.CategoryProcess
	CategoryPackage = shellexec.CategoryPackage
	CategoryOther   = shellexec.CategoryOther
)

// ShellExecSummaryResponse is the shell summary API envelope.
type ShellExecSummaryResponse struct {
	ShellSummaryJSON
	DBSnapshot ShellExecDbSnapshot `json:"db_snapshot"`
}

func LoadResourceAuditConfig() ResourceAuditConfig { return shellexec.LoadResourceAuditConfig() }
func DefaultResourceAuditConfig() ResourceAuditConfig {
	return shellexec.DefaultResourceAuditConfig()
}
func ToParsedShellSpanLite(p ParsedShellSpan) ParsedShellSpanLite {
	return shellexec.ToParsedShellSpanLite(p)
}
func NormalizeCommandKeyForLoop(cmd string) string { return shellexec.NormalizeCommandKeyForLoop(cmd) }

func shellRecordToSpanRow(r shellSpanRecord) shellexec.SpanRow {
	return shellexec.SpanRow{
		SpanID: r.SpanID, TraceID: r.TraceID,
		ParentSpanID: r.ParentSpanID, Name: r.Name, SpanType: r.SpanType,
		StartTimeMs: r.StartTimeMs, EndTimeMs: r.EndTimeMs, DurationMs: r.DurationMs,
		InputJSON: r.InputJSON, OutputJSON: r.OutputJSON, ErrorInfoJSON: r.ErrorInfoJSON,
		MetadataJSON: r.MetadataJSON, ThreadMetadataJSON: r.ThreadMetadataJSON,
		ThreadKey: r.ThreadKey, AgentName: r.AgentName, ChannelName: r.ChannelName,
	}
}

// FetchShellSpanRowsForSummary loads up to summaryScanCap rows from agent_exec_commands for shell summary aggregation.
func FetchShellSpanRowsForSummary(db *sql.DB, q ShellExecBaseQuery) ([]shellexec.SpanRow, bool, error) {
	return FetchShellExecRowsForSummary(db, q)
}

// EnrichShellSummaryChainPreview fills chain_preview steps from agent_spans.
func EnrichShellSummaryChainPreview(db *sql.DB, summary *ShellSummaryJSON) {
	if summary == nil || summary.ChainPreview == nil || summary.ChainPreview.TraceID == "" {
		return
	}
	tid := summary.ChainPreview.TraceID
	q := fmt.Sprintf(`SELECT span_type, name, start_time_ms FROM %s WHERE trace_id = ?
         ORDER BY (start_time_ms IS NULL) ASC, start_time_ms ASC, sort_index ASC, span_id ASC
         LIMIT 48`, CT.Spans)
	srows, err := db.Query(q, tid)
	if err != nil {
		return
	}
	defer srows.Close()
	var steps []ChainStep
	for srows.Next() {
		var spanType, name sql.NullString
		var stm sql.NullInt64
		if err := srows.Scan(&spanType, &name, &stm); err != nil {
			break
		}
		st := "span"
		if spanType.Valid {
			if spanType.String == "llm" {
				st = "llm"
			} else if spanType.String == "tool" {
				st = "tool"
			} else {
				st = spanType.String
			}
		}
		nm := ""
		if name.Valid {
			nm = name.String
			if len(nm) > 120 {
				nm = nm[:120]
			}
		}
		steps = append(steps, ChainStep{Kind: st, Name: nm})
	}
	summary.ChainPreview.Steps = steps
}


// ShellExecListItem is one list row: span columns + parsed (lite).
type ShellExecListItem struct {
	SpanID             string              `json:"span_id"`
	TraceID            string              `json:"trace_id"`
	ParentSpanID       *string             `json:"parent_span_id"`
	Name               *string             `json:"name"`
	SpanType           *string             `json:"span_type"`
	StartTimeMs        *int64              `json:"start_time_ms"`
	EndTimeMs          *int64              `json:"end_time_ms"`
	DurationMs         *int64              `json:"duration_ms"`
	InputJSON          *string             `json:"input_json"`
	OutputJSON         *string             `json:"output_json"`
	ErrorInfoJSON      *string             `json:"error_info_json"`
	MetadataJSON       *string             `json:"metadata_json"`
	ThreadMetadataJSON *string             `json:"thread_metadata_json"`
	ThreadKey          *string             `json:"thread_key"`
	AgentName          *string             `json:"agent_name"`
	ChannelName        *string             `json:"channel_name"`
	Parsed             ParsedShellSpanLite `json:"parsed"`
}

func recordToListItem(r shellSpanRecord, lite ParsedShellSpanLite) ShellExecListItem {
	return ShellExecListItem{
		SpanID:             r.SpanID,
		TraceID:            r.TraceID,
		ParentSpanID:       nullStrPtrToStrPtr(r.ParentSpanID),
		Name:               nullStrPtrToStrPtr(r.Name),
		SpanType:           nullStrPtrToStrPtr(r.SpanType),
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
		Parsed:             lite,
	}
}

// ShellExecListResult mirrors queryShellExecList return.
type ShellExecListResult struct {
	Items []ShellExecListItem `json:"items"`
	Total int                 `json:"total"`
}

// QueryShellExecList implements queryShellExecList（数据源 agent_exec_commands）。
func QueryShellExecList(db *sql.DB, q ShellExecListQuery) (ShellExecListResult, error) {
	return QueryShellExecListFromExec(db, q)
}

// ShellExecDetailResult mirrors queryShellExecDetail spread row + parsed.
type ShellExecDetailResult struct {
	SpanID             string          `json:"span_id"`
	TraceID            string          `json:"trace_id"`
	ParentSpanID       *string         `json:"parent_span_id"`
	Name               *string         `json:"name"`
	SpanType           *string         `json:"span_type"`
	StartTimeMs        *int64          `json:"start_time_ms"`
	EndTimeMs          *int64          `json:"end_time_ms"`
	DurationMs         *int64          `json:"duration_ms"`
	InputJSON          *string         `json:"input_json"`
	OutputJSON         *string         `json:"output_json"`
	ErrorInfoJSON      *string         `json:"error_info_json"`
	MetadataJSON       *string         `json:"metadata_json"`
	ThreadMetadataJSON *string         `json:"thread_metadata_json"`
	ThreadKey          *string         `json:"thread_key"`
	AgentName          *string         `json:"agent_name"`
	ChannelName        *string         `json:"channel_name"`
	Parsed             ParsedShellSpan `json:"parsed"`
}

// QueryShellExecDetail implements queryShellExecDetail（主表 agent_exec_commands，可选联 spans 预览）。
func QueryShellExecDetail(db *sql.DB, spanID string) (*ShellExecDetailResult, error) {
	return QueryShellExecDetailFromExec(db, spanID)
}
