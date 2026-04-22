package service

import (
	"database/sql"
	"strings"

	"iseeagentc/model"
)

type ResourceAuditEventsQuery struct {
	Limit         int
	Offset        int
	Order         string
	SinceMs       string
	UntilMs       string
	Search        string
	URIPrefix     string
	TraceID       string
	SpanID        string
	HintType      string
	PolicyID      string
	SpanName      string
	WorkspaceName string
	SortMode      string
	SemanticClass string
}

type ResourceAuditStatsQuery struct {
	SinceMs       string
	UntilMs       string
	Search        string
	URIPrefix     string
	TraceID       string
	SpanID        string
	HintType      string
	PolicyID      string
	WorkspaceName string
	SemanticClass string
}

type SecurityAuditEventsQuery struct {
	Limit         int
	Offset        int
	Order         string
	SinceMs       string
	UntilMs       string
	TraceID       string
	SpanID        string
	PolicyID      string
	HintType      string
	WorkspaceName string
}

type TraceAuditService struct {
	db *sql.DB
}

func NewTraceAuditService(db *sql.DB) *TraceAuditService {
	return &TraceAuditService{db: db}
}

func (s *TraceAuditService) ResourceAuditEvents(req ResourceAuditEventsQuery) (map[string]interface{}, error) {
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	q := model.ResourceAuditListQuery{
		Limit:         clampInt(req.Limit, 100, 1, 500),
		Offset:        clampInt(req.Offset, 0, 0, 1<<30),
		Order:         order,
		SinceMs:       parseEpochMs(req.SinceMs),
		UntilMs:       parseEpochMs(req.UntilMs),
		Search:        strPtr(req.Search),
		URIPrefix:     strPtr(req.URIPrefix),
		TraceID:       strPtr(req.TraceID),
		SpanID:        strPtr(req.SpanID),
		HintType:      strPtr(req.HintType),
		PolicyID:      strPtr(req.PolicyID),
		SpanName:      strPtr(req.SpanName),
		WorkspaceName: strPtr(req.WorkspaceName),
	}
	if sm := strings.TrimSpace(req.SortMode); sm != "" {
		q.SortMode = &sm
	}
	if sc := strings.TrimSpace(req.SemanticClass); sc != "" {
		q.SemanticClass = &sc
	}
	items, err := model.QueryResourceAuditEvents(s.db, q)
	if err != nil {
		return nil, err
	}
	total, err := model.CountResourceAuditEvents(s.db, q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"items": items, "total": total}, nil
}

func (s *TraceAuditService) ResourceAuditStats(req ResourceAuditStatsQuery) (model.ResourceAuditStatsJson, error) {
	q := model.ResourceAuditListQuery{
		SinceMs:       parseEpochMs(req.SinceMs),
		UntilMs:       parseEpochMs(req.UntilMs),
		Search:        strPtr(req.Search),
		URIPrefix:     strPtr(req.URIPrefix),
		TraceID:       strPtr(req.TraceID),
		SpanID:        strPtr(req.SpanID),
		HintType:      strPtr(req.HintType),
		PolicyID:      strPtr(req.PolicyID),
		WorkspaceName: strPtr(req.WorkspaceName),
	}
	if sc := strings.TrimSpace(req.SemanticClass); sc != "" {
		q.SemanticClass = &sc
	}
	return model.QueryResourceAuditStats(s.db, q)
}

func (s *TraceAuditService) SecurityAuditEvents(req SecurityAuditEventsQuery) (map[string]interface{}, error) {
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	q := model.SecurityAuditListQuery{
		Limit:         clampInt(req.Limit, 50, 1, 200),
		Offset:        clampInt(req.Offset, 0, 0, 1<<30),
		Order:         order,
		SinceMs:       parseEpochMs(req.SinceMs),
		UntilMs:       parseEpochMs(req.UntilMs),
		TraceID:       strPtr(req.TraceID),
		SpanID:        strPtr(req.SpanID),
		PolicyID:      strPtr(req.PolicyID),
		HintType:      strPtr(req.HintType),
		WorkspaceName: strPtr(req.WorkspaceName),
	}
	items, err := model.QuerySecurityAuditEventsDB(s.db, q)
	if err != nil {
		return nil, err
	}
	total, err := model.CountSecurityAuditEventsDB(s.db, q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"items": items, "total": total}, nil
}

func (s *TraceAuditService) SecurityAuditPolicyCounts(workspaceName string) (map[string]interface{}, error) {
	rows, err := model.QuerySecurityAuditPolicyEventCountsDB(s.db, strPtr(workspaceName))
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"items": rows}, nil
}
