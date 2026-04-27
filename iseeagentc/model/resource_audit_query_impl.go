package model

import (
	"database/sql"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"iseeagentc/internal/calendardays"
	textparser "iseeagentc/internal/parser"
	"iseeagentc/internal/sqlutil"
)

const POLICY_HIT_UNTYPED = "policy_hit_untyped"

func isFiniteAuditFloat64(x float64) bool {
	return !math.IsNaN(x) && !math.IsInf(x, 0)
}

type ResourceAuditSemanticFilter string

const (
	SemanticAll    ResourceAuditSemanticFilter = "all"
	SemanticFile   ResourceAuditSemanticFilter = "file"
	SemanticMemory ResourceAuditSemanticFilter = "memory"
	SemanticToolIO ResourceAuditSemanticFilter = "tool_io"
)

// ResourceAuditListQuery 与 Node ResourceAuditListQuery 对齐。
type ResourceAuditListQuery struct {
	Limit         int
	Offset        int
	Order         string // "asc" | "desc"
	SinceMs       *int64
	UntilMs       *int64
	Search        *string
	SemanticClass *string // "all" | "file" | "memory" | "tool_io"
	URIPrefix     *string
	TraceID       *string
	SpanID        *string
	WorkspaceName *string
	PolicyID      *string
	SortMode      *string // "time_desc" | "risk_first" | "chars_desc"
	SpanName      *string
}

// RawAuditRow 为从 agent_resource_access 扫描的一行，供 MapRawRowToAuditEvent 使用。
type RawAuditRow struct {
	SpanID          string
	TraceID         string
	SpanName        string
	StartTimeMs     int64
	EndTimeMs       sql.NullInt64
	DurationMs      sql.NullInt64
	ResourceURI     string
	AccessMode      string
	SemanticKind    string
	Chars           sql.NullInt64
	ThreadKey       string
	WorkspaceName   string
	ProjectName     string
	PolicyHintFlags string
	PolicyHitAny    int
	URIRepeatCount  sql.NullInt64
}

type ResourceAuditEventJson struct {
	SpanID         string   `json:"span_id"`
	TraceID        string   `json:"trace_id"`
	ThreadKey      string   `json:"thread_key"`
	WorkspaceName  string   `json:"workspace_name"`
	ProjectName    string   `json:"project_name"`
	SpanName       string   `json:"span_name"`
	SpanType       string   `json:"span_type"`
	StartedAtMs    int64    `json:"started_at_ms"`
	DurationMs     *int64   `json:"duration_ms"`
	ResourceURI    string   `json:"resource_uri"`
	AccessMode     *string  `json:"access_mode"`
	Chars          *int64   `json:"chars"`
	SemanticClass  string   `json:"semantic_class"`
	URIRepeatCount int      `json:"uri_repeat_count"`
	RiskFlags      []string `json:"risk_flags"`
}

type ResourceAuditStatsJson struct {
	Summary struct {
		TotalEvents        int64    `json:"total_events"`
		DistinctTraces     int64    `json:"distinct_traces"`
		AvgDurationMs      *float64 `json:"avg_duration_ms"`
		RiskSensitivePath  int      `json:"risk_sensitive_path"`
		RiskPiiHint        int      `json:"risk_pii_hint"`
		RiskLargeRead      int      `json:"risk_large_read"`
		RiskRedundantRead  int      `json:"risk_redundant_read"`
		RiskAny            int      `json:"risk_any"`
		RiskSecretHint     int      `json:"risk_secret_hint"`
		RiskCredentialHint int      `json:"risk_credential_hint"`
		RiskConfigHint     int      `json:"risk_config_hint"`
		RiskDatabaseHint   int      `json:"risk_database_hint"`
	} `json:"summary"`
	TopResources []struct {
		URI           string   `json:"uri"`
		Count         int64    `json:"count"`
		SumChars      *float64 `json:"sum_chars"`
		AvgDurationMs *float64 `json:"avg_duration_ms"`
	} `json:"top_resources"`
	ClassDistribution []struct {
		SemanticClass string `json:"semantic_class"`
		Count         int64  `json:"count"`
	} `json:"class_distribution"`
	DailyIO []struct {
		Day           string   `json:"day"`
		EventCount    int64    `json:"event_count"`
		AvgDurationMs *float64 `json:"avg_duration_ms"`
	} `json:"daily_io"`
	TopTools []struct {
		SpanName string `json:"span_name"`
		Count    int64  `json:"count"`
	} `json:"top_tools"`
	ByWorkspace []struct {
		WorkspaceName string `json:"workspace_name"`
		Count         int64  `json:"count"`
	} `json:"by_workspace"`
}

