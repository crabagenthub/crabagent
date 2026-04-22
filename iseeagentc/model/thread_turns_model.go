package model

import (
	"database/sql"
	"sort"
	"strings"
	"time"

	textparser "iseeagentc/internal/parser"
)

type SkillUsedEntry struct {
	Label   string `json:"label"`
	SkillID string `json:"skill_id,omitempty"`
}

type ThreadTurnTreeNode struct {
	TurnID         string                `json:"turn_id"`
	RunKind        string                `json:"run_kind"`
	PrimaryTraceID string                `json:"primary_trace_id"`
	Preview        *string               `json:"preview"`
	CreatedAtMs    int64                 `json:"created_at_ms"`
	SkillsUsed     []SkillUsedEntry      `json:"skills_used"`
	Children       []*ThreadTurnTreeNode `json:"children"`
}

type ThreadTurnsResponse struct {
	ThreadID string               `json:"thread_id"`
	Items    []ThreadTurnTreeNode `json:"items"`
}

func collectSkillsUsedForTraceModel(db QueryDB, traceID string) ([]SkillUsedEntry, error) {
	tid := strings.TrimSpace(traceID)
	if tid == "" {
		return nil, nil
	}
	rows, err := db.Query(
		`SELECT span_type, name, metadata_json FROM ` + CT.Spans + ` WHERE trace_id = ? ORDER BY COALESCE(sort_index, 0) ASC`,
		tid,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byKey := make(map[string]SkillUsedEntry)
	for rows.Next() {
		var spanType, name string
		var metaJSON sql.NullString
		if err := rows.Scan(&spanType, &name, &metaJSON); err != nil {
			return nil, err
		}
		meta := map[string]interface{}{}
		if metaJSON.Valid {
			meta = textparser.ParseJSONObjectString(metaJSON.String)
		}
		if strings.TrimSpace(spanType) != "tool" {
			continue
		}
		if sk, _ := meta["semantic_kind"].(string); strings.TrimSpace(sk) != "skill" {
			continue
		}
		id := textparser.StringValue(meta["skill_id"])
		nm := textparser.StringValue(meta["skill_name"])
		label := nm
		if label == "" {
			label = id
		}
		if label == "" {
			label = strings.TrimSpace(name)
		}
		if label == "" {
			continue
		}
		key := strings.ToLower(id)
		if key == "" {
			key = strings.ToLower(label)
		}
		if _, ok := byKey[key]; ok {
			continue
		}
		if id != "" {
			disp := nm
			if disp == "" {
				disp = id
			}
			byKey[key] = SkillUsedEntry{Label: disp, SkillID: id}
		} else {
			byKey[key] = SkillUsedEntry{Label: label}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]SkillUsedEntry, 0, len(byKey))
	for _, e := range byKey {
		out = append(out, e)
	}
	return out, nil
}

func traceTypeToRunKindModel(tt string) string {
	t := strings.ToLower(strings.TrimSpace(tt))
	switch t {
	case "async_command":
		return "async_followup"
	case "external", "subagent", "system":
		return t
	default:
		return "external"
	}
}

func computeTurnPreviewModel(r TraceRowScoped) *string {
	inputObj := map[string]interface{}{}
	if r.InputJSON.Valid {
		inputObj = textparser.ParseJSONObjectString(r.InputJSON.String)
	}
	normalized := NormalizeOpikTraceInputForStorage(inputObj)
	normMap, _ := normalized.(map[string]interface{})
	if normMap == nil {
		normMap = map[string]interface{}{}
	}
	listPreview := textparser.StringPtrValue(normMap["list_input_preview"])
	if listPreview == nil {
		listPreview = textparser.StringPtrValue(normMap["listInputPreview"])
	}
	promptPreview := textparser.StringPtrValue(normMap["prompt"])
	computed := listPreview
	if computed == nil {
		computed = promptPreview
	}
	if computed == nil {
		if ut, ok := normMap["user_turn"].(map[string]interface{}); ok && ut != nil {
			if mr, ok := ut["message_received"].(map[string]interface{}); ok && mr != nil {
				computed = textparser.StringPtrValue(mr["content"])
			}
		}
	}
	if computed == nil && r.Name.Valid && strings.TrimSpace(r.Name.String) != "" {
		s := strings.TrimSpace(r.Name.String)
		computed = &s
	}
	return computed
}

func traceRowToTreeNodeModel(db QueryDB, r TraceRowScoped) (*ThreadTurnTreeNode, error) {
	rk := traceTypeToRunKindModel(r.TraceType)
	tid := r.TraceID
	skills, err := collectSkillsUsedForTraceModel(db, tid)
	if err != nil {
		return nil, err
	}
	created := time.Now().UnixMilli()
	if r.CreatedAtMs.Valid {
		created = r.CreatedAtMs.Int64
	}
	return &ThreadTurnTreeNode{
		TurnID:         tid,
		RunKind:        rk,
		PrimaryTraceID: tid,
		Preview:        computeTurnPreviewModel(r),
		CreatedAtMs:    created,
		SkillsUsed:     skills,
	}, nil
}

func sortChildrenRecursiveModel(n *ThreadTurnTreeNode) {
	sort.Slice(n.Children, func(i, j int) bool {
		a, b := n.Children[i], n.Children[j]
		if a.CreatedAtMs != b.CreatedAtMs {
			return a.CreatedAtMs < b.CreatedAtMs
		}
		return a.TurnID < b.TurnID
	})
	for _, c := range n.Children {
		sortChildrenRecursiveModel(c)
	}
}

func loadThreadTurnsTree(db QueryDB, threadKey string) (*ThreadTurnsResponse, error) {
	key := strings.TrimSpace(threadKey)
	if key == "" {
		return &ThreadTurnsResponse{ThreadID: key, Items: []ThreadTurnTreeNode{}}, nil
	}
	rows, err := QueryTracesInConversationScope(db, key, true)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return &ThreadTurnsResponse{ThreadID: key, Items: []ThreadTurnTreeNode{}}, nil
	}
	idSet := make(map[string]struct{}, len(rows))
	nodes := make(map[string]*ThreadTurnTreeNode, len(rows))
	for _, r := range rows {
		idSet[r.TraceID] = struct{}{}
		node, err := traceRowToTreeNodeModel(db, r)
		if err != nil {
			return nil, err
		}
		nodes[r.TraceID] = node
	}
	externalRoots := make([]*ThreadTurnTreeNode, 0)
	otherRoots := make([]*ThreadTurnTreeNode, 0)
	for _, r := range rows {
		node := nodes[r.TraceID]
		pid := ""
		if r.ParentTurnRef.Valid {
			pid = strings.TrimSpace(r.ParentTurnRef.String)
		}
		if pid != "" {
			if _, ok := idSet[pid]; ok {
				nodes[pid].Children = append(nodes[pid].Children, node)
				continue
			}
		}
		if node.RunKind == "external" {
			externalRoots = append(externalRoots, node)
		} else {
			otherRoots = append(otherRoots, node)
		}
	}
	rootPtrs := externalRoots
	if len(rootPtrs) == 0 {
		rootPtrs = otherRoots
	}
	roots := make([]ThreadTurnTreeNode, 0, len(rootPtrs))
	for _, p := range rootPtrs {
		sortChildrenRecursiveModel(p)
		roots = append(roots, *p)
	}
	return &ThreadTurnsResponse{ThreadID: key, Items: roots}, nil
}
