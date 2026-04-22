package service

import (
	"database/sql"
	"strings"

	"iseeagentc/model"
)

type TraceSessionService struct {
	db *sql.DB
}

func NewTraceSessionService(db *sql.DB) *TraceSessionService {
	return &TraceSessionService{db: db}
}

func (s *TraceSessionService) ApplyOpikBatch(body interface{}) (*model.OpikBatchResponse, error) {
	if s == nil || s.db == nil {
		return &model.OpikBatchResponse{}, nil
	}
	return model.ApplyOpikBatchDB(s.db, body)
}

func (s *TraceSessionService) ListLegacyTraces(limit int) ([]map[string]interface{}, error) {
	if s == nil || s.db == nil {
		return []map[string]interface{}{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return model.QueryLegacyTracesDB(s.db, limit)
}

func (s *TraceSessionService) ResolveSessionTraceRoot(sessionID string) (string, error) {
	if s == nil || s.db == nil {
		return "", sql.ErrNoRows
	}
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return "", sql.ErrNoRows
	}
	return model.QuerySessionTraceRootDB(s.db, id)
}

func (s *TraceSessionService) DeleteSession(sessionID string) (int64, error) {
	if s == nil || s.db == nil {
		return 0, nil
	}
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return 0, nil
	}
	return model.DeleteSessionDB(s.db, id)
}