func sqlCoalesceResourceUri(alias string) string {
	return fmt.Sprintf(`COALESCE(
    NULLIF(TRIM(json_extract(%s.metadata_json, '$.resource.uri')), ''),
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.path')), ''),
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.file_path')), ''),
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.target_file')), ''),
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.targetFile')), ''),
    ''
  )`, alias, alias, alias, alias, alias)
}

func sqlCommandTextExpr(alias string) string {
	return fmt.Sprintf(`COALESCE(
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.command')), ''),
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.cmd')), ''),
    NULLIF(TRIM(json_extract(%s.input_json, '$.params.shell_command')), ''),
    ''
  )`, alias, alias, alias)
}

func sqlLikelyFileCommandPredicate(alias string) string {
	cmd := fmt.Sprintf("lower(%s)", sqlCommandTextExpr(alias))
	return fmt.Sprintf(`(
    %s LIKE 'trash %%'
    OR %s LIKE 'rm %%'
    OR %s LIKE 'mv %%'
    OR %s LIKE 'cp %%'
  )`, cmd, cmd, cmd, cmd)
}

func normalizePathLike(v string, caseInsensitive bool) string {
	s := strings.ReplaceAll(strings.TrimSpace(v), "/", "\\")
	if caseInsensitive {
		return strings.ToLower(s)
	}
	return s
}

// sensitivePathFlags 与 Node sensitivePathFlags 一致。
func sensitivePathFlags(uri string, config ResourceAuditQueryConfig) []string {
	caseInsensitive := config.DangerousPathRules.CaseInsensitive
	u := normalizePathLike(uri, caseInsensitive)
	var flags []string
	for _, pref := range append(
		append([]string{}, config.DangerousPathRules.PosixPrefixes...),
		config.DangerousPathRules.WindowsPrefixes...,
	) {
		p := normalizePathLike(pref, caseInsensitive)
		if p == "" {
			continue
		}
		if strings.Contains(u, p) || strings.HasPrefix(u, p) {
			flags = append(flags, "sensitive_path")
			break
		}
	}
	for _, pattern := range config.DangerousPathRules.WindowsRegex {
		pat := pattern
		if caseInsensitive {
			pat = "(?i)" + pattern
		}
		re, err := regexp.Compile(pat)
		if err != nil {
			continue
		}
		if re.MatchString(uri) {
			flags = append(flags, "sensitive_path")
			break
		}
	}
	if strings.Contains(u, ".env") || strings.HasSuffix(u, ".pem") || strings.Contains(u, "private.key") {
		flags = append(flags, "sensitive_path")
	}
	return flags
}

func parseJSONObject(raw string) map[string]any {
	return textparser.ParseJSONObjectString(raw)
}

func strOf(v any) string {
	return textparser.StringValue(v)
}

func tokenizeShellCommand(command string) []string {
	return textparser.TokenizeShellCommand(command)
}

func commandPathFromParams(params map[string]any) string {
	command := strOf(params["command"])
	if command == "" {
		command = strOf(params["cmd"])
	}
	if command == "" {
		command = strOf(params["shell_command"])
	}
	if command == "" {
		return ""
	}
	tokens := tokenizeShellCommand(command)
	if len(tokens) < 2 {
		return ""
	}
	t0 := tokens[0]
	var bin string
	if idx := strings.LastIndex(t0, "/"); idx >= 0 {
		bin = strings.ToLower(t0[idx+1:])
	} else {
		bin = strings.ToLower(t0)
	}
	if bin != "trash" && bin != "rm" && bin != "mv" && bin != "cp" {
		return ""
	}
	for i := 1; i < len(tokens); i++ {
		t := strings.TrimSpace(tokens[i])
		if t == "" || strings.HasPrefix(t, "-") {
			continue
		}
		return t
	}
	return ""
}

func semanticClassFromRow(meta map[string]any, spanType string) string {
	if meta == nil {
		return "other"
	}
	kind := strOf(meta["semantic_kind"])
	switch kind {
	case "memory":
		return "memory"
	case "file":
		return "file"
	}
	if spanType == "tool" {
		return "tool_io"
	}
	return "other"
}

// policyHintFlagsRow extracts policy hint flags from policy_hint_flags column
// Policy hints are now separate from risk flags
func policyHintFlagsRow(policyHintFlagsRaw string, policyHitAny int, config ResourceAuditQueryConfig) []string {
	if !config.PolicyLink.Enabled {
		return nil
	}
	raw := strings.TrimSpace(policyHintFlagsRaw)
	if raw == "" {
		return nil
	}
	var out []string
	for _, x := range strings.Split(raw, ",") {
		n := strings.TrimSpace(x)
		if n != "" {
			out = append(out, n)
		}
	}
	return out
}

