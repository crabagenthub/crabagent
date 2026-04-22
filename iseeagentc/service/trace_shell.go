package service

import (
	"database/sql"
	"strings"

	"iseeagentc/internal/shellexec"
	"iseeagentc/model"
)

type ShellSummaryQuery struct {
	SinceMs         string
	UntilMs         string
	TraceID         string
	Channel         string
	Agent           string
	CommandContains string
	WorkspaceName   string
	MinDurationMs   string
	MaxDurationMs   string
}

type ShellListQuery struct {
	SinceMs         string
	UntilMs         string
	TraceID         string
	Channel         string
	Agent           string
	CommandContains string
	WorkspaceName   string
	MinDurationMs   string
	MaxDurationMs   string
	Limit           int
	Offset          int
	Order           string
}

type TraceShellService struct {
	db *sql.DB
}

func NewTraceShellService(db *sql.DB) *TraceShellService {
	return &TraceShellService{db: db}
}

func (s *TraceShellService) Summary(req ShellSummaryQuery) (model.ShellExecSummaryResponse, error) {
	var resp model.ShellExecSummaryResponse
	snap, err := model.QueryShellExecDbSnapshot(s.db, "")
	if err != nil {
		return resp, err
	}
	resp.DBSnapshot = snap
	q := model.ShellExecBaseQuery{
		SinceMs:         parseEpochMs(req.SinceMs),
		UntilMs:         parseEpochMs(req.UntilMs),
		TraceID:         strings.TrimSpace(req.TraceID),
		Channel:         strings.TrimSpace(req.Channel),
		Agent:           strings.TrimSpace(req.Agent),
		CommandContains: strings.TrimSpace(req.CommandContains),
		WorkspaceName:   strings.TrimSpace(req.WorkspaceName),
	}
	if n, ok := parseNonNegativeInt64(req.MinDurationMs); ok {
		q.MinDurationMs = &n
	}
	if n, ok := parseNonNegativeInt64(req.MaxDurationMs); ok {
		q.MaxDurationMs = &n
	}
	rows, capped, err := model.FetchShellSpanRowsForSummary(s.db, q)
	if err != nil {
		return resp, err
	}
	cfg := shellexec.LoadResourceAuditConfig()
	opts := shellexec.ComputeSummaryOptions{
		Capped:               capped,
		LoopAlertMinRepeat:   cfg.ShellExec.LoopAlerts.MinRepeatCount,
		LoopAlertMaxItems:    cfg.ShellExec.LoopAlerts.MaxItems,
		TokenRiskStdoutChars: cfg.ShellExec.TokenRisks.StdoutCharsThreshold,
		TokenRiskMaxItems:    cfg.ShellExec.TokenRisks.MaxItems,
		Config:               cfg,
	}
	if q.SinceMs != nil && q.UntilMs != nil && *q.SinceMs > 0 && *q.UntilMs >= *q.SinceMs {
		opts.TrendRangeSinceMs = q.SinceMs
		opts.TrendRangeUntilMs = q.UntilMs
	}
	summary := shellexec.ComputeShellSummaryFromRows(rows, opts)
	model.EnrichShellSummaryChainPreview(s.db, &summary)
	resp.ShellSummaryJSON = summary
	return resp, nil
}

func (s *TraceShellService) List(req ShellListQuery) (model.ShellExecListResult, error) {
	order := strings.ToLower(strings.TrimSpace(req.Order))
	if order == "" {
		order = "desc"
	}
	q := model.ShellExecListQuery{
		ShellExecBaseQuery: model.ShellExecBaseQuery{
			SinceMs:         parseEpochMs(req.SinceMs),
			UntilMs:         parseEpochMs(req.UntilMs),
			TraceID:         strings.TrimSpace(req.TraceID),
			Channel:         strings.TrimSpace(req.Channel),
			Agent:           strings.TrimSpace(req.Agent),
			CommandContains: strings.TrimSpace(req.CommandContains),
			WorkspaceName:   strings.TrimSpace(req.WorkspaceName),
		},
		Limit:  clampInt(req.Limit, 50, 1, 200),
		Offset: clampInt(req.Offset, 0, 0, 1<<30),
		Order:  order,
	}
	if n, ok := parseNonNegativeInt64(req.MinDurationMs); ok {
		q.MinDurationMs = &n
	}
	if n, ok := parseNonNegativeInt64(req.MaxDurationMs); ok {
		q.MaxDurationMs = &n
	}
	return model.QueryShellExecList(s.db, q)
}

func (s *TraceShellService) Detail(spanID string) (*model.ShellExecDetailResult, error) {
	return model.QueryShellExecDetail(s.db, strings.TrimSpace(spanID))
}

// Replay returns time-ordered shell execution rows for observational replay.
func (s *TraceShellService) Replay(traceID string) ([]model.ShellReplayItem, error) {
	return model.QueryShellExecReplay(s.db, strings.TrimSpace(traceID))
}

func parseNonNegativeInt64(v string) (int64, bool) {
	n, ok := parsePositiveInt64(v)
	if ok {
		return n, true
	}
	if strings.TrimSpace(v) == "0" {
		return 0, true
	}
	return 0, false
}
