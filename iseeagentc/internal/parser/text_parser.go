package parser

import (
	"encoding/json"
	"strings"
)

func ParseJSONObjectPtr(raw *string) map[string]any {
	if raw == nil {
		return map[string]any{}
	}
	return ParseJSONObjectString(*raw)
}

func ParseJSONObjectString(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}
	}
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return map[string]any{}
	}
	if m, ok := v.(map[string]any); ok && m != nil {
		return m
	}
	return map[string]any{}
}

func StringValue(v any) string {
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

func StringPtrValue(v any) *string {
	s := StringValue(v)
	if s == "" {
		return nil
	}
	return &s
}

func FirstNonEmptyString(vals ...*string) string {
	for _, p := range vals {
		if p != nil && *p != "" {
			return *p
		}
	}
	return ""
}

// TokenizeShellCommand parses shell-like text and preserves quoted groups.
func TokenizeShellCommand(command string) []string {
	s := strings.TrimSpace(command)
	if s == "" {
		return nil
	}
	var out []string
	var cur strings.Builder
	var quote rune
	esc := false
	for _, ch := range s {
		if esc {
			cur.WriteRune(ch)
			esc = false
			continue
		}
		if ch == '\\' {
			esc = true
			continue
		}
		if quote != 0 {
			if ch == quote {
				quote = 0
			} else {
				cur.WriteRune(ch)
			}
			continue
		}
		if ch == '"' || ch == '\'' {
			quote = ch
			continue
		}
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
			continue
		}
		cur.WriteRune(ch)
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

// ExtractCommandFromInput pulls command text from common shell payload keys.
func ExtractCommandFromInput(input map[string]any) string {
	if params, ok := input["params"].(map[string]any); ok && params != nil {
		if c := FirstNonEmptyString(
			StringPtrValue(params["command"]),
			StringPtrValue(params["cmd"]),
			StringPtrValue(params["shell_command"]),
			StringPtrValue(params["script"]),
			StringPtrValue(params["shellCommand"]),
			StringPtrValue(params["bash_command"]),
			StringPtrValue(params["line"]),
			StringPtrValue(params["executable"]),
			StringPtrValue(params["input"]),
		); c != "" {
			return c
		}
		if args := StringValue(params["args"]); args != "" {
			return args
		}
	}
	return FirstNonEmptyString(
		StringPtrValue(input["command"]),
		StringPtrValue(input["cmd"]),
		StringPtrValue(input["shell_command"]),
		StringPtrValue(input["script"]),
		StringPtrValue(input["text"]),
		StringPtrValue(input["line"]),
	)
}
