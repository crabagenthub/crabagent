package model

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"iseeagentc/model/sqltokens"
)

type TraceGraphSkillSummary struct {
	Name    string `json:"name"`
	SkillID string `json:"skill_id,omitempty"`
}

type TraceGraphNode struct {
	ID               string                   `json:"id"`
	ThreadID         *string                  `json:"thread_id"`
	TraceType        string                   `json:"trace_type"`
	ParentTurnRef    *string                  `json:"parent_turn_ref"`
	SubagentThreadID *string                  `json:"subagent_thread_id"`
	Name             *string                  `json:"name"`
	IsComplete       int                      `json:"is_complete"`
	CreatedAtMs      *int64                   `json:"created_at_ms"`
	TotalTokens      int                      `json:"total_tokens"`
	ToolCallCount    int                      `json:"tool_call_count"`
	PrimaryModel     *string                  `json:"primary_model"`
	PrimaryProvider  *string                  `json:"primary_provider"`
	LlmModels        []string                 `json:"llm_models"`
	Skills           []TraceGraphSkillSummary `json:"skills"`
	TotalCost        *float64                 `json:"total_cost"`
	PolicyTags       []string                 `json:"policy_tags"`
}

type TraceGraphEdge struct {
	ID           string   `json:"id"`
	Source       string   `json:"source"`
	Target       string   `json:"target"`
	TraceType    string   `json:"trace_type"`
	CostEstimate *float64 `json:"cost_estimate"`
	PolicyTags   []string `json:"policy_tags"`
}

type TraceGraphResponse struct {
	ThreadKey string           `json:"thread_key"`
	Nodes     []TraceGraphNode `json:"nodes"`
	Edges     []TraceGraphEdge `json:"edges"`
	Truncated bool             `json:"truncated"`
	MaxNodes  int              `json:"max_nodes"`
}

type traceGraphSpanRowModel struct {
	TraceID      string
	SpanType     string
	Name         string
	Model        sql.NullString
	Provider     sql.NullString
	MetadataJSON sql.NullString
	SI           int
}

