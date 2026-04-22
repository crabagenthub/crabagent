package model

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	textparser "iseeagentc/internal/parser"
)

var (
	bracketDateLineRe = regexp.MustCompile(`(^|\r?\n)\[[^\]]*(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})[^\]]*]\s*`)
	wordAsyncRe       = regexp.MustCompile(`(?i)\basync\b`)
)

func stripLeadingBracketDatePrefixes(text string) string {
	return bracketDateLineRe.ReplaceAllString(text, "$1")
}

var traceInputStringKeys = []string{
	"list_input_preview",
	"prompt",
	"systemPrompt",
	"text",
	"body",
	"message",
	"content",
}

func stripUserTurnRecord(ut map[string]interface{}) map[string]interface{} {
	out := shallowCopyMap(ut)
	if mr, ok := out["message_received"].(map[string]interface{}); ok && mr != nil {
		m := shallowCopyMap(mr)
		if c, ok := m["content"].(string); ok && len(c) > 0 {
			m["content"] = stripLeadingBracketDatePrefixes(c)
		}
		out["message_received"] = m
	}
	return out
}

func normalizeOpikTraceInputForStorage(input interface{}) interface{} {
	if input == nil {
		return input
	}
	o, ok := input.(map[string]interface{})
	if !ok || o == nil {
		return input
	}
	out := shallowCopyMap(o)
	for _, k := range traceInputStringKeys {
		if v, ok := out[k].(string); ok && len(v) > 0 {
			out[k] = stripLeadingBracketDatePrefixes(v)
		}
	}
	if ut, ok := out["user_turn"].(map[string]interface{}); ok && ut != nil {
		out["user_turn"] = stripUserTurnRecord(ut)
	}
	return out
}

