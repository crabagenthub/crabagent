package service

import (
	"database/sql"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"iseeagentc/model"
)

type TraceListQuery struct {
	Limit          int
	Offset         int
	Order          string
	Sort           string
	Search         string
	SinceMs        string
	UntilMs        string
	Channel        string
	Agent          string
	WorkspaceName  string
	MinTotalTokens string
	MinLoopCount   string
	MinToolCalls   string
}

type ThreadListQuery struct {
	Limit         int
	Offset        int
	Order         string
	Sort          string
	Search        string
	SinceMs       string
	UntilMs       string
	Channel       string
	Agent         string
	WorkspaceName string
}

type SpanListQuery struct {
	Limit         int
	Offset        int
	Order         string
	Sort          string
	Search        string
	SinceMs       string
	UntilMs       string
	Channel       string
	Agent         string
	SpanType      string
	WorkspaceName string
}

type TraceService struct {
	db           *sql.DB
	dialect      traceDialect
	defaultWinMs int
}

type traceDialect string

const (
	traceDialectSQLite   traceDialect = "sqlite"
	traceDialectPostgres traceDialect = "postgres"
)

func NewTraceService(db *gorm.DB, defaultWinMs int) *TraceService {
	if defaultWinMs <= 0 {
		defaultWinMs = 24 * 60 * 60 * 1000
	}
	if db == nil {
		return &TraceService{defaultWinMs: defaultWinMs}
	}
	sqlDB, err := db.DB()
	if err != nil {
		return &TraceService{defaultWinMs: defaultWinMs}
	}
	name := strings.ToLower(strings.TrimSpace(db.Dialector.Name()))
	d := traceDialectSQLite
	if strings.Contains(name, "postgres") || strings.Contains(name, "pg") {
		d = traceDialectPostgres
	}
	return &TraceService{db: sqlDB, dialect: d, defaultWinMs: defaultWinMs}
}

func (s *TraceService) List(req TraceListQuery, statusQueryValues []string) (map[string]interface{}, error) {
	since, until := s.timeRange(req.SinceMs, req.UntilMs)
	q := model.TraceRecordsListQuery{
		Limit:         clampInt(req.Limit, 100, 1, 500),
		Offset:        clampInt(req.Offset, 0, 0, 1<<30),
		Order:         strings.ToLower(strings.TrimSpace(req.Order)),
		Sort:          strings.ToLower(strings.TrimSpace(req.Sort)),
		Search:        strPtr(req.Search),
		SinceMs:       since,
		UntilMs:       until,
		Channel:       strPtr(req.Channel),
		Agent:         strPtr(req.Agent),
		WorkspaceName: strPtr(req.WorkspaceName),
		ListStatuses:  parseStatuses(statusQueryValues),
	}
	if n, ok := parsePositiveInt64(req.MinTotalTokens); ok {
		q.MinTotalTokens = &n
	}
	if n, ok := parsePositiveInt64(req.MinLoopCount); ok {
		q.MinLoopCount = &n
	}
	if n, ok := parsePositiveInt64(req.MinToolCalls); ok {
		q.MinToolCalls = &n
	}

	items, err := model.QueryTraceRecordsDB(s.db, q, s.dialect == traceDialectPostgres)
	if err != nil {
		return nil, err
	}
	total, err := model.CountTraceRecordsDB(s.db, q, s.dialect == traceDialectPostgres)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"items": items,
		"total": total,
	}, nil
}

func (s *TraceService) ThreadList(req ThreadListQuery) (map[string]interface{}, error) {
	since, until := s.timeRange(req.SinceMs, req.UntilMs)
	q := model.ThreadRecordsListQuery{
		Limit:         clampInt(req.Limit, 100, 1, 500),
		Offset:        clampInt(req.Offset, 0, 0, 1<<30),
		Order:         strings.ToLower(strings.TrimSpace(req.Order)),
		Sort:          strings.ToLower(strings.TrimSpace(req.Sort)),
		Search:        strPtr(req.Search),
		SinceMs:       since,
		UntilMs:       until,
		Channel:       strPtr(req.Channel),
		Agent:         strPtr(req.Agent),
		WorkspaceName: strPtr(req.WorkspaceName),
	}
	items, err := model.QueryThreadRecordsDB(s.db, q)
	if err != nil {
		return nil, err
	}
	total, err := model.CountThreadRecordsDB(s.db, q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"items": items, "total": total}, nil
}

func (s *TraceService) SpanList(req SpanListQuery, statusQueryValues []string) (map[string]interface{}, error) {
	since, until := s.timeRange(req.SinceMs, req.UntilMs)
	q := model.SpanRecordsListQuery{
		Limit:         clampInt(req.Limit, 100, 1, 500),
		Offset:        clampInt(req.Offset, 0, 0, 1<<30),
		Order:         strings.ToLower(strings.TrimSpace(req.Order)),
		Sort:          strings.ToLower(strings.TrimSpace(req.Sort)),
		Search:        strPtr(req.Search),
		SinceMs:       since,
		UntilMs:       until,
		Channel:       strPtr(req.Channel),
		Agent:         strPtr(req.Agent),
		SpanType:      model.ParseObserveSpanListType(req.SpanType),
		ListStatuses:  parseStatuses(statusQueryValues),
		WorkspaceName: strPtr(req.WorkspaceName),
	}
	items, err := model.QuerySpanRecordsDB(s.db, q)
	if err != nil {
		return nil, err
	}
	total, err := model.CountSpanRecordsDB(s.db, q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"items": items, "total": total}, nil
}

func (s *TraceService) timeRange(sinceRaw, untilRaw string) (*int64, *int64) {
	sinceMs := parseEpochMs(sinceRaw)
	untilMs := parseEpochMs(untilRaw)
	if sinceMs == nil && untilMs == nil {
		return nil, nil
	}

	maxWin := int64(30 * 24 * 60 * 60 * 1000)
	sm, um := sinceMs, untilMs
	if sm != nil && um != nil && *sm > 0 && *um > 0 && *um-*sm > maxWin {
		ns := *um - maxWin
		sm = &ns
	}
	return sm, um
}

func parseStatuses(values []string) []model.ObserveListStatus {
	if len(values) == 0 {
		return nil
	}
	items := make([]model.ObserveListStatus, 0, len(values))
	for _, raw := range values {
		parts := strings.Split(raw, ",")
		for _, p := range parts {
			switch strings.ToLower(strings.TrimSpace(p)) {
			case "running":
				items = append(items, model.StatusRunning)
			case "success":
				items = append(items, model.StatusSuccess)
			case "error":
				items = append(items, model.StatusError)
			case "timeout":
				items = append(items, model.StatusTimeout)
			}
		}
	}
	return items
}

func parsePositiveInt64(v string) (int64, bool) {
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func parseEpochMs(v string) *int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || n <= 0 {
		return nil
	}
	return &n
}

func strPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

func clampInt(v, def, min, max int) int {
	if v < min {
		v = def
	}
	if v > max {
		v = max
	}
	return v
}
