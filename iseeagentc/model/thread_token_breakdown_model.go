package model

import (
	"database/sql"
	"math"
	"strings"

	textparser "iseeagentc/internal/parser"
)

type ThreadTokenBreakdown struct {
	ThreadKey        string `json:"thread_key"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	CacheReadTokens  int    `json:"cache_read_tokens"`
	TotalTokens      int    `json:"total_tokens"`
}

func loadThreadTokenBreakdown(db QueryDB, threadID string) (*ThreadTokenBreakdown, error) {
	key := strings.TrimSpace(threadID)
	if key == "" {
		return &ThreadTokenBreakdown{}, nil
	}
	rows, err := db.Query(`
SELECT s.usage_json
FROM ` + CT.Spans + ` s
INNER JOIN ` + CT.Traces + ` t ON t.trace_id = s.trace_id
WHERE COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) = ?
  AND lower(s.span_type) = 'llm'`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var prompt, completion, cacheRead, total int
	for rows.Next() {
		var uj sql.NullString
		if err := rows.Scan(&uj); err != nil {
			return nil, err
		}
		var raw *string
		if uj.Valid {
			raw = &uj.String
		}
		u := textparser.ParseUsageExtended(raw)
		if u.PromptTokens != nil && !math.IsNaN(*u.PromptTokens) && !math.IsInf(*u.PromptTokens, 0) {
			prompt += int(math.Max(0, math.Trunc(*u.PromptTokens)))
		}
		if u.CompletionTokens != nil && !math.IsNaN(*u.CompletionTokens) && !math.IsInf(*u.CompletionTokens, 0) {
			completion += int(math.Max(0, math.Trunc(*u.CompletionTokens)))
		}
		if u.CacheReadTokens != nil && !math.IsNaN(*u.CacheReadTokens) && !math.IsInf(*u.CacheReadTokens, 0) {
			cacheRead += int(math.Max(0, math.Trunc(*u.CacheReadTokens)))
		}
		if u.TotalTokens != nil && !math.IsNaN(*u.TotalTokens) && !math.IsInf(*u.TotalTokens, 0) {
			total += int(math.Max(0, math.Trunc(*u.TotalTokens)))
		}
	}
	if total == 0 && (prompt > 0 || completion > 0 || cacheRead > 0) {
		total = prompt + completion + cacheRead
	}
	return &ThreadTokenBreakdown{
		ThreadKey:        key,
		PromptTokens:     prompt,
		CompletionTokens: completion,
		CacheReadTokens:  cacheRead,
		TotalTokens:      total,
	}, rows.Err()
}
