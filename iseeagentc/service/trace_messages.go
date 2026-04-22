package service

import (
	"strings"

	"iseeagentc/model"
)

type TraceMessagesService struct {
	db model.QueryDB
}

func NewTraceMessagesService(db model.QueryDB) *TraceMessagesService {
	return &TraceMessagesService{db: db}
}

func (s *TraceMessagesService) List(limit, offset int, order, search string) []map[string]interface{} {
	q := model.TraceMessagesListQuery{
		Limit:  clampInt(limit, 100, 1, 500),
		Offset: clampInt(offset, 0, 0, 1<<30),
		Order:  strings.ToLower(strings.TrimSpace(order)),
		Search: strPtr(search),
	}
	items := model.QueryTraceMessagesDB(s.db, q)
	if items == nil {
		return []map[string]interface{}{}
	}
	return items
}
