package alerts

import (
	"encoding/json"
	"strings"

	"iseeagentc/model"
)

func parseAdvanced(r *model.AlertRuleRow) AdvancedFilter {
	var out AdvancedFilter
	if r == nil || r.AdvancedJSON == nil || strings.TrimSpace(*r.AdvancedJSON) == "" {
		return out
	}
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(*r.AdvancedJSON), &raw); err != nil {
		return out
	}
	if v, ok := raw["sourceTable"].(string); ok {
		out.SourceTable = strings.TrimSpace(v)
	}
	if v, ok := raw["source_table"].(string); ok && out.SourceTable == "" {
		out.SourceTable = strings.TrimSpace(v)
	}
	if v, ok := raw["conditionField"].(string); ok {
		out.ConditionField = strings.TrimSpace(v)
	}
	if v, ok := raw["condition_field"].(string); ok && out.ConditionField == "" {
		out.ConditionField = strings.TrimSpace(v)
	}
	if v, ok := raw["matchType"].(string); ok {
		out.MatchType = strings.TrimSpace(v)
	}
	if v, ok := raw["match_type"].(string); ok && out.MatchType == "" {
		out.MatchType = strings.TrimSpace(v)
	}
	switch v := raw["countThreshold"].(type) {
	case float64:
		out.CountThreshold = v
	case json.Number:
		f, _ := v.Float64()
		out.CountThreshold = f
	}
	if v, ok := raw["frequencyMode"].(string); ok {
		out.FrequencyMode = strings.TrimSpace(v)
	} else if v, ok := raw["frequency_mode"].(string); ok {
		out.FrequencyMode = strings.TrimSpace(v)
	}
	// sub-window (minutes), camelCase or snake
	switch v := raw["subWindowMinutes"].(type) {
	case float64:
		out.SubWindowMinutes = int(v)
	case json.Number:
		f, _ := v.Float64()
		out.SubWindowMinutes = int(f)
	}
	if out.SubWindowMinutes == 0 {
		switch v := raw["sub_window_minutes"].(type) {
		case float64:
			out.SubWindowMinutes = int(v)
		case json.Number:
			f, _ := v.Float64()
			out.SubWindowMinutes = int(f)
		}
	}
	if v, ok := raw["subWindowMode"].(string); ok {
		out.SubWindowMode = strings.TrimSpace(v)
	} else if v, ok := raw["sub_window_mode"].(string); ok {
		out.SubWindowMode = strings.TrimSpace(v)
	}
	if out.SubWindowMode == "" {
		out.SubWindowMode = "any_max"
	}
	return out
}

func compare(op string, value, thr float64) bool {
	switch strings.ToLower(strings.TrimSpace(op)) {
	case "lt":
		return value < thr
	case "eq":
		return value == thr
	default:
		return value > thr
	}
}
