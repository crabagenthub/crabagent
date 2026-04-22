package model

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	textparser "iseeagentc/internal/parser"
	"iseeagentc/model/sqltokens"
)

type ExecutionGraphNode struct {
	ID                    string      `json:"id"`
	TraceID               string      `json:"trace_id"`
	ThreadID              *string     `json:"thread_id"`
	TraceType             string      `json:"trace_type"`
	NodeRole              string      `json:"node_role"`
	Kind                  string      `json:"kind"`
	Name                  *string     `json:"name"`
	Model                 *string     `json:"model"`
	Provider              *string     `json:"provider"`
	TotalTokens           int         `json:"total_tokens"`
	CreatedAtMs           *int64      `json:"created_at_ms"`
	StartTimeMs           *int64      `json:"start_time_ms"`
	EndTimeMs             *int64      `json:"end_time_ms"`
	DurationMs            *int64      `json:"duration_ms"`
	ToolExecutionMode     *string     `json:"tool_execution_mode"`
	CrabagentInterception interface{} `json:"crabagent_interception"`
}

type ExecutionGraphEdge struct {
	ID            string  `json:"id"`
	Source        string  `json:"source"`
	Target        string  `json:"target"`
	EdgeKind      string  `json:"edge_kind"`
	ToolBatchMode *string `json:"tool_batch_mode,omitempty"`
}

type ExecutionGraphResponse struct {
	ThreadKey string               `json:"thread_key"`
	Nodes     []ExecutionGraphNode `json:"nodes"`
	Edges     []ExecutionGraphEdge `json:"edges"`
	Truncated bool                 `json:"truncated"`
	MaxNodes  int                  `json:"max_nodes"`
}

type execRawSpanModel struct {
	SpanID       string
	TraceID      string
	ParentSpanID sql.NullString
	Name         sql.NullString
	SpanType     string
	Model        sql.NullString
	Provider     sql.NullString
	MetadataJSON sql.NullString
	StartTimeMs  sql.NullInt64
	EndTimeMs    sql.NullInt64
	UsageJSON    sql.NullString
	SI           int
}

type usageExtendedResultModel = textparser.UsageExtendedResult

func parseUsageExtendedModel(usageJSON *string) usageExtendedResultModel {
	return textparser.ParseUsageExtended(usageJSON)
}

func parseObjectModel(raw sql.NullString) map[string]interface{} {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return map[string]interface{}{}
	}
	var v interface{}
	if err := json.Unmarshal([]byte(raw.String), &v); err != nil {
		return map[string]interface{}{}
	}
	o, ok := v.(map[string]interface{})
	if !ok || o == nil {
		return map[string]interface{}{}
	}
	return o
}

func parseToolExecutionMode(meta map[string]interface{}) *string {
	raw, ok := meta["tool_execution_mode"]
	if !ok {
		raw = meta["toolExecutionMode"]
	}
	s, ok := raw.(string)
	if !ok {
		return nil
	}
	v := strings.TrimSpace(strings.ToLower(s))
	if v == "parallel" || v == "sequential" {
		return &v
	}
	return nil
}

func float64FromNullInt(v sql.NullInt64) float64 {
	if !v.Valid {
		return math.NaN()
	}
	return float64(v.Int64)
}

func isFiniteFloatModel(x float64) bool {
	return !math.IsNaN(x) && !math.IsInf(x, 0)
}

func traceEndTimeMsModel(tr TraceRowScoped) *int64 {
	created := float64FromNullInt(tr.CreatedAtMs)
	ended := float64FromNullInt(tr.EndedAtMs)
	dur := float64FromNullInt(tr.DurationMs)
	updated := float64FromNullInt(tr.UpdatedAtMs)
	if isFiniteFloatModel(ended) {
		v := int64(ended)
		return &v
	}
	if isFiniteFloatModel(created) && dur > 0 {
		v := int64(created + dur)
		return &v
	}
	if isFiniteFloatModel(updated) {
		v := int64(updated)
		return &v
	}
	if isFiniteFloatModel(created) {
		v := int64(created)
		return &v
	}
	return nil
}

func traceDurationMsModel(tr TraceRowScoped, endMs *int64) *int64 {
	created := float64FromNullInt(tr.CreatedAtMs)
	if endMs != nil && isFiniteFloatModel(created) && *endMs >= int64(created) {
		v := *endMs - int64(created)
		return &v
	}
	d := float64FromNullInt(tr.DurationMs)
	if isFiniteFloatModel(d) && d > 0 {
		v := int64(d)
		return &v
	}
	return nil
}

