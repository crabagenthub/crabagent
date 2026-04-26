package model

import (
	"database/sql"
	"errors"
	"strings"

	textparser "iseeagentc/internal/parser"
	"iseeagentc/internal/sqlutil"
)

type SemanticSpanRow struct {
	SpanID           string                 `json:"span_id"`
	TraceID          string                 `json:"trace_id"`
	ParentID         *string                `json:"parent_id"`
	Module           string                 `json:"module"`
	Type             string                 `json:"type"`
	Name             string                 `json:"name"`
	Input            map[string]interface{} `json:"input"`
	Output           map[string]interface{} `json:"output"`
	Metadata         map[string]interface{} `json:"metadata"`
	StartTime        int64                  `json:"start_time"`
	EndTime          *int64                 `json:"end_time"`
	Error            *string                `json:"error"`
	ModelName        *string                `json:"model_name"`
	PromptTokens     *float64               `json:"prompt_tokens"`
	CompletionTokens *float64               `json:"completion_tokens"`
	ContextFull      *string                `json:"context_full"`
	ContextSent      *string                `json:"context_sent"`
	TotalTokens      *float64               `json:"total_tokens"`
	CacheReadTokens  *float64               `json:"cache_read_tokens"`
	UsageBreakdown   map[string]float64     `json:"usage_breakdown"`
}

// tryResolveTraceIDByEmbeddedMessageID 当 query 的 id 实为渠道 message id（落在 trace 的 metadata / input 的 user_turn 中）
// 但不同于 OpenClaw 生成的 trace_id 时，在 JSON 中搜索该 id 以解析到真实 trace_id。
// 与 extractMsgIDFromTrace / 前端 /messages/:id 的用法对齐。
func tryResolveTraceIDByEmbeddedMessageID(db QueryDB, candidate string) string {
	c := strings.TrimSpace(candidate)
	// 过短会误匹；UUID 等至少 8 字
	if db == nil || len(c) < 8 {
		return ""
	}
	var q string
	if sqlutil.IsSQLite(db) {
		q = `SELECT t.trace_id
FROM ` + CT.Traces + ` t
WHERE (instr(COALESCE(t.metadata_json, '') || COALESCE(t.input_json, ''), ?) > 0)
ORDER BY (EXISTS (SELECT 1 FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id)) DESC,
         COALESCE(t.created_at_ms, 0) DESC
LIMIT 1`
	} else {
		q = `SELECT t.trace_id
FROM ` + CT.Traces + ` t
WHERE (position($1 in (COALESCE(t.metadata_json, '') || COALESCE(t.input_json, ''))) > 0)
ORDER BY (EXISTS (SELECT 1 FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id)) DESC,
         COALESCE(t.created_at_ms, 0) DESC
LIMIT 1`
	}
	var out string
	if err := db.QueryRow(q, c).Scan(&out); err != nil || strings.TrimSpace(out) == "" {
		return ""
	}
	return out
}

func resolveCanonicalTraceIDForSpanModel(db QueryDB, tidRaw string) string {
	tid := strings.TrimSpace(tidRaw)
	if tid == "" {
		return ""
	}
	var out string
	err := db.QueryRow(`
SELECT t.trace_id
FROM ` + CT.Traces + ` t
WHERE t.trace_id = ?
   OR COALESCE(NULLIF(TRIM(t.thread_id), ''), t.trace_id) = ?
ORDER BY (EXISTS (SELECT 1 FROM ` + CT.Spans + ` s WHERE s.trace_id = t.trace_id)) DESC,
         COALESCE(t.created_at_ms, 0) DESC
LIMIT 1`, tid, tid).Scan(&out)
	if err == nil && strings.TrimSpace(out) != "" {
		return out
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return tid
	}
	if r := tryResolveTraceIDByEmbeddedMessageID(db, tid); r != "" {
		return r
	}
	return tid
}

func queryTraceInputByTraceIDModel(db QueryDB, canonicalTraceID string) map[string]interface{} {
	var raw sql.NullString
	err := db.QueryRow(`SELECT input_json FROM ` + CT.Traces + ` WHERE trace_id = ? LIMIT 1`, strings.TrimSpace(canonicalTraceID)).Scan(&raw)
	if err != nil || !raw.Valid {
		return map[string]interface{}{}
	}
	return textparser.ParseJSONObjectString(raw.String)
}

