package service

import (
	"database/sql"
	"strings"

	"iseeagentc/model"
)

type TraceGraphService struct {
	db *sql.DB
}

func NewTraceGraphService(db *sql.DB) *TraceGraphService {
	return &TraceGraphService{db: db}
}

func (s *TraceGraphService) TraceSpans(traceID string) (string, []model.SemanticSpanRow, map[string]interface{}, error) {
	canonical := model.ResolveCanonicalTraceIDForSpanDB(s.db, strings.TrimSpace(traceID))
	items, err := model.QuerySemanticSpansByTraceIDDB(s.db, canonical)
	if err != nil {
		return "", nil, nil, err
	}
	ti := model.QueryTraceInputByTraceIDDB(s.db, canonical)
	return canonical, items, ti, nil
}

func (s *TraceGraphService) ThreadTraceEvents(threadKey string) ([]map[string]interface{}, error) {
	return model.QueryThreadTraceEventsDB(s.db, threadKey)
}

func (s *TraceGraphService) ThreadTokenBreakdown(threadID string) (*model.ThreadTokenBreakdown, error) {
	return model.QueryThreadTokenBreakdownDB(s.db, threadID)
}

func (s *TraceGraphService) ThreadTurnsTree(threadID string) (*model.ThreadTurnsResponse, error) {
	return model.QueryThreadTurnsTreeDB(s.db, threadID)
}

func (s *TraceGraphService) ThreadTraceGraph(threadID string, maxNodes int) (*model.TraceGraphResponse, error) {
	return model.QueryThreadTraceGraphDB(s.db, threadID, maxNodes)
}

func (s *TraceGraphService) ConversationExecutionGraph(threadID string, maxNodes int) (*model.ExecutionGraphResponse, error) {
	return model.QueryConversationExecutionGraphDB(s.db, threadID, maxNodes)
}

func (s *TraceGraphService) TraceExecutionGraph(traceID string, maxNodes int) (*model.ExecutionGraphResponse, error) {
	return model.QueryTraceExecutionGraphDB(s.db, strings.TrimSpace(traceID), maxNodes)
}

func (s *TraceGraphService) ObserveFacets(workspaceName *string) (*model.ObserveFacetsResult, error) {
	return model.QueryObserveFacetsDB(s.db, workspaceName)
}
