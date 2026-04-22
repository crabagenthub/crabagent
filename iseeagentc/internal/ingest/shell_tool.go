package ingest

import (
	"encoding/json"
	"strings"

	textparser "iseeagentc/internal/parser"
)

// shellHintJSONValuePresent 对齐 SQLite 中 NULLIF(TRIM(json_extract(...)), '') IS NOT NULL 的宽松语义：
// 非空字符串、数字、布尔、数组、对象等在 json_extract 下多为非 NULL，旧逻辑仅识别 string 会导致
// 「统计 shell_like 有行但 SyncAgentExecCommandRow 只走 DELETE、不落库」。
func shellHintJSONValuePresent(v interface{}) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(x) != ""
	case bool, int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64, json.Number:
		return true
	case []interface{}, map[string]interface{}:
		return true
	default:
		return true
	}
}

// isShellLikeToolSpan mirrors model.ShellToolWhereSQL heuristics in Go (tool spans only).
func isShellLikeToolSpan(spanType, name string, inputJSON *string) bool {
	if strings.ToLower(strings.TrimSpace(spanType)) != "tool" {
		return false
	}
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "exec" {
		return true
	}
	subs := []string{
		"bash", "shell", "terminal", "pwsh", "powershell", "zsh", "fish",
		"run_terminal", "run_cmd", "runcmd", "subprocess", "sandbox", "local_shell",
		"exec_command", "execute_command", "process_command",
	}
	for _, s := range subs {
		if strings.Contains(n, s) {
			return true
		}
	}
	if n == "sh" || n == "ash" || n == "dash" {
		return true
	}
	if inputJSON != nil && strings.TrimSpace(*inputJSON) != "" {
		low := strings.ToLower(*inputJSON)
		var root map[string]interface{}
		if json.Unmarshal([]byte(*inputJSON), &root) == nil {
			if m, ok := root["params"].(map[string]interface{}); ok {
				for _, k := range []string{"command", "cmd", "shell_command", "line", "executable", "script", "cwd", "working_directory", "workingDirectory"} {
					if v, ok := m[k]; ok {
						if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
							return true
						}
						if shellHintJSONValuePresent(v) {
							return true
						}
					}
				}
			}
			if v, ok := root["command"]; ok {
				if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
					return true
				}
				if shellHintJSONValuePresent(v) {
					return true
				}
			}
			if s := strings.TrimSpace(textparser.ExtractCommandFromInput(root)); s != "" {
				return true
			}
		}
		if strings.Contains(low, `"cwd"`) && strings.Contains(low, `"command"`) {
			return true
		}
	}
	return false
}