func querySemanticSpansByTraceIDModel(db QueryDB, canonicalTraceID string) ([]SemanticSpanRow, error) {
	tid := strings.TrimSpace(canonicalTraceID)
	rows, err := db.Query(`
SELECT s.span_id, s.trace_id, s.parent_span_id, s.span_type, s.name,
       s.input_json, s.output_json, s.start_time_ms, s.end_time_ms, s.error_info_json,
       s.metadata_json, s.usage_json, s.model
FROM ` + CT.Spans + ` s
WHERE s.trace_id = ?
ORDER BY COALESCE(s.sort_index, 0) ASC, s.start_time_ms ASC, s.span_id ASC`, tid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SemanticSpanRow
	for rows.Next() {
		var spanID, traceID, parentID, spanType, name sql.NullString
		var inJ, outJ, errJ, metaJ, usageJ, model sql.NullString
		var startMs sql.NullInt64
		var endMs sql.NullInt64
		if err := rows.Scan(&spanID, &traceID, &parentID, &spanType, &name, &inJ, &outJ, &startMs, &endMs, &errJ, &metaJ, &usageJ, &model); err != nil {
			return nil, err
		}
		meta := map[string]interface{}{}
		if metaJ.Valid {
			meta = textparser.ParseJSONObjectString(metaJ.String)
		}
		errInfo := map[string]interface{}{}
		if errJ.Valid {
			errInfo = textparser.ParseJSONObjectString(errJ.String)
		}
		var errMsg *string
		if m := textparser.StringValue(errInfo["message"]); m != "" {
			errMsg = &m
		} else if m := textparser.StringValue(errInfo["exception_message"]); m != "" {
			errMsg = &m
		}
		st := "general"
		if spanType.Valid {
			st = spanType.String
		}
		nm := ""
		if name.Valid {
			nm = name.String
		}
		apiType := MapSpanTypeToApi(st, nm, meta)
		var usageStr *string
		if usageJ.Valid {
			usageStr = &usageJ.String
		}
		u := textparser.ParseUsageExtended(usageStr)
		var ctxFull, ctxSent *string
		if v := textparser.StringValue(meta["context_full"]); v != "" {
			ctxFull = &v
		}
		if v := textparser.StringValue(meta["context_sent"]); v != "" {
			ctxSent = &v
		}
		mod := st
		if sm := textparser.StringValue(meta["semantic_module"]); sm != "" {
			mod = sm
		}
		var pid *string
		if parentID.Valid && strings.TrimSpace(parentID.String) != "" {
			p := strings.TrimSpace(parentID.String)
			pid = &p
		}
		var endPtr *int64
		if endMs.Valid {
			v := endMs.Int64
			endPtr = &v
		}
		var modelPtr *string
		if model.Valid && strings.TrimSpace(model.String) != "" {
			m := model.String
			modelPtr = &m
		}
		stVal := int64(0)
		if startMs.Valid {
			stVal = startMs.Int64
		}
		inObj := map[string]interface{}{}
		if inJ.Valid {
			inObj = textparser.ParseJSONObjectString(inJ.String)
		}
		outObj := map[string]interface{}{}
		if outJ.Valid {
			outObj = textparser.ParseJSONObjectString(outJ.String)
		}
		out = append(out, SemanticSpanRow{
			SpanID:           spanID.String,
			TraceID:          traceID.String,
			ParentID:         pid,
			Module:           mod,
			Type:             apiType,
			Name:             nm,
			Input:            inObj,
			Output:           outObj,
			Metadata:         meta,
			StartTime:        stVal,
			EndTime:          endPtr,
			Error:            errMsg,
			ModelName:        modelPtr,
			PromptTokens:     u.PromptTokens,
			CompletionTokens: u.CompletionTokens,
			TotalTokens:      u.TotalTokens,
			CacheReadTokens:  u.CacheReadTokens,
			UsageBreakdown:   u.UsageBreakdown,
			ContextFull:      ctxFull,
			ContextSent:      ctxSent,
		})
	}
	return out, rows.Err()
}