func buildWhere(q ResourceAuditListQuery, db QueryDB) (string, []any) {
	var parts []string
	var params []any

	// Determine database type for function selection
	isSQLite := sqlutil.IsSQLite(db)

	// Resource access table always has valid data
	parts = append(parts, `ra.resource_uri <> ''`)

	if q.SinceMs != nil && *q.SinceMs > 0 && isFiniteAuditFloat64(float64(*q.SinceMs)) {
		parts = append(parts, `COALESCE(ra.start_time_ms, 0) >= ?`)
		params = append(params, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 && isFiniteAuditFloat64(float64(*q.UntilMs)) {
		parts = append(parts, `COALESCE(ra.start_time_ms, 0) <= ?`)
		params = append(params, *q.UntilMs)
	}
	if q.WorkspaceName != nil {
		ws := strings.TrimSpace(*q.WorkspaceName)
		if ws != "" {
			parts = append(parts, `lower(COALESCE(NULLIF(TRIM(ra.workspace_name), ''), 'OpenClaw')) = lower(?)`)
			params = append(params, ws)
		}
	}

	if q.Search != nil {
		search := strings.TrimSpace(*q.Search)
		if len(search) > 200 {
			search = search[:200]
		}
		if search != "" {
			if isSQLite {
				parts = append(parts, `(instr(lower(ra.resource_uri), lower(?)) > 0
	        OR instr(lower(COALESCE(ra.span_name, '')), lower(?)) > 0
	        OR instr(lower(COALESCE(ra.trace_id, '')), lower(?)) > 0)`)
			} else {
				parts = append(parts, `(POSITION(lower(?) IN lower(ra.resource_uri)) > 0
	        OR POSITION(lower(?) IN lower(COALESCE(ra.span_name, ''))) > 0
	        OR POSITION(lower(?) IN lower(COALESCE(ra.trace_id, ''))) > 0)`)
			}
			for range 3 {
				params = append(params, search)
			}
		}
	}

	if q.URIPrefix != nil {
		pref := strings.TrimSpace(*q.URIPrefix)
		if pref != "" {
			if isSQLite {
				parts = append(parts, `instr(lower(ra.resource_uri), lower(?)) = 1`)
			} else {
				parts = append(parts, `POSITION(lower(?) IN lower(ra.resource_uri)) = 1`)
			}
			params = append(params, strings.ToLower(pref))
		}
	}

	if q.TraceID != nil {
		tid := strings.TrimSpace(*q.TraceID)
		if tid != "" {
			parts = append(parts, `ra.trace_id = ?`)
			params = append(params, tid)
		}
	}
	if q.SpanID != nil {
		sid := strings.TrimSpace(*q.SpanID)
		if sid != "" {
			parts = append(parts, `ra.span_id = ?`)
			params = append(params, sid)
		}
	}
	if q.SpanName != nil {
		sn := strings.TrimSpace(*q.SpanName)
		if sn != "" {
			parts = append(parts, `lower(COALESCE(ra.span_name, '')) = lower(?)`)
			params = append(params, sn)
		}
	}
	if q.PolicyID != nil {
		pid := strings.TrimSpace(*q.PolicyID)
		if pid != "" {
			parts = append(parts, `EXISTS (
      SELECT 1
      FROM `+CT.SecurityPolicyHits+` sal
      JOIN json_each(sal.findings_json) j
      WHERE sal.trace_id = ra.trace_id
        AND COALESCE(NULLIF(TRIM(sal.span_id), ''), '') = COALESCE(NULLIF(TRIM(ra.span_id), ''), '')
        AND COALESCE(json_extract(j.value, '$.policy_id'), '') = ?
    )`)
			params = append(params, pid)
		}
	}

	sc := SemanticAll
	if q.SemanticClass != nil && strings.TrimSpace(*q.SemanticClass) != "" {
		sc = ResourceAuditSemanticFilter(strings.TrimSpace(*q.SemanticClass))
	}
	switch sc {
	case SemanticFile:
		parts = append(parts, `ra.semantic_kind = 'file'`)
	case SemanticMemory:
		parts = append(parts, `ra.semantic_kind = 'memory'`)
	case SemanticToolIO:
		parts = append(parts, `ra.semantic_kind NOT IN ('memory', 'file')`)
	}

	if len(parts) == 0 {
		return "", params
	}
	return "WHERE " + strings.Join(parts, " AND "), params
}

// mapRawRowToAuditEvent maps from agent_resource_access table to ResourceAuditEventJson
func mapRawRowToAuditEvent(r RawAuditRow, config ResourceAuditQueryConfig) ResourceAuditEventJson {
	uri := r.ResourceURI

	var accessMode *string
	if r.AccessMode != "" {
		accessMode = &r.AccessMode
	}

	var chars *int64
	if r.Chars.Valid {
		c := r.Chars.Int64
		chars = &c
	}

	uriRepeat := 0
	if r.URIRepeatCount.Valid {
		uriRepeat = int(r.URIRepeatCount.Int64)
	}
	if uriRepeat < 0 {
		uriRepeat = 0
	}

	semanticClass := r.SemanticKind
	if semanticClass == "" {
		semanticClass = "other"
	}

	var riskFlags []string
	riskFlags = append(riskFlags, sensitivePathFlags(uri, config)...)
	riskFlags = append(riskFlags, policyHintFlagsRow(r.PolicyHintFlags, r.PolicyHitAny, config)...)

	if chars != nil && *chars >= int64(config.LargeRead.ThresholdChars) {
		riskFlags = append(riskFlags, "large_read")
	}
	if uriRepeat > 3 {
		riskFlags = append(riskFlags, "redundant_read")
	}
	riskFlags = uniqStrings(riskFlags)

	var durMs *int64
	if r.DurationMs.Valid {
		v := r.DurationMs.Int64
		durMs = &v
	}

	return ResourceAuditEventJson{
		SpanID:         r.SpanID,
		TraceID:        r.TraceID,
		SpanName:       r.SpanName,
		StartedAtMs:    r.StartTimeMs,
		DurationMs:     durMs,
		ResourceURI:    uri,
		AccessMode:     accessMode,
		Chars:          chars,
		SemanticClass:  semanticClass,
		URIRepeatCount: uriRepeat,
		RiskFlags:      riskFlags,
	}
}

func uniqStrings(in []string) []string {
	seen := make(map[string]struct{})
	var out []string
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func buildSpanAuditSelectSQL() string {
	return `SELECT ra.span_id,
       ra.trace_id,
       ra.span_name,
       ra.start_time_ms,
       ra.end_time_ms,
       ra.duration_ms,
       ra.resource_uri,
       ra.access_mode,
       ra.semantic_kind,
       ra.chars,
       COALESCE(NULLIF(TRIM(ra.thread_key), ''), ra.trace_id) AS thread_key,
       ra.workspace_name,
       ra.project_name,
       (
         SELECT GROUP_CONCAT(DISTINCT json_extract(j.value, '$.policy_name'))
         FROM ` + CT.SecurityPolicyHits + ` sal
         JOIN json_each(sal.findings_json) j
         WHERE sal.trace_id = ra.trace_id
           AND COALESCE(NULLIF(TRIM(sal.span_id), ''), '') = COALESCE(NULLIF(TRIM(ra.span_id), ''), '')
           AND COALESCE(NULLIF(TRIM(json_extract(j.value, '$.policy_name')), ''), '') <> ''
       ) AS policy_hint_flags,
       (
         SELECT CASE WHEN EXISTS (
           SELECT 1
           FROM ` + CT.SecurityPolicyHits + ` sal2
           WHERE sal2.trace_id = ra.trace_id
             AND COALESCE(NULLIF(TRIM(sal2.span_id), ''), '') = COALESCE(NULLIF(TRIM(ra.span_id), ''), '')
         ) THEN 1 ELSE 0 END
       ) AS policy_hit_any,
       ra.uri_repeat_count
FROM ` + CT.AgentResourceAccess + ` ra`
}

func nullStr(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

// countResourceAuditEvents 与 Node countResourceAuditEvents 一致。
func countResourceAuditEventsInternal(db QueryDB, q ResourceAuditListQuery) (int64, error) {
	whereSQL, params := buildWhere(q, db)
	query := `SELECT COUNT(*) AS n FROM ` + CT.AgentResourceAccess + ` ra ` + whereSQL
	var n int64
	if err := db.QueryRow(query, params...).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func riskFirstRank(ev ResourceAuditEventJson) int {
	flags := make(map[string]struct{})
	for _, f := range ev.RiskFlags {
		flags[f] = struct{}{}
	}
	if _, ok := flags["sensitive_path"]; ok {
		return 5
	}
	if _, ok := flags["large_read"]; ok {
		return 4
	}
	if _, ok := flags["pii_hint"]; ok {
		return 3
	}
	if _, ok := flags["redundant_read"]; ok {
		return 2
	}
	if len(ev.RiskFlags) > 0 {
		return 1
	}
	return 0
}

func nullableFloat64(ns sql.NullFloat64) *float64 {
	if !ns.Valid {
		return nil
	}
	x := ns.Float64
	return &x
}

func scanRawAuditRow(
	spanID, traceID sql.NullString,
	spanName sql.NullString,
	startTimeMs sql.NullInt64,
	endTimeMs sql.NullInt64,
	durationMs sql.NullInt64,
	resourceURI sql.NullString,
	accessMode sql.NullString,
	semanticKind sql.NullString,
	chars sql.NullInt64,
	threadKey, wsName, projName sql.NullString,
	policyFlags sql.NullString,
	policyHitAny sql.NullInt64,
	uriRepeat sql.NullInt64,
) RawAuditRow {
	ph := 0
	if policyHitAny.Valid {
		ph = int(policyHitAny.Int64)
	}
	stm := int64(0)
	if startTimeMs.Valid {
		stm = startTimeMs.Int64
	}
	return RawAuditRow{
		SpanID:          nullStr(spanID),
		TraceID:         nullStr(traceID),
		SpanName:        nullStr(spanName),
		StartTimeMs:     stm,
		EndTimeMs:       endTimeMs,
		DurationMs:      durationMs,
		ResourceURI:     nullStr(resourceURI),
		AccessMode:      nullStr(accessMode),
		SemanticKind:    nullStr(semanticKind),
		Chars:           chars,
		ThreadKey:       nullStr(threadKey),
		WorkspaceName:   nullStr(wsName),
		ProjectName:     nullStr(projName),
		PolicyHintFlags: nullStr(policyFlags),
		PolicyHitAny:    ph,
		URIRepeatCount:  uriRepeat,
	}
}

// queryResourceAuditEvents 与 Node queryResourceAuditEvents 一致（含 sort_mode 内存排序）。
func queryResourceAuditEventsInternal(db QueryDB, q ResourceAuditListQuery) ([]ResourceAuditEventJson, error) {
	cfg := LoadResourceAuditQueryConfig()
	order := "DESC"
	if strings.EqualFold(strings.TrimSpace(q.Order), "asc") {
		order = "ASC"
	}
	lim := q.Limit
	if lim < 1 {
		lim = 1
	}
	if lim > 500 {
		lim = 500
	}
	off := q.Offset
	if off < 0 {
		off = 0
	}
	whereSQL, params := buildWhere(q, db)
	sqlStr := buildSpanAuditSelectSQL() + " " + whereSQL +
		fmt.Sprintf(" ORDER BY ra.start_time_ms %s, ra.span_id %s LIMIT ? OFFSET ?", order, order)
	args := append(append([]any{}, params...), lim, off)
	rows, err := db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []ResourceAuditEventJson
	for rows.Next() {
		var spanID, traceID, spanName sql.NullString
		var startTimeMs, endTimeMs, durationMs sql.NullInt64
		var resourceURI, accessMode, semanticKind sql.NullString
		var chars sql.NullInt64
		var threadKey, ws, proj sql.NullString
		var polFlags sql.NullString
		var polHit sql.NullInt64
		var uriRep sql.NullInt64
		if err := rows.Scan(
			&spanID, &traceID, &spanName, &startTimeMs, &endTimeMs, &durationMs,
			&resourceURI, &accessMode, &semanticKind, &chars,
			&threadKey, &ws, &proj,
			&polFlags, &polHit, &uriRep,
		); err != nil {
			return nil, err
		}
		raw := scanRawAuditRow(spanID, traceID, spanName, startTimeMs, endTimeMs, durationMs,
			resourceURI, accessMode, semanticKind, chars,
			threadKey, ws, proj, polFlags, polHit, uriRep)
		events = append(events, mapRawRowToAuditEvent(raw, cfg))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sm := ""
	if q.SortMode != nil {
		sm = strings.TrimSpace(*q.SortMode)
	}
	switch sm {
	case "chars_desc":
		sort.SliceStable(events, func(i, j int) bool {
			ci := int64(-1)
			cj := int64(-1)
			if events[i].Chars != nil {
				ci = *events[i].Chars
			}
			if events[j].Chars != nil {
				cj = *events[j].Chars
			}
			return cj < ci
		})
	case "risk_first":
		sort.SliceStable(events, func(i, j int) bool {
			ra := riskFirstRank(events[i])
			rb := riskFirstRank(events[j])
			if ra != rb {
				return rb < ra
			}
			ci, cj := int64(-1), int64(-1)
			if events[i].Chars != nil {
				ci = *events[i].Chars
			}
			if events[j].Chars != nil {
				cj = *events[j].Chars
			}
			if ci != cj {
				return cj < ci
			}
			di, dj := int64(-1), int64(-1)
			if events[i].DurationMs != nil {
				di = *events[i].DurationMs
			}
			if events[j].DurationMs != nil {
				dj = *events[j].DurationMs
			}
			if di != dj {
				return dj < di
			}
			return events[j].StartedAtMs < events[i].StartedAtMs
		})
	}
	return events, nil
}

// queryResourceAuditStats 与 Node queryResourceAuditStats 一致。
func queryResourceAuditStatsInternal(db QueryDB, q ResourceAuditListQuery) (ResourceAuditStatsJson, error) {
	var out ResourceAuditStatsJson
	cfg := LoadResourceAuditQueryConfig()
	baseQ := q
	baseQ.Limit = 500
	baseQ.Offset = 0
	baseQ.Order = "desc"
	whereSQL, params := buildWhere(baseQ, db)

	summarySQL := fmt.Sprintf(`
SELECT COUNT(*) AS total_events,
       COUNT(DISTINCT ra.trace_id) AS distinct_traces,
       AVG(CAST(ra.duration_ms AS REAL)) AS avg_duration_ms
FROM `+CT.AgentResourceAccess+` ra
%s
`, whereSQL)

	var totalEv, distinctTr sql.NullInt64
	var avgDur sql.NullFloat64
	if err := db.QueryRow(summarySQL, params...).Scan(&totalEv, &distinctTr, &avgDur); err != nil {
		return out, err
	}
	if totalEv.Valid {
		out.Summary.TotalEvents = totalEv.Int64
	}
	if distinctTr.Valid {
		out.Summary.DistinctTraces = distinctTr.Int64
	}
	out.Summary.AvgDurationMs = nullableFloat64(avgDur)

	riskRowsSQL := fmt.Sprintf(`
SELECT ra.span_id,
       ra.resource_uri,
       CAST(ra.chars AS REAL) AS chars,
       ra.uri_repeat_count,
       ra.policy_hint_flags,
       (
         SELECT CASE WHEN EXISTS (
           SELECT 1
           FROM `+CT.SecurityPolicyHits+` sal2
           WHERE sal2.trace_id = ra.trace_id
             AND COALESCE(NULLIF(TRIM(sal2.span_id), ''), '') = COALESCE(NULLIF(TRIM(ra.span_id), ''), '')
         ) THEN 1 ELSE 0 END
       ) AS policy_hit_any
FROM `+CT.AgentResourceAccess+` ra
%s
`, whereSQL)

	riskRows, err := db.Query(riskRowsSQL, params...)
	if err != nil {

		return out, err
	}

	flagCounts := make(map[string]int)
	riskAny := 0
	for riskRows.Next() {
		var spanID sql.NullString
		var resURI sql.NullString
		var chars sql.NullFloat64
		var uriRep sql.NullInt64
		var polFlags sql.NullString
		var polHit sql.NullInt64
		if err := riskRows.Scan(&spanID, &resURI, &chars, &uriRep, &polFlags, &polHit); err != nil {
			riskRows.Close()
			return out, err
		}
		uri := nullStr(resURI)
		var charsPtr *int64
		if chars.Valid && isFiniteAuditFloat64(chars.Float64) {
			n := int64(chars.Float64)
			charsPtr = &n
		}
		ur := 0
		if uriRep.Valid {
			ur = int(uriRep.Int64)
		}
		ph := 0
		if polHit.Valid {
			ph = int(polHit.Int64)
		}
		var flags []string
		flags = append(flags, sensitivePathFlags(uri, cfg)...)
		flags = append(flags, policyHintFlagsRow(nullStr(polFlags), ph, cfg)...)
		if charsPtr != nil && *charsPtr >= int64(cfg.LargeRead.ThresholdChars) {
			flags = append(flags, "large_read")
		}
		if ur > 3 {
			flags = append(flags, "redundant_read")
		}
		uniq := uniqStrings(flags)
		if len(uniq) > 0 {
			riskAny++
		}
		for _, flag := range uniq {
			flagCounts[flag] = flagCounts[flag] + 1
		}
	}
	if err := riskRows.Err(); err != nil {
		riskRows.Close()
		return out, err
	}
	riskRows.Close()

	countByFlag := func(flag string) int { return flagCounts[flag] }
	out.Summary.RiskDatabaseHint = countByFlag("database_hint")
	out.Summary.RiskSensitivePath = countByFlag("sensitive_path")
	out.Summary.RiskPiiHint = countByFlag("pii_hint")
	out.Summary.RiskLargeRead = countByFlag("large_read")
	out.Summary.RiskRedundantRead = countByFlag("redundant_read")
	out.Summary.RiskAny = riskAny
	out.Summary.RiskSecretHint = countByFlag("secret_hint")
	out.Summary.RiskCredentialHint = countByFlag("credential_hint")
	out.Summary.RiskConfigHint = countByFlag("config_hint")

	topSQL := fmt.Sprintf(`
SELECT ra.resource_uri AS uri,
       COUNT(*) AS cnt,
       SUM(CAST(ra.chars AS REAL)) AS sum_chars,
       AVG(CAST(ra.duration_ms AS REAL)) AS avg_dur
FROM `+CT.AgentResourceAccess+` ra
%s
GROUP BY uri
HAVING uri <> ''
ORDER BY cnt DESC
LIMIT 10
`, whereSQL)
	topRows, err := db.Query(topSQL, params...)
	if err != nil {
		return out, err
	}
	for topRows.Next() {
		var uri sql.NullString
		var cnt sql.NullInt64
		var sumChars, avgDur sql.NullFloat64
		if err := topRows.Scan(&uri, &cnt, &sumChars, &avgDur); err != nil {
			topRows.Close()
			return out, err
		}
		out.TopResources = append(out.TopResources, struct {
			URI           string   `json:"uri"`
			Count         int64    `json:"count"`
			SumChars      *float64 `json:"sum_chars"`
			AvgDurationMs *float64 `json:"avg_duration_ms"`
		}{
			URI:           nullStr(uri),
			Count:         cnt.Int64,
			SumChars:      nullableFloat64(sumChars),
			AvgDurationMs: nullableFloat64(avgDur),
		})
	}
	topRows.Close()
	classSQL := fmt.Sprintf(`
SELECT CASE
  WHEN ra.semantic_kind = 'memory' THEN 'memory'
  WHEN ra.semantic_kind = 'file' THEN 'file'
  ELSE 'tool_io'
END AS semantic_class,
COUNT(*) AS cnt
FROM `+CT.AgentResourceAccess+` ra
%s
GROUP BY semantic_class
`, whereSQL)
	classRows, err := db.Query(classSQL, params...)
	if err != nil {
		return out, err
	}
	for classRows.Next() {
		var sc sql.NullString
		var cnt sql.NullInt64
		if err := classRows.Scan(&sc, &cnt); err != nil {
			classRows.Close()
			return out, err
		}
		out.ClassDistribution = append(out.ClassDistribution, struct {
			SemanticClass string `json:"semantic_class"`
			Count         int64  `json:"count"`
		}{SemanticClass: nullStr(sc), Count: cnt.Int64})
	}
	classRows.Close()

	var dailySQL string
	if sqlutil.IsSQLite(db) {
		dailySQL = fmt.Sprintf(`
SELECT strftime('%%Y-%%m-%%d', datetime(CAST(COALESCE(ra.start_time_ms, 0) AS REAL) / 1000, 'unixepoch')) AS day,
       COUNT(*) AS n,
       AVG(CAST(ra.duration_ms AS REAL)) AS avg_dur
FROM `+CT.AgentResourceAccess+` ra
%s
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
LIMIT 90
`, whereSQL)
	} else {
		dailySQL = fmt.Sprintf(`
SELECT TO_CHAR(TO_TIMESTAMP(COALESCE(ra.start_time_ms, 0) / 1000.0), 'YYYY-MM-DD') AS day,
       COUNT(*) AS n,
       AVG(CAST(ra.duration_ms AS REAL)) AS avg_dur
FROM `+CT.AgentResourceAccess+` ra
%s
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
LIMIT 90
`, whereSQL)
	}
	dailyRows, err := db.Query(dailySQL, params...)
	if err != nil {
		return out, err
	}

	for dailyRows.Next() {
		var day sql.NullString
		var n sql.NullInt64
		var ad sql.NullFloat64
		if err := dailyRows.Scan(&day, &n, &ad); err != nil {
			dailyRows.Close()
			return out, err
		}
		out.DailyIO = append(out.DailyIO, struct {
			Day           string   `json:"day"`
			EventCount    int64    `json:"event_count"`
			AvgDurationMs *float64 `json:"avg_duration_ms"`
		}{Day: nullStr(day), EventCount: n.Int64, AvgDurationMs: nullableFloat64(ad)})
	}
	dailyRows.Close()

	if q.SinceMs != nil && q.UntilMs != nil && *q.SinceMs > 0 && *q.UntilMs >= *q.SinceMs {
		type dailyRow = struct {
			Day           string   `json:"day"`
			EventCount    int64    `json:"event_count"`
			AvgDurationMs *float64 `json:"avg_duration_ms"`
		}
		keys := calendardays.UTCYMDInclusive(*q.SinceMs, *q.UntilMs, calendardays.DefaultMaxTrendDays)
		if len(keys) > 0 {
			byDay := make(map[string]dailyRow, len(out.DailyIO))
			for _, r := range out.DailyIO {
				if strings.TrimSpace(r.Day) == "" {
					continue
				}
				byDay[r.Day] = r
			}
			filled := make([]struct {
				Day           string   `json:"day"`
				EventCount    int64    `json:"event_count"`
				AvgDurationMs *float64 `json:"avg_duration_ms"`
			}, 0, len(keys))
			for _, d := range keys {
				if r, ok := byDay[d]; ok {
					filled = append(filled, struct {
						Day           string   `json:"day"`
						EventCount    int64    `json:"event_count"`
						AvgDurationMs *float64 `json:"avg_duration_ms"`
					}{Day: r.Day, EventCount: r.EventCount, AvgDurationMs: r.AvgDurationMs})
				} else {
					filled = append(filled, struct {
						Day           string   `json:"day"`
						EventCount    int64    `json:"event_count"`
						AvgDurationMs *float64 `json:"avg_duration_ms"`
					}{Day: d, EventCount: 0, AvgDurationMs: nil})
				}
			}
			out.DailyIO = filled
		}
	}

	// Build WHERE clause for traces/spans tables
	var traceWhereParts []string
	var traceParams []any
	if q.SinceMs != nil && *q.SinceMs > 0 && isFiniteAuditFloat64(float64(*q.SinceMs)) {
		traceWhereParts = append(traceWhereParts, `COALESCE(s.start_time_ms, 0) >= ?`)
		traceParams = append(traceParams, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 && isFiniteAuditFloat64(float64(*q.UntilMs)) {
		traceWhereParts = append(traceWhereParts, `COALESCE(s.start_time_ms, 0) <= ?`)
		traceParams = append(traceParams, *q.UntilMs)
	}
	if q.WorkspaceName != nil {
		ws := strings.TrimSpace(*q.WorkspaceName)
		if ws != "" {
			traceWhereParts = append(traceWhereParts, `lower(COALESCE(NULLIF(TRIM(t.workspace_name), ''), 'OpenClaw')) = lower(?)`)
			traceParams = append(traceParams, ws)
		}
	}
	if q.TraceID != nil {
		tid := strings.TrimSpace(*q.TraceID)
		if tid != "" {
			traceWhereParts = append(traceWhereParts, `s.trace_id = ?`)
			traceParams = append(traceParams, tid)
		}
	}
	if q.SpanID != nil {
		sid := strings.TrimSpace(*q.SpanID)
		if sid != "" {
			traceWhereParts = append(traceWhereParts, `s.span_id = ?`)
			traceParams = append(traceParams, sid)
		}
	}
	traceWhereSQL := ""
	if len(traceWhereParts) > 0 {
		traceWhereSQL = "WHERE " + strings.Join(traceWhereParts, " AND ")
	}

	toolsSQL := fmt.Sprintf(`
SELECT COALESCE(NULLIF(TRIM(s.name), ''), '(unnamed)') AS tool_name,
       COUNT(*) AS cnt
FROM `+CT.Spans+` s
LEFT JOIN `+CT.Traces+` t ON t.trace_id = s.trace_id
%s
AND s.span_type = 'tool'
GROUP BY tool_name
ORDER BY cnt DESC
LIMIT 12
`, traceWhereSQL)
	toolRows, err := db.Query(toolsSQL, traceParams...)
	if err != nil {
		return out, err
	}
	for toolRows.Next() {
		var tn sql.NullString
		var cnt sql.NullInt64
		if err := toolRows.Scan(&tn, &cnt); err != nil {
			toolRows.Close()
			return out, err
		}
		out.TopTools = append(out.TopTools, struct {
			SpanName string `json:"span_name"`
			Count    int64  `json:"count"`
		}{SpanName: nullStr(tn), Count: cnt.Int64})
	}
	toolRows.Close()

	wsSQL := fmt.Sprintf(`
SELECT COALESCE(NULLIF(TRIM(t.workspace_name), ''), 'default') AS ws,
       COUNT(*) AS cnt
FROM `+CT.Spans+` s
LEFT JOIN `+CT.Traces+` t ON t.trace_id = s.trace_id
%s
GROUP BY ws
ORDER BY cnt DESC
LIMIT 10
`, traceWhereSQL)
	wsRows, err := db.Query(wsSQL, traceParams...)
	if err != nil {
		return out, err
	}

	for wsRows.Next() {
		var ws sql.NullString
		var cnt sql.NullInt64
		if err := wsRows.Scan(&ws, &cnt); err != nil {
			wsRows.Close()
			return out, err
		}
		out.ByWorkspace = append(out.ByWorkspace, struct {
			WorkspaceName string `json:"workspace_name"`
			Count         int64  `json:"count"`
		}{WorkspaceName: nullStr(ws), Count: cnt.Int64})
	}
	wsRows.Close()

	return out, nil
}

// CountResourceAuditEvents 与 Node countResourceAuditEvents 一致。
func CountResourceAuditEvents(db QueryDB, q ResourceAuditListQuery) (int64, error) {
	return countResourceAuditEventsInternal(db, q)
}

// QueryResourceAuditEvents 与 Node queryResourceAuditEvents 一致。
func QueryResourceAuditEvents(db QueryDB, q ResourceAuditListQuery) ([]ResourceAuditEventJson, error) {
	return queryResourceAuditEventsInternal(db, q)
}

// QueryResourceAuditStats 与 Node queryResourceAuditStats 一致。
func QueryResourceAuditStats(db QueryDB, q ResourceAuditListQuery) (ResourceAuditStatsJson, error) {
	return queryResourceAuditStatsInternal(db, q)
}