func placeholdersExecModel(n int) string {
	if n <= 0 {
		return ""
	}
	var b strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString("?")
	}
	return b.String()
}

func loadTraceTokenTotalsExecModel(db QueryDB, traceIDs []string) (map[string]int64, error) {
	out := make(map[string]int64)
	if len(traceIDs) == 0 {
		return out, nil
	}
	ph := placeholdersExecModel(len(traceIDs))
	args := make([]interface{}, len(traceIDs))
	for i, id := range traceIDs {
		args[i] = id
	}
	sqlStr := fmt.Sprintf(`SELECT t.trace_id, CAST(COALESCE(%s, 0) AS INTEGER) AS total_tokens
FROM ` + CT.Traces + ` t WHERE t.trace_id IN (%s)`, sqltokens.TraceRowTokenIntegerExpr, ph)
	rows, err := db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tid string
		var tok sql.NullInt64
		if err := rows.Scan(&tid, &tok); err != nil {
			return nil, err
		}
		var n int64
		if tok.Valid {
			n = tok.Int64
		}
		out[tid] = n
	}
	return out, rows.Err()
}

func spanWallDurationMsModel(startMs, endMs *int64) *int64 {
	if startMs == nil || endMs == nil {
		return nil
	}
	a, b := float64(*startMs), float64(*endMs)
	if !isFiniteFloatModel(a) || !isFiniteFloatModel(b) || b < a {
		return nil
	}
	v := int64(b - a)
	return &v
}

func loadTraceRowScopedModel(db QueryDB, traceID string) (*TraceRowScoped, error) {
	tid := strings.TrimSpace(traceID)
	if tid == "" {
		return nil, nil
	}
	q := `SELECT t.trace_id,
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
       FROM ` + CT.Traces + ` t WHERE t.trace_id = ?`
	var r TraceRowScoped
	err := db.QueryRow(q, tid).Scan(
		&r.TraceID, &r.ThreadID, &r.WorkspaceName, &r.ProjectName, &r.ParentTurnRef,
		&r.TraceType, &r.SubagentThreadID, &r.Name, &r.InputJSON, &r.OutputJSON,
		&r.MetadataJSON, &r.SettingJSON, &r.CreatedAtMs, &r.UpdatedAtMs, &r.EndedAtMs,
		&r.DurationMs, &r.IsComplete,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func selectTraceFamilyForFocusModel(db QueryDB, seedTraceID string) ([]TraceRowScoped, error) {
	row, err := loadTraceRowScopedModel(db, seedTraceID)
	if err != nil || row == nil {
		return nil, err
	}
	threadID := ""
	if row.ThreadID.Valid {
		threadID = strings.TrimSpace(row.ThreadID.String)
	}
	if threadID == "" {
		return []TraceRowScoped{*row}, nil
	}
	all, err := QueryTracesInConversationScope(db, threadID, true)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]TraceRowScoped, len(all))
	for _, r := range all {
		byID[r.TraceID] = r
	}
	selected := make(map[string]bool)
	curID := row.TraceID
	for {
		tr, ok := byID[curID]
		if !ok {
			break
		}
		selected[tr.TraceID] = true
		pref := ""
		if tr.ParentTurnRef.Valid {
			pref = strings.TrimSpace(tr.ParentTurnRef.String)
		}
		if pref == "" {
			break
		}
		if _, ok := byID[pref]; !ok {
			break
		}
		curID = pref
	}
	changed := true
	for changed {
		changed = false
		for _, r := range all {
			pref := ""
			if r.ParentTurnRef.Valid {
				pref = strings.TrimSpace(r.ParentTurnRef.String)
			}
			if pref != "" && selected[pref] && !selected[r.TraceID] {
				selected[r.TraceID] = true
				changed = true
			}
		}
	}
	var out []TraceRowScoped
	for _, r := range all {
		if selected[r.TraceID] {
			out = append(out, r)
		}
	}
	return out, nil
}

func traceTypeToHeaderKindModel(tt string) string {
	t := strings.TrimSpace(strings.ToLower(tt))
	switch t {
	case "external":
		return "TRACE_EXTERNAL"
	case "subagent":
		return "TRACE_SUBAGENT"
	case "async_command":
		return "TRACE_ASYNC"
	case "system":
		return "TRACE_SYSTEM"
	default:
		if t == "" {
			return "TRACE_UNKNOWN"
		}
		return "TRACE_" + strings.ToUpper(t)
	}
}