func strTrim(v interface{}) *string {
	s, ok := v.(string)
	if !ok {
		return nil
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func extractMsgIDFromTrace(metadata, input map[string]interface{}) interface{} {
	fromMeta := firstStr(
		strTrim(metadata["msg_id"]),
		strTrim(metadata["messageId"]),
		strTrim(metadata["message_id"]),
		strTrim(metadata["correlation_id"]),
	)
	if fromMeta != nil {
		return *fromMeta
	}
	ut, ok := input["user_turn"].(map[string]interface{})
	if !ok || ut == nil {
		return nil
	}
	mr, ok := ut["message_received"].(map[string]interface{})
	if !ok || mr == nil {
		return nil
	}
	direct := firstStr(
		strTrim(mr["msg_id"]),
		strTrim(mr["messageId"]),
		strTrim(mr["message_id"]),
		strTrim(mr["id"]),
	)
	if direct != nil {
		return *direct
	}
	mmeta, ok := mr["metadata"].(map[string]interface{})
	if !ok || mmeta == nil {
		return nil
	}
	nested := firstStr(
		strTrim(mmeta["msg_id"]),
		strTrim(mmeta["messageId"]),
		strTrim(mmeta["message_id"]),
		strTrim(mmeta["dingtalk_message_id"]),
		strTrim(mmeta["dingTalkMessageId"]),
	)
	if nested != nil {
		return *nested
	}
	return nil
}

func extractSessionIDFromTrace(metadata, input map[string]interface{}) interface{} {
	if s := firstStr(strTrim(metadata["session_id"]), strTrim(metadata["sessionId"])); s != nil {
		return *s
	}
	if ocCtx, ok := metadata["openclaw_context"].(map[string]interface{}); ok && ocCtx != nil {
		if s := firstStr(strTrim(ocCtx["sessionId"]), strTrim(ocCtx["session_id"])); s != nil {
			return *s
		}
	}
	if oc, ok := input["openclaw"].(map[string]interface{}); ok && oc != nil {
		if s := firstStr(strTrim(oc["sessionId"]), strTrim(oc["session_id"])); s != nil {
			return *s
		}
	}
	return nil
}

func inferAsyncCommandTrace(metadata map[string]interface{}, chatTitle *string, input map[string]interface{}) bool {
	if metadata["async_command"] == true || metadata["is_async"] == true {
		return true
	}
	if ck := strTrim(metadata["command_kind"]); ck != nil {
		l := strings.ToLower(*ck)
		if l == "async" || l == "async_follow_up" || l == "async_command" {
			return true
		}
	}
	title := ""
	if chatTitle != nil {
		title = *chatTitle
	}
	lt := strings.ToLower(title)
	if strings.Contains(lt, "异步") || wordAsyncRe.MatchString(title) {
		return true
	}
	ut, ok := input["user_turn"].(map[string]interface{})
	if !ok || ut == nil {
		return false
	}
	mr, ok := ut["message_received"].(map[string]interface{})
	if !ok || mr == nil {
		return false
	}
	if mr["async"] == true || mr["isAsync"] == true {
		return true
	}
	mmeta, ok := mr["metadata"].(map[string]interface{})
	if !ok || mmeta == nil {
		return false
	}
	if mmeta["async_command"] == true || mmeta["is_async"] == true {
		return true
	}
	if kind := strTrim(mmeta["command_kind"]); kind != nil {
		l := strings.ToLower(*kind)
		if l == "async" || l == "async_command" || l == "async_follow_up" {
			return true
		}
	}
	return false
}

func runKindFromMetadata(metadata map[string]interface{}) interface{} {
	if v := firstStr(strTrim(metadata["run_kind"]), strTrim(metadata["runKind"])); v != nil {
		return *v
	}
	return nil
}

func runKindFromTraceType(traceType *string) interface{} {
	t := ""
	if traceType != nil {
		t = strings.TrimSpace(*traceType)
	}
	if t == "" {
		return nil
	}
	l := strings.ToLower(t)
	if l == "async_command" {
		return "async_followup"
	}
	return l
}

func agentNameFromMetadata(metadata map[string]interface{}) interface{} {
	for _, k := range []string{"agent_name", "agentName", "agent"} {
		if v, ok := metadata[k].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	oc, ok := metadata["openclaw_context"].(map[string]interface{})
	if !ok || oc == nil {
		return nil
	}
	for _, k := range []string{"agentName", "agent_name", "agentId", "agent_id"} {
		if v, ok := oc[k].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return nil
}

func isSyntheticNonLlmTraceKind(traceKind interface{}) bool {
	s, ok := traceKind.(string)
	return ok && strings.HasPrefix(s, "agent_end_")
}

func safeObject(raw *string) map[string]interface{} {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return map[string]interface{}{}
	}
	var j interface{}
	if err := json.Unmarshal([]byte(*raw), &j); err != nil {
		return map[string]interface{}{}
	}
	if m, ok := j.(map[string]interface{}); ok && m != nil {
		return m
	}
	return map[string]interface{}{}
}

func userPayloadFromInput(input map[string]interface{}) map[string]interface{} {
	if len(input) > 0 {
		n := normalizeOpikTraceInputForStorage(input)
		if m, ok := n.(map[string]interface{}); ok && m != nil {
			return m
		}
		return shallowCopyMap(input)
	}
	return map[string]interface{}{"text": "—"}
}

func roleLooksAssistantMessage(o map[string]interface{}) bool {
	role := strings.ToLower(fmt.Sprint(o["role"]))
	typ := strings.ToLower(fmt.Sprint(o["type"]))
	return role == "assistant" || role == "ai" || role == "model" || role == "bot" || typ == "ai" || typ == "aimessage" || typ == "assistant"
}

func roleLooksToolMessage(o map[string]interface{}) bool {
	return strings.ToLower(fmt.Sprint(o["role"])) == "tool"
}

func textFromMessageLike(o map[string]interface{}) *string {
	content := o["content"]
	if s, ok := content.(string); ok && strings.TrimSpace(s) != "" {
		t := strings.TrimSpace(s)
		return &t
	}
	arr, ok := content.([]interface{})
	if !ok {
		return nil
	}
	var parts []string
	for _, x := range arr {
		switch v := x.(type) {
		case string:
			if v != "" {
				parts = append(parts, v)
			}
		case map[string]interface{}:
			if t, ok := v["text"].(string); ok {
				parts = append(parts, t)
			}
		}
	}
	joined := strings.TrimSpace(strings.Join(parts, "\n"))
	if joined == "" {
		return nil
	}
	return &joined
}

func transcriptJoinedFromAssistantAndToolMessages(messages []interface{}) *string {
	var chunks []string
	for _, m := range messages {
		o, ok := m.(map[string]interface{})
		if !ok || o == nil {
			continue
		}
		if !roleLooksAssistantMessage(o) && !roleLooksToolMessage(o) {
			continue
		}
		if t := textFromMessageLike(o); t != nil && strings.TrimSpace(*t) != "" {
			chunks = append(chunks, strings.TrimSpace(*t))
		}
	}
	if len(chunks) == 0 {
		return nil
	}
	s := strings.Join(chunks, "\n\n")
	return &s
}

func extractAssistantTextsFromOutputShape(output map[string]interface{}) []string {
	if direct, ok := output["assistantTexts"].([]interface{}); ok {
		var parts []string
		for _, x := range direct {
			if s, ok := x.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					parts = append(parts, s)
				}
			}
		}
		if len(parts) > 0 {
			return parts
		}
	}
	if messages, ok := output["messages"].([]interface{}); ok {
		for pass := 0; pass < 2; pass++ {
			accept := roleLooksAssistantMessage
			if pass == 1 {
				accept = roleLooksToolMessage
			}
			for i := len(messages) - 1; i >= 0; i-- {
				o, ok := messages[i].(map[string]interface{})
				if !ok || o == nil || !accept(o) {
					continue
				}
				if t := textFromMessageLike(o); t != nil {
					return []string{*t}
				}
			}
		}
	}
	for _, k := range []string{"output", "text", "content", "response", "message"} {
		if v, ok := output[k].(string); ok && strings.TrimSpace(v) != "" {
			return []string{strings.TrimSpace(v)}
		}
	}
	if result, ok := output["result"].(string); ok && strings.TrimSpace(result) != "" {
		return []string{strings.TrimSpace(result)}
	}
	if r, ok := output["result"].(map[string]interface{}); ok && r != nil {
		if s, ok := r["text"].(string); ok && strings.TrimSpace(s) != "" {
			return []string{strings.TrimSpace(s)}
		}
		if s, ok := r["content"].(string); ok && strings.TrimSpace(s) != "" {
			return []string{strings.TrimSpace(s)}
		}
	}
	return nil
}

func mergeTraceOutputWithPrimaryLlmSpan(traceOutput map[string]interface{}, spanOutputJSON *string) map[string]interface{} {
	if extractAssistantTextsFromOutputShape(traceOutput) != nil {
		return shallowCopyMap(traceOutput)
	}
	spanOut := safeObject(spanOutputJSON)
	if len(spanOut) == 0 {
		return shallowCopyMap(traceOutput)
	}
	fromSpan := extractAssistantTextsFromOutputShape(spanOut)
	if len(fromSpan) == 0 {
		return shallowCopyMap(traceOutput)
	}
	out := shallowCopyMap(traceOutput)
	out["assistantTexts"] = fromSpan
	return out
}

func shouldPreferPrimaryLlmSpanUsage(outUsage interface{}, spanUsage map[string]interface{}) bool {
	spanB, err := json.Marshal(spanUsage)
	if err != nil {
		return false
	}
	spanJSON := string(spanB)
	outJSON := ""
	if outUsage != nil {
		if m, ok := outUsage.(map[string]interface{}); ok && m != nil {
			if ob, err := json.Marshal(m); err == nil {
				outJSON = string(ob)
			}
		}
	}
	spanP := textparser.ParseUsageExtended(&spanJSON)
	outP := textparser.ParseUsageExtended(&outJSON)
	st := spanP.TotalTokens
	ot := outP.TotalTokens
	return st != nil && *st > 0 && ot != nil && *ot > 0 && *st > *ot
}

func aggregateAllLlmSpanUsages(usageJSONRows []*string) map[string]interface{} {
	var sumP, sumC, sumCache, sumTotal int64
	n := 0
	for _, raw := range usageJSONRows {
		var u textparser.UsageExtendedResult
		if raw == nil {
			u = textparser.ParseUsageExtended(nil)
		} else {
			u = textparser.ParseUsageExtended(raw)
		}
		n++
		if u.PromptTokens != nil && isFiniteFloat(*u.PromptTokens) {
			sumP += int64(math.Max(0, math.Trunc(*u.PromptTokens)))
		}
		if u.CompletionTokens != nil && isFiniteFloat(*u.CompletionTokens) {
			sumC += int64(math.Max(0, math.Trunc(*u.CompletionTokens)))
		}
		if u.CacheReadTokens != nil && isFiniteFloat(*u.CacheReadTokens) {
			sumCache += int64(math.Max(0, math.Trunc(*u.CacheReadTokens)))
		}
		if u.TotalTokens != nil && isFiniteFloat(*u.TotalTokens) {
			sumTotal += int64(math.Max(0, math.Trunc(*u.TotalTokens)))
		}
	}
	if n == 0 || sumP+sumC+sumCache+sumTotal == 0 {
		return nil
	}
	total := sumTotal
	if total <= 0 {
		total = sumP + sumC
		if sumCache > 0 {
			total += sumCache
		}
	}
	out := map[string]interface{}{"input": sumP, "output": sumC, "total": total}
	if sumCache > 0 {
		out["cacheRead"] = sumCache
	}
	return out
}

func pickContextWindowTokens(input, metadata map[string]interface{}) *int64 {
	tryNum := func(v interface{}) *int64 {
		if f, ok := toFiniteFloat(v); ok && f > 0 {
			t := int64(math.Trunc(f))
			return &t
		}
		return nil
	}
	if routing, ok := input["openclaw_routing"].(map[string]interface{}); ok && routing != nil {
		if n := tryNum(routing["max_context_tokens"]); n != nil {
			return n
		}
	}
	for _, k := range []string{"max_context_tokens", "contextTokens", "context_tokens", "contextWindow", "context_window_tokens"} {
		if n := tryNum(metadata[k]); n != nil {
			return n
		}
		if n := tryNum(input[k]); n != nil {
			return n
		}
	}
	return nil
}

func llmOutputPayload(output, metadata map[string]interface{}, spanUsage map[string]interface{}, spanModel, spanProvider *string, contextWindowTokens *int64) map[string]interface{} {
	out := shallowCopyMap(output)
	if msgs, ok := out["messages"].([]interface{}); ok && len(msgs) > 0 {
		if joined := transcriptJoinedFromAssistantAndToolMessages(msgs); joined != nil {
			var atArr []string
			if at, ok := out["assistantTexts"].([]interface{}); ok {
				for _, x := range at {
					if s, ok := x.(string); ok {
						s = strings.TrimSpace(s)
						if s != "" {
							atArr = append(atArr, s)
						}
					}
				}
			}
			atJoined := strings.TrimSpace(strings.Join(atArr, "\n\n"))
			if len(*joined) > len(atJoined) || atJoined == "" {
				out["assistantTexts"] = []interface{}{*joined}
			}
		}
	}
	mdUsage := metadata["usage"]
	if m, ok := mdUsage.(map[string]interface{}); ok && m != nil && textparser.UsageHasTokenSignals(m) {
		var base map[string]interface{}
		if u, ok := out["usage"].(map[string]interface{}); ok && u != nil {
			base = shallowCopyMap(u)
		} else {
			base = map[string]interface{}{}
		}
		out["usage"] = mergeMaps(base, m)
	} else if out["usage"] == nil || !isMap(out["usage"]) {
		if m, ok := mdUsage.(map[string]interface{}); ok && m != nil {
			out["usage"] = shallowCopyMap(m)
		}
	}
	if spanUsage != nil && textparser.UsageHasTokenSignals(spanUsage) {
		spanBeats := shouldPreferPrimaryLlmSpanUsage(out["usage"], spanUsage)
		takeSpan := !textparser.UsageHasTokenSignals(out["usage"]) || spanBeats
		if takeSpan {
			if spanBeats {
				out["usage"] = shallowCopyMap(spanUsage)
			} else {
				var base map[string]interface{}
				if u, ok := out["usage"].(map[string]interface{}); ok && u != nil {
					base = shallowCopyMap(u)
				} else {
					base = map[string]interface{}{}
				}
				out["usage"] = mergeMaps(base, spanUsage)
			}
		}
	}
	mdUsageMetadata := metadata["usageMetadata"]
	if (out["usageMetadata"] == nil || !isMap(out["usageMetadata"])) && isMap(mdUsageMetadata) {
		out["usageMetadata"] = shallowCopyMap(mdUsageMetadata.(map[string]interface{}))
	}
	if extracted := extractAssistantTextsFromOutputShape(out); extracted != nil {
		existing, ok := out["assistantTexts"].([]interface{})
		if !ok || len(existing) == 0 {
			arr := make([]interface{}, len(extracted))
			for i, s := range extracted {
				arr[i] = s
			}
			out["assistantTexts"] = arr
		}
	}
	if prev, ok := metadata["output_preview"].(string); ok && strings.TrimSpace(prev) != "" {
		if !isSyntheticNonLlmTraceKind(metadata["trace_kind"]) {
			existing, ok := out["assistantTexts"].([]interface{})
			if !ok || len(existing) == 0 {
				t := strings.TrimSpace(prev)
				out["assistantTexts"] = []interface{}{t}
			}
		}
	}
	if outStr, ok := output["output"].(string); ok && strings.TrimSpace(outStr) != "" {
		existing, ok := out["assistantTexts"].([]interface{})
		if !ok || len(existing) == 0 {
			out["assistantTexts"] = []interface{}{strings.TrimSpace(outStr)}
		}
	}
	if contextWindowTokens != nil && *contextWindowTokens > 0 {
		out["context_window_tokens"] = *contextWindowTokens
	}
	if out["model"] == nil && spanModel != nil && strings.TrimSpace(*spanModel) != "" {
		out["model"] = strings.TrimSpace(*spanModel)
	}
	if out["provider"] == nil && spanProvider != nil && strings.TrimSpace(*spanProvider) != "" {
		out["provider"] = strings.TrimSpace(*spanProvider)
	}
	return out
}

type llmSpanRow struct {
	traceID    string
	outputJSON sql.NullString
	usageJSON  sql.NullString
	model      sql.NullString
	provider   sql.NullString
}

func loadThreadTraceEvents(db QueryDB, threadKey string) ([]map[string]interface{}, error) {
	key := strings.TrimSpace(threadKey)
	if key == "" {
		return nil, nil
	}
	scoped, err := QueryTracesInConversationScope(db, key, true)
	if err != nil {
		return nil, err
	}
	traceIDs := make([]string, 0, len(scoped))
	for _, r := range scoped {
		if tid := strings.TrimSpace(r.TraceID); tid != "" {
			traceIDs = append(traceIDs, tid)
		}
	}
	llmSpansByTraceID := map[string][]llmSpanRow{}
	if len(traceIDs) > 0 {
		uniq := dedupePreserveOrder(traceIDs)
		ph := strings.TrimSuffix(strings.Repeat("?,", len(uniq)), ",")
		q := `SELECT trace_id, output_json, usage_json, model, provider
         FROM ` + CT.Spans + `
         WHERE span_type = 'llm' AND trace_id IN (` + ph + `)
         ORDER BY trace_id ASC, COALESCE(sort_index, 999999) ASC, COALESCE(start_time_ms, 0) ASC`
		args := make([]interface{}, len(uniq))
		for i, id := range uniq {
			args[i] = id
		}
		rows, err := db.Query(q, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var row llmSpanRow
			if err := rows.Scan(&row.traceID, &row.outputJSON, &row.usageJSON, &row.model, &row.provider); err != nil {
				rows.Close()
				return nil, err
			}
			k := strings.TrimSpace(row.traceID)
			if k != "" {
				llmSpansByTraceID[k] = append(llmSpansByTraceID[k], row)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	var events []map[string]interface{}
	seq := 0
	for _, r := range scoped {
		traceID := strings.TrimSpace(r.TraceID)
		if traceID == "" {
			continue
		}
		created := int64(0)
		if r.CreatedAtMs.Valid {
			created = r.CreatedAtMs.Int64
		}
		var updated, ended, duration *int64
		if r.UpdatedAtMs.Valid {
			v := r.UpdatedAtMs.Int64
			updated = &v
		}
		if r.EndedAtMs.Valid {
			v := r.EndedAtMs.Int64
			ended = &v
		}
		if r.DurationMs.Valid && r.DurationMs.Int64 >= 0 {
			v := r.DurationMs.Int64
			duration = &v
		}
		var computedEnded *int64
		if ended != nil {
			computedEnded = ended
		} else if created > 0 && duration != nil {
			v := created + *duration
			computedEnded = &v
		} else if updated != nil {
			computedEnded = updated
		} else if created > 0 {
			computedEnded = &created
		}
		baseID := created + int64(seq)*100
		seq++
		input := safeObject(nullStringPtr(r.InputJSON))
		spanRows := llmSpansByTraceID[traceID]
		var primary *llmSpanRow
		if len(spanRows) > 0 {
			primary = &spanRows[0]
		}
		var primaryOut *string
		if primary != nil && primary.outputJSON.Valid {
			s := primary.outputJSON.String
			primaryOut = &s
		}
		output := mergeTraceOutputWithPrimaryLlmSpan(safeObject(nullStringPtr(r.OutputJSON)), primaryOut)
		metadata := safeObject(nullStringPtr(r.MetadataJSON))

		var usageRowPtrs []*string
		for i := range spanRows {
			if spanRows[i].usageJSON.Valid {
				s := spanRows[i].usageJSON.String
				usageRowPtrs = append(usageRowPtrs, &s)
			} else {
				usageRowPtrs = append(usageRowPtrs, nil)
			}
		}
		aggUsage := aggregateAllLlmSpanUsages(usageRowPtrs)
		var spanUsageForPayload map[string]interface{}
		if len(aggUsage) > 0 {
			spanUsageForPayload = aggUsage
		}
		var spanModel, spanProvider *string
		if primary != nil && primary.model.Valid && strings.TrimSpace(primary.model.String) != "" {
			s := strings.TrimSpace(primary.model.String)
			spanModel = &s
		}
		if primary != nil && primary.provider.Valid && strings.TrimSpace(primary.provider.String) != "" {
			s := strings.TrimSpace(primary.provider.String)
			spanProvider = &s
		}
		contextWindowTokens := pickContextWindowTokens(input, metadata)
		agentName := agentNameFromMetadata(metadata)
		var chatTitle *string
		if r.Name.Valid && strings.TrimSpace(r.Name.String) != "" {
			s := strings.TrimSpace(r.Name.String)
			chatTitle = &s
		}
		startWhen := msToISO(created)
		endWhen := startWhen
		if computedEnded != nil && *computedEnded > 0 {
			endWhen = msToISO(*computedEnded)
		}
		runID := traceID
		if s, ok := metadata["run_id"].(string); ok && strings.TrimSpace(s) != "" {
			runID = strings.TrimSpace(s)
		} else if s, ok := metadata["runId"].(string); ok && strings.TrimSpace(s) != "" {
			runID = strings.TrimSpace(s)
		}
		msgID := extractMsgIDFromTrace(metadata, input)
		sessionIDRow := extractSessionIDFromTrace(metadata, input)
		asyncCommand := inferAsyncCommandTrace(metadata, chatTitle, input)
		var threadIDRow interface{}
		if r.ThreadID.Valid && strings.TrimSpace(r.ThreadID.String) != "" {
			threadIDRow = strings.TrimSpace(r.ThreadID.String)
		}
		runKindRow := runKindFromMetadata(metadata)
		if runKindRow == nil {
			var tt *string
			if strings.TrimSpace(r.TraceType) != "" {
				s := strings.TrimSpace(r.TraceType)
				tt = &s
			}
			runKindRow = runKindFromTraceType(tt)
		}
		var traceTypeRow interface{}
		if strings.TrimSpace(r.TraceType) != "" {
			traceTypeRow = strings.TrimSpace(r.TraceType)
		}

		events = append(events, map[string]interface{}{
			"id":            baseID,
			"event_id":      fmt.Sprintf("%s:recv", traceID),
			"type":          "message_received",
			"trace_root_id": traceID,
			"thread_id":     threadIDRow,
			"session_id":    sessionIDRow,
			"trace_type":    traceTypeRow,
			"run_kind":      runKindRow,
			"agent_id":      nil,
			"agent_name":    agentName,
			"chat_title":    chatTitle,
			"msg_id":        msgID,
			"async_command": asyncCommand,
			"client_ts":     startWhen,
			"created_at":    startWhen,
			"started_at_ms": startedAtMS(created),
			"ended_at_ms":   int64PtrToAny(computedEnded),
			"updated_at_ms": int64PtrToAny(updated),
			"duration_ms":   int64PtrToAny(duration),
			"payload":       userPayloadFromInput(input),
		})

		llmInPayload := map[string]interface{}{"prompt": "—", "run_id": runID}
		if len(input) > 0 {
			llmInPayload = shallowCopyMap(input)
			llmInPayload["run_id"] = runID
		}
		events = append(events, map[string]interface{}{
			"id":            baseID + 1,
			"event_id":      fmt.Sprintf("%s:llm_in", traceID),
			"type":          "llm_input",
			"trace_root_id": traceID,
			"thread_id":     threadIDRow,
			"session_id":    sessionIDRow,
			"trace_type":    traceTypeRow,
			"run_kind":      runKindRow,
			"run_id":        runID,
			"agent_name":    agentName,
			"chat_title":    chatTitle,
			"msg_id":        msgID,
			"async_command": asyncCommand,
			"client_ts":     startWhen,
			"created_at":    startWhen,
			"started_at_ms": startedAtMS(created),
			"ended_at_ms":   int64PtrToAny(computedEnded),
			"updated_at_ms": int64PtrToAny(updated),
			"duration_ms":   int64PtrToAny(duration),
			"payload":       llmInPayload,
		})

		llmOutPayload := llmOutputPayload(output, metadata, spanUsageForPayload, spanModel, spanProvider, contextWindowTokens)
		if inModel, ok := input["model"].(string); ok && strings.TrimSpace(inModel) != "" {
			if llmOutPayload["model"] == nil {
				llmOutPayload["model"] = strings.TrimSpace(inModel)
			}
		}
		if inProvider, ok := input["provider"].(string); ok && strings.TrimSpace(inProvider) != "" {
			if llmOutPayload["provider"] == nil {
				llmOutPayload["provider"] = strings.TrimSpace(inProvider)
			}
		}
		events = append(events, map[string]interface{}{
			"id":            baseID + 2,
			"event_id":      fmt.Sprintf("%s:llm_out", traceID),
			"type":          "llm_output",
			"trace_root_id": traceID,
			"thread_id":     threadIDRow,
			"session_id":    sessionIDRow,
			"trace_type":    traceTypeRow,
			"run_kind":      runKindRow,
			"run_id":        runID,
			"agent_name":    agentName,
			"chat_title":    chatTitle,
			"msg_id":        msgID,
			"async_command": asyncCommand,
			"client_ts":     endWhen,
			"created_at":    endWhen,
			"started_at_ms": startedAtMS(created),
			"ended_at_ms":   int64PtrToAny(computedEnded),
			"updated_at_ms": int64PtrToAny(updated),
			"duration_ms":   int64PtrToAny(duration),
			"payload":       llmOutPayload,
		})
	}
	return events, nil
}

func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

func dedupePreserveOrder(ids []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func shallowCopyMap(m map[string]interface{}) map[string]interface{} {
	if m == nil {
		return map[string]interface{}{}
	}
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func mergeMaps(base, over map[string]interface{}) map[string]interface{} {
	out := shallowCopyMap(base)
	for k, v := range over {
		out[k] = v
	}
	return out
}

func isMap(v interface{}) bool {
	_, ok := v.(map[string]interface{})
	return ok
}

func firstStr(vals ...*string) *string {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

func toFiniteFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return 0, false
		}
		return x, true
	case json.Number:
		f, err := x.Float64()
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	default:
		return 0, false
	}
}

func isFiniteFloat(x float64) bool {
	return !math.IsNaN(x) && !math.IsInf(x, 0)
}

func msToISO(ms int64) string {
	if ms <= 0 {
		return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	}
	t := time.UnixMilli(ms).UTC()
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
		t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond()/1e6)
}

func startedAtMS(created int64) interface{} {
	if created > 0 {
		return created
	}
	return nil
}

func int64PtrToAny(p *int64) interface{} {
	if p == nil {
		return nil
	}
	return *p
}

func NormalizeOpikTraceInputForStorage(input interface{}) interface{} {
	return normalizeOpikTraceInputForStorage(input)
}
