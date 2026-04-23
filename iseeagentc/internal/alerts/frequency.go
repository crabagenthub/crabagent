package alerts

import (
	"encoding/json"
	"strings"

	"iseeagentc/model"
)

// RuleFrequencyMode returns "immediate" or "windowed" from advanced_json (default windowed).
func RuleFrequencyMode(r *model.AlertRuleRow) string {
	if r == nil || r.AdvancedJSON == nil {
		return "windowed"
	}
	return RowFrequencyModeFromBytes(r.AdvancedJSON)
}

// RowFrequencyModeFromBytes parses the same from raw JSON (used in tests or callers without row).
func RowFrequencyModeFromBytes(advJSON *string) string {
	if advJSON == nil || strings.TrimSpace(*advJSON) == "" {
		return "windowed"
	}
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(*advJSON), &raw); err != nil {
		return "windowed"
	}
	s, _ := raw["frequencyMode"].(string)
	if s == "" {
		s, _ = raw["frequency_mode"].(string)
	}
	m := strings.ToLower(strings.TrimSpace(s))
	if m == "immediate" || m == "instant" {
		return "immediate"
	}
	return "windowed"
}