func loadSpansForTracesModel(db QueryDB, traceIDs []string) ([]execRawSpanModel, error) {
	if len(traceIDs) == 0 {
		return nil, nil
	}
	ph := placeholdersExecModel(len(traceIDs))
	args := make([]interface{}, len(traceIDs))
	for i, id := range traceIDs {
		args[i] = id
	}
	sqlStr := fmt.Sprintf(`
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.model,
       s.provider,
       s.metadata_json,
       s.start_time_ms,
       s.end_time_ms,
       s.usage_json,
       COALESCE(s.sort_index, 0) AS si
FROM ` + CT.Spans + ` s
WHERE s.trace_id IN (%s)
ORDER BY s.trace_id ASC, si ASC, s.span_id ASC`, ph)
	rows, err := db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []execRawSpanModel
	for rows.Next() {
		var s execRawSpanModel
		if err := rows.Scan(&s.SpanID, &s.TraceID, &s.ParentSpanID, &s.Name, &s.SpanType, &s.Model, &s.Provider,
			&s.MetadataJSON, &s.StartTimeMs, &s.EndTimeMs, &s.UsageJSON, &s.SI); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func clampExecMaxNodesModel(n int) int {
	const def = 500
	const absMax = 1200
	if n <= 0 {
		return def
	}
	if n < 50 {
		return 50
	}
	if n > absMax {
		return absMax
	}
	return n
}

func usageTotalTokensNonnegModel(u usageExtendedResultModel) int {
	if u.TotalTokens == nil {
		return 0
	}
	x := *u.TotalTokens
	if !isFiniteFloatModel(x) {
		return 0
	}
	t := int(math.Trunc(x))
	if t < 0 {
		return 0
	}
	return t
}

func nullInt64PtrModel(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	x := v.Int64
	return &x
}

func buildExecutionGraphFromTracesModel(db QueryDB, threadKey string, traceRows []TraceRowScoped, maxNodes int) (*ExecutionGraphResponse, error) {
	if len(traceRows) == 0 {
		return &ExecutionGraphResponse{ThreadKey: threadKey, Nodes: []ExecutionGraphNode{}, Edges: []ExecutionGraphEdge{}, Truncated: false, MaxNodes: maxNodes}, nil
	}
	traceByID := make(map[string]TraceRowScoped, len(traceRows))
	traceIDs := make([]string, 0, len(traceRows))
	for _, r := range traceRows {
		traceByID[r.TraceID] = r
		traceIDs = append(traceIDs, r.TraceID)
	}
	spans, err := loadSpansForTracesModel(db, traceIDs)
	if err != nil {
		return nil, err
	}
	truncated := false
	if len(spans) > maxNodes {
		spans = spans[:maxNodes]
		truncated = true
	}
	spanIDSet := make(map[string]struct{}, len(spans))
	for _, s := range spans {
		spanIDSet[s.SpanID] = struct{}{}
	}
	spansByTrace := make(map[string][]execRawSpanModel)
	for _, s := range spans {
		spansByTrace[s.TraceID] = append(spansByTrace[s.TraceID], s)
	}

	nodes := make([]ExecutionGraphNode, 0)
	edges := make([]ExecutionGraphEdge, 0)
	traceToolModeByID := make(map[string]*string)
	for _, tr := range traceRows {
		meta := parseObjectModel(tr.MetadataJSON)
		traceToolModeByID[tr.TraceID] = parseToolExecutionMode(meta)
	}
	th := func(traceID string) string { return "th:" + traceID }
	traceTokenByID, err := loadTraceTokenTotalsExecModel(db, traceIDs)
	if err != nil {
		return nil, err
	}

	for _, tr := range traceRows {
		tid := tr.TraceID
		tt := strings.TrimSpace(tr.TraceType)
		if tt == "" {
			tt = "external"
		}
		var createdAtMs *int64
		if tr.CreatedAtMs.Valid {
			x := float64(tr.CreatedAtMs.Int64)
			if isFiniteFloatModel(x) {
				v := tr.CreatedAtMs.Int64
				createdAtMs = &v
			}
		}
		endMs := traceEndTimeMsModel(tr)
		durMs := traceDurationMsModel(tr, endMs)
		var threadID *string
		if tr.ThreadID.Valid {
			s := tr.ThreadID.String
			threadID = &s
		}
		nm := tt
		if tr.Name.Valid && strings.TrimSpace(tr.Name.String) != "" {
			nm = tr.Name.String
		}
		tok := traceTokenByID[tid]
		mode := traceToolModeByID[tid]
		nmCopy := nm
		nodes = append(nodes, ExecutionGraphNode{
			ID:                    th(tid),
			TraceID:               tid,
			ThreadID:              threadID,
			TraceType:             tt,
			NodeRole:              "trace",
			Kind:                  traceTypeToHeaderKindModel(tt),
			Name:                  &nmCopy,
			TotalTokens:           int(tok),
			CreatedAtMs:           createdAtMs,
			StartTimeMs:           createdAtMs,
			EndTimeMs:             endMs,
			DurationMs:            durMs,
			ToolExecutionMode:     mode,
			CrabagentInterception: nil,
		})
	}

	spanKindByID := make(map[string]string)
	for _, s := range spans {
		meta := parseObjectModel(s.MetadataJSON)
		nm := ""
		if s.Name.Valid {
			nm = s.Name.String
		}
		st := strings.TrimSpace(s.SpanType)
		if st == "" {
			st = "general"
		}
		kind := MapSpanTypeToApi(st, nm, meta)
		sid := s.SpanID
		spanKindByID[sid] = kind

		var uj *string
		if s.UsageJSON.Valid {
			u := s.UsageJSON.String
			uj = &u
		}
		u := parseUsageExtendedModel(uj)
		tok := usageTotalTokensNonnegModel(u)
		startMs := nullInt64PtrModel(s.StartTimeMs)
		endMs := nullInt64PtrModel(s.EndTimeMs)
		traceIDStr := s.TraceID
		trRow := traceByID[traceIDStr]
		var tem *string
		if kind == "LLM" {
			tem = traceToolModeByID[traceIDStr]
		}
		var crab interface{}
		if raw, ok := meta["crabagent_interception"]; ok {
			if m, ok := raw.(map[string]interface{}); ok && m != nil {
				crab = m
			}
		}
		var modelPtr, provPtr *string
		if s.Model.Valid {
			s2 := s.Model.String
			modelPtr = &s2
		}
		if s.Provider.Valid {
			s2 := s.Provider.String
			provPtr = &s2
		}
		var tidPtr *string
		if trRow.ThreadID.Valid {
			s2 := trRow.ThreadID.String
			tidPtr = &s2
		}
		tType := strings.TrimSpace(trRow.TraceType)
		if tType == "" {
			tType = "external"
		}
		displayName := nm
		if strings.TrimSpace(displayName) == "" {
			displayName = kind
		}
		dnCopy := displayName
		nodes = append(nodes, ExecutionGraphNode{
			ID:                    sid,
			TraceID:               traceIDStr,
			ThreadID:              tidPtr,
			TraceType:             tType,
			NodeRole:              "span",
			Kind:                  kind,
			Name:                  &dnCopy,
			Model:                 modelPtr,
			Provider:              provPtr,
			TotalTokens:           tok,
			StartTimeMs:           startMs,
			EndTimeMs:             endMs,
			DurationMs:            spanWallDurationMsModel(startMs, endMs),
			ToolExecutionMode:     tem,
			CrabagentInterception: crab,
		})
	}

	for _, s := range spans {
		sid := s.SpanID
		tid := s.TraceID
		pid := ""
		if s.ParentSpanID.Valid {
			pid = strings.TrimSpace(s.ParentSpanID.String)
		}
		if pid != "" {
			if _, ok := spanIDSet[pid]; ok {
				pk := spanKindByID[pid]
				ck := spanKindByID[sid]
				mode := traceToolModeByID[tid]
				toolChild := ck == "TOOL" || ck == "SKILL" || ck == "MEMORY"
				isLlmToolFanout := pk == "LLM" && toolChild && mode != nil
				var edgeKind string
				var batch *string
				if isLlmToolFanout {
					if *mode == "parallel" {
						edgeKind = "span_parent_parallel"
					} else {
						edgeKind = "span_parent_sequential"
					}
					batch = mode
				} else if pk == "LLM" && ck == "MEMORY" {
					edgeKind = "span_parent_memory"
				} else {
					edgeKind = "span_parent"
				}
				edges = append(edges, ExecutionGraphEdge{
					ID:            fmt.Sprintf("sp:%s->%s", pid, sid),
					Source:        pid,
					Target:        sid,
					EdgeKind:      edgeKind,
					ToolBatchMode: batch,
				})
				continue
			}
		}
		edges = append(edges, ExecutionGraphEdge{
			ID:       fmt.Sprintf("tr:%s->%s", tid, sid),
			Source:   th(tid),
			Target:   sid,
			EdgeKind: "trace_to_root",
		})
	}

	traceMetaParent := make(map[string]string)
	for _, tr := range traceRows {
		pref := ""
		if tr.ParentTurnRef.Valid {
			pref = strings.TrimSpace(tr.ParentTurnRef.String)
		}
		if pref != "" {
			if _, ok := traceByID[pref]; ok && pref != tr.TraceID {
				traceMetaParent[tr.TraceID] = pref
			}
		}
	}
	for childTid, parentTid := range traceMetaParent {
		parentSpans := spansByTrace[parentTid]
		childSpans := spansByTrace[childTid]
		if len(parentSpans) == 0 || len(childSpans) == 0 {
			edges = append(edges, ExecutionGraphEdge{
				ID:       fmt.Sprintf("tl:%s->%s", parentTid, childTid),
				Source:   th(parentTid),
				Target:   th(childTid),
				EdgeKind: "trace_lineage",
			})
			continue
		}
		ps := append([]execRawSpanModel(nil), parentSpans...)
		sort.Slice(ps, func(i, j int) bool {
			ai := float64FromNullInt(ps[i].StartTimeMs)
			aj := float64FromNullInt(ps[j].StartTimeMs)
			if ai != aj {
				return ai > aj
			}
			return ps[i].SpanID > ps[j].SpanID
		})
		lastP := ps[0]
		cs := append([]execRawSpanModel(nil), childSpans...)
		sort.Slice(cs, func(i, j int) bool {
			if cs[i].SI != cs[j].SI {
				return cs[i].SI < cs[j].SI
			}
			ai := float64FromNullInt(cs[i].StartTimeMs)
			aj := float64FromNullInt(cs[j].StartTimeMs)
			if ai != aj {
				return ai < aj
			}
			return cs[i].SpanID < cs[j].SpanID
		})
		firstC := cs[0]
		fromID := lastP.SpanID
		toID := firstC.SpanID
		if fromID != toID {
			edges = append(edges, ExecutionGraphEdge{
				ID:       fmt.Sprintf("xt:%s->%s", fromID, toID),
				Source:   fromID,
				Target:   toID,
				EdgeKind: "cross_trace",
			})
		}
	}

	return &ExecutionGraphResponse{
		ThreadKey: threadKey,
		Nodes:     nodes,
		Edges:     edges,
		Truncated: truncated,
		MaxNodes:  maxNodes,
	}, nil
}

func loadConversationExecutionGraph(db QueryDB, threadKey string, maxNodes int) (*ExecutionGraphResponse, error) {
	maxNodes = clampExecMaxNodesModel(maxNodes)
	key := strings.TrimSpace(threadKey)
	if key == "" {
		return &ExecutionGraphResponse{ThreadKey: "", Nodes: []ExecutionGraphNode{}, Edges: []ExecutionGraphEdge{}, Truncated: false, MaxNodes: maxNodes}, nil
	}
	traceRows, err := QueryTracesInConversationScope(db, key, true)
	if err != nil {
		return nil, err
	}
	return buildExecutionGraphFromTracesModel(db, key, traceRows, maxNodes)
}

func loadTraceExecutionGraph(db QueryDB, traceID string, maxNodes int) (*ExecutionGraphResponse, error) {
	maxNodes = clampExecMaxNodesModel(maxNodes)
	tid := strings.TrimSpace(traceID)
	if tid == "" {
		return &ExecutionGraphResponse{ThreadKey: "", Nodes: []ExecutionGraphNode{}, Edges: []ExecutionGraphEdge{}, Truncated: false, MaxNodes: maxNodes}, nil
	}
	traceRows, err := selectTraceFamilyForFocusModel(db, tid)
	if err != nil {
		return nil, err
	}
	if len(traceRows) == 0 {
		return &ExecutionGraphResponse{ThreadKey: tid, Nodes: []ExecutionGraphNode{}, Edges: []ExecutionGraphEdge{}, Truncated: false, MaxNodes: maxNodes}, nil
	}
	threadKey := tid
	if traceRows[0].ThreadID.Valid {
		s := strings.TrimSpace(traceRows[0].ThreadID.String)
		if s != "" {
			threadKey = s
		}
	}
	return buildExecutionGraphFromTracesModel(db, threadKey, traceRows, maxNodes)
}
