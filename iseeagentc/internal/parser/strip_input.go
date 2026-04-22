package parser

import "regexp"

var (
	bracketDateLineRe = regexp.MustCompile(`(^|\r?\n)\[[^\]]*(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})[^\]]*]\s*`)
	traceInputKeys    = []string{
		"list_input_preview",
		"prompt",
		"systemPrompt",
		"text",
		"body",
		"message",
		"content",
	}
)

func stripLeadingBracketDatePrefixes(text string) string {
	return bracketDateLineRe.ReplaceAllString(text, "$1")
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

// NormalizeOpikTraceInputForStorage aligns with TS normalizeOpikTraceInputForStorage.
func NormalizeOpikTraceInputForStorage(input interface{}) interface{} {
	if input == nil {
		return input
	}
	o, ok := input.(map[string]interface{})
	if !ok || o == nil {
		return input
	}
	out := shallowCopyMap(o)
	for _, k := range traceInputKeys {
		if v, ok := out[k].(string); ok && len(v) > 0 {
			out[k] = stripLeadingBracketDatePrefixes(v)
		}
	}
	if ut, ok := out["user_turn"].(map[string]interface{}); ok && ut != nil {
		out["user_turn"] = stripUserTurnRecord(ut)
	}
	return out
}

// NormalizeOpikSpanInputForStorage aligns with TS normalizeOpikSpanInputForStorage.
func NormalizeOpikSpanInputForStorage(input interface{}) interface{} {
	if input == nil {
		return input
	}
	o, ok := input.(map[string]interface{})
	if !ok || o == nil {
		return input
	}
	out := shallowCopyMap(o)
	spanInputKeys := append([]string{"promptPreview"}, traceInputKeys...)
	for _, k := range spanInputKeys {
		if v, ok := out[k].(string); ok && len(v) > 0 {
			out[k] = stripLeadingBracketDatePrefixes(v)
		}
	}
	if ut, ok := out["user_turn"].(map[string]interface{}); ok && ut != nil {
		out["user_turn"] = stripUserTurnRecord(ut)
	}
	return out
}