func traceGraphParseJSONObjectModel(raw sql.NullString) map[string]interface{} {
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

func traceGraphBuildAggregatesFromSpansModel(spanRows []traceGraphSpanRowModel) map[string]struct {
	primaryModel    *string
	primaryProvider *string
	llmModels       []string
	skills          []TraceGraphSkillSummary
} {
	type rec struct {
		firstLlm  *struct{ model, provider *string }
		llmModels map[string]struct{}
		skills    []TraceGraphSkillSummary
		skillKeys map[string]struct{}
	}
	byTrace := make(map[string]*rec)
	for _, r := range spanRows {
		tid := r.TraceID
		if _, ok := byTrace[tid]; !ok {
			byTrace[tid] = &rec{nil, make(map[string]struct{}), nil, make(map[string]struct{})}
		}
		br := byTrace[tid]
		st := strings.ToLower(strings.TrimSpace(r.SpanType))
		if st == "llm" {
			if br.firstLlm == nil {
				var m, p *string
				if r.Model.Valid {
					s2 := strings.TrimSpace(r.Model.String)
					if s2 != "" {
						m = &s2
					}
				}
				if r.Provider.Valid {
					s3 := strings.TrimSpace(r.Provider.String)
					if s3 != "" {
						p = &s3
					}
				}
				br.firstLlm = &struct{ model, provider *string }{m, p}
			}
			if r.Model.Valid {
				m := strings.TrimSpace(r.Model.String)
				if m != "" {
					br.llmModels[m] = struct{}{}
				}
			}
		}
		if st == "tool" {
			meta := traceGraphParseJSONObjectModel(r.MetadataJSON)
			sk := strings.TrimSpace(strings.ToLower(fmt.Sprint(meta["semantic_kind"])))
			if sk == "" {
				sk = strings.TrimSpace(strings.ToLower(fmt.Sprint(meta["semanticKind"])))
			}
			if sk != "skill" {
				continue
			}
			sid := strings.TrimSpace(fmt.Sprint(meta["skill_id"]))
			if sid == "<nil>" {
				sid = ""
			}
			if sid == "" {
				sid = strings.TrimSpace(fmt.Sprint(meta["skillId"]))
				if sid == "<nil>" {
					sid = ""
				}
			}
			sn := strings.TrimSpace(fmt.Sprint(meta["skill_name"]))
			if sn == "<nil>" {
				sn = ""
			}
			if sn == "" {
				sn = strings.TrimSpace(fmt.Sprint(meta["skillName"]))
				if sn == "<nil>" {
					sn = ""
				}
			}
			nm := strings.TrimSpace(r.Name)
			label := strings.TrimSpace(sn)
			if label == "" {
				label = sid
			}
			if label == "" {
				label = nm
			}
			if label == "" {
				continue
			}
			key := strings.ToLower(sid)
			if key == "" {
				key = strings.ToLower(label)
			}
			if _, ok := br.skillKeys[key]; ok {
				continue
			}
			br.skillKeys[key] = struct{}{}
			entry := TraceGraphSkillSummary{Name: label}
			if sid != "" {
				entry.SkillID = sid
			}
			br.skills = append(br.skills, entry)
		}
	}
	out := make(map[string]struct {
		primaryModel    *string
		primaryProvider *string
		llmModels       []string
		skills          []TraceGraphSkillSummary
	})
	for tid, v := range byTrace {
		var pm, pp *string
		if v.firstLlm != nil && v.firstLlm.model != nil {
			s := strings.TrimSpace(*v.firstLlm.model)
			if s != "" {
				pm = &s
			}
		}
		if v.firstLlm != nil && v.firstLlm.provider != nil {
			s := strings.TrimSpace(*v.firstLlm.provider)
			if s != "" {
				pp = &s
			}
		}
		llmList := make([]string, 0, len(v.llmModels))
		for m := range v.llmModels {
			llmList = append(llmList, m)
		}
		sort.Strings(llmList)
		out[tid] = struct {
			primaryModel    *string
			primaryProvider *string
			llmModels       []string
			skills          []TraceGraphSkillSummary
		}{pm, pp, llmList, v.skills}
	}
	return out
}

func placeholdersModel(n int) string {
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

func traceGraphLoadAggregatesModel(db QueryDB, traceIDs []string) (
	tokensAndTools map[string]struct {
		totalTokens   int
		toolCallCount int
		totalCost     *float64
	},
	spanDerived map[string]struct {
		primaryModel    *string
		primaryProvider *string
		llmModels       []string
		skills          []TraceGraphSkillSummary
	},
	err error,
) {
	tokensAndTools = make(map[string]struct {
		totalTokens   int
		toolCallCount int
		totalCost     *float64
	})
	spanDerived = make(map[string]struct {
		primaryModel    *string
		primaryProvider *string
		llmModels       []string
		skills          []TraceGraphSkillSummary
	})
	if len(traceIDs) == 0 {
		return tokensAndTools, spanDerived, nil
	}
	ph := placeholdersModel(len(traceIDs))
	args := make([]interface{}, len(traceIDs))
	for i, id := range traceIDs {
		args[i] = id
	}
	tokenSQL := fmt.Sprintf(`
SELECT t.trace_id,
       %s AS total_tokens,
       (SELECT COUNT(*) FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id AND s.span_type = 'tool') AS tool_call_count,
       t.total_cost AS total_cost
FROM ` + CT.Traces + ` t
WHERE t.trace_id IN (%s)`, sqltokens.TraceRowTokenIntegerExpr, ph)
	rows, err := db.Query(tokenSQL, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tid string
		var totalTok, toolCnt sql.NullInt64
		var totalCost sql.NullFloat64
		if err := rows.Scan(&tid, &totalTok, &toolCnt, &totalCost); err != nil {
			return nil, nil, err
		}
		tt, tc := 0, 0
		if totalTok.Valid {
			tt = int(totalTok.Int64)
		}
		if toolCnt.Valid {
			tc = int(toolCnt.Int64)
		}
		var cost *float64
		if totalCost.Valid {
			x := totalCost.Float64
			if !isFiniteFloat64(x) {
				x = 0
			}
			cost = &x
		}
		tokensAndTools[tid] = struct {
			totalTokens   int
			toolCallCount int
			totalCost     *float64
		}{tt, tc, cost}
	}
	spanSQL := fmt.Sprintf(`
SELECT s.trace_id, s.span_type, s.name, s.model, s.provider, s.metadata_json, COALESCE(s.sort_index, 0) AS si
FROM ` + CT.Spans + ` s
WHERE s.trace_id IN (%s)
ORDER BY s.trace_id ASC, si ASC, s.span_id ASC`, ph)
	srows, err := db.Query(spanSQL, args...)
	if err != nil {
		return nil, nil, err
	}
	defer srows.Close()
	var spanRows []traceGraphSpanRowModel
	for srows.Next() {
		var r traceGraphSpanRowModel
		if err := srows.Scan(&r.TraceID, &r.SpanType, &r.Name, &r.Model, &r.Provider, &r.MetadataJSON, &r.SI); err != nil {
			return nil, nil, err
		}
		spanRows = append(spanRows, r)
	}
	return tokensAndTools, traceGraphBuildAggregatesFromSpansModel(spanRows), srows.Err()
}

func clampTraceGraphMaxNodesModel(n int) int {
	const def = 80
	const absMax = 200
	if n <= 0 {
		return def
	}
	if n > absMax {
		return absMax
	}
	return n
}

func loadThreadTraceGraph(db QueryDB, threadKey string, maxNodes int) (*TraceGraphResponse, error) {
	maxNodes = clampTraceGraphMaxNodesModel(maxNodes)
	key := strings.TrimSpace(threadKey)
	if key == "" {
		return &TraceGraphResponse{ThreadKey: "", Nodes: []TraceGraphNode{}, Edges: []TraceGraphEdge{}, Truncated: false, MaxNodes: maxNodes}, nil
	}
	rows, err := QueryTracesInConversationScope(db, key, true)
	if err != nil {
		return nil, err
	}
	truncated := len(rows) > maxNodes
	if truncated {
		rows = rows[:maxNodes]
	}
	traceIDs := make([]string, 0, len(rows))
	idSet := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		traceIDs = append(traceIDs, r.TraceID)
		idSet[r.TraceID] = struct{}{}
	}
	tokTools, spanDer, err := traceGraphLoadAggregatesModel(db, traceIDs)
	if err != nil {
		return nil, err
	}
	nodes := make([]TraceGraphNode, 0, len(rows))
	for _, r := range rows {
		tid := r.TraceID
		tt := tokTools[tid]
		sp := spanDer[tid]
		var threadID, parentRef, subagent, name *string
		if r.ThreadID.Valid {
			s := r.ThreadID.String
			threadID = &s
		}
		if r.ParentTurnRef.Valid {
			s := r.ParentTurnRef.String
			parentRef = &s
		}
		if r.SubagentThreadID.Valid {
			s := r.SubagentThreadID.String
			subagent = &s
		}
		if r.Name.Valid {
			s := r.Name.String
			name = &s
		}
		ic := 0
		if r.IsComplete.Valid {
			ic = int(r.IsComplete.Int64)
		}
		var created *int64
		if r.CreatedAtMs.Valid {
			v := r.CreatedAtMs.Int64
			created = &v
		}
		traceType := strings.TrimSpace(r.TraceType)
		if traceType == "" {
			traceType = "external"
		}
		nodes = append(nodes, TraceGraphNode{
			ID:               tid,
			ThreadID:         threadID,
			TraceType:        traceType,
			ParentTurnRef:    parentRef,
			SubagentThreadID: subagent,
			Name:             name,
			IsComplete:       ic,
			CreatedAtMs:      created,
			TotalTokens:      tt.totalTokens,
			ToolCallCount:    tt.toolCallCount,
			PrimaryModel:     sp.primaryModel,
			PrimaryProvider:  sp.primaryProvider,
			LlmModels:        append([]string(nil), sp.llmModels...),
			Skills:           append([]TraceGraphSkillSummary(nil), sp.skills...),
			TotalCost:        tt.totalCost,
			PolicyTags:       []string{},
		})
	}
	edges := make([]TraceGraphEdge, 0)
	for _, r := range rows {
		pid := ""
		if r.ParentTurnRef.Valid {
			pid = strings.TrimSpace(r.ParentTurnRef.String)
		}
		if pid == "" {
			continue
		}
		if _, ok := idSet[pid]; !ok {
			continue
		}
		tt := strings.TrimSpace(r.TraceType)
		if tt == "" {
			tt = "external"
		}
		edges = append(edges, TraceGraphEdge{
			ID:         fmt.Sprintf("%s->%s", pid, r.TraceID),
			Source:     pid,
			Target:     r.TraceID,
			TraceType:  tt,
			PolicyTags: []string{},
		})
	}
	return &TraceGraphResponse{
		ThreadKey: key,
		Nodes:     nodes,
		Edges:     edges,
		Truncated: truncated,
		MaxNodes:  maxNodes,
	}, nil
}

func isFiniteFloat64(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }
