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
