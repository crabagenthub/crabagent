package ingest

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// ResourceInfo represents classified resource access information
type ResourceInfo struct {
	Kind    string // file, memory, glob, tool_io, other
	Mode    string // read, write
	URI     string
	Chars   int64
	Snippet string
}

// ToolClassificationConfig defines tool classification rules
type ToolClassificationConfig struct {
	FileReadTools  []string `toml:"fileReadTools"`
	FileWriteTools []string `toml:"fileWriteTools"`
	MemoryTools    []string `toml:"memoryTools"`
	GlobTools      []string `toml:"globTools"`
}

// DefaultToolClassificationConfig returns the default tool classification rules
func DefaultToolClassificationConfig() *ToolClassificationConfig {
	return &ToolClassificationConfig{
		FileReadTools: []string{
			"read_file", "fs.readFile", "cat", "less", "head", "tail", "readfile",
			"read", "file_read", "load_file",
		},
		FileWriteTools: []string{
			"write_file", "fs.writeFile", "echo", "tee",
			"write", "writefile", "edit", "edit_file", "apply_patch",
		},
		MemoryTools: []string{
			"memory.read", "memory.write", "context.get",
		},
		GlobTools: []string{
			"glob", "fs.readdir", "ls", "list_dir", "listdir",
		},
	}
}

// ClassifyResourceAccess classifies a tool span to determine resource access type
func ClassifyResourceAccess(spanName string, params map[string]interface{}, config *ToolClassificationConfig) ResourceInfo {
	if config == nil {
		config = DefaultToolClassificationConfig()
	}

	nameLower := strings.ToLower(strings.TrimSpace(spanName))

	// Check file read tools
	for _, tool := range config.FileReadTools {
		if strings.Contains(nameLower, strings.ToLower(tool)) {
			return ResourceInfo{
				Kind: "file",
				Mode: "read",
				URI:  ExtractResourceURI(params),
			}
		}
	}

	// Check file write tools
	for _, tool := range config.FileWriteTools {
		if strings.Contains(nameLower, strings.ToLower(tool)) {
			return ResourceInfo{
				Kind: "file",
				Mode: "write",
				URI:  ExtractResourceURI(params),
			}
		}
	}

	// Check memory tools
	for _, tool := range config.MemoryTools {
		if strings.Contains(nameLower, strings.ToLower(tool)) {
			query := strFromMap(params, "query")
			uri := "memory://search"
			if query != "" {
				uri = "memory://search?q=" + query
			}
			return ResourceInfo{
				Kind: "memory",
				Mode: "read",
				URI:  uri,
			}
		}
	}

	// Check glob tools
	for _, tool := range config.GlobTools {
		if strings.Contains(nameLower, strings.ToLower(tool)) {
			pattern := strFromMap(params, "glob_pattern")
			if pattern == "" {
				pattern = strFromMap(params, "pattern")
			}
			if pattern == "" {
				pattern = strFromMap(params, "path")
			}
			if pattern == "" {
				pattern = "*"
			}
			return ResourceInfo{
				Kind: "glob",
				Mode: "read",
				URI:  "file://glob/" + pattern,
			}
		}
	}

	// Check for shell command file operations
	if shellRes := fileResourceFromShellCommand(params); shellRes != nil {
		return ResourceInfo{
			Kind: "file",
			Mode: shellRes.AccessMode,
			URI:  shellRes.URI,
		}
	}

	return ResourceInfo{
		Kind: "other",
		Mode: "read",
	}
}

// ExtractResourceURI extracts the resource URI from params
func ExtractResourceURI(params map[string]interface{}) string {
	// Priority: path > file_path > target_file > uri > file
	if uri := strFromMap(params, "path"); uri != "" {
		return uri
	}
	if uri := strFromMap(params, "file_path"); uri != "" {
		return uri
	}
	if uri := strFromMap(params, "filePath"); uri != "" {
		return uri
	}
	if uri := strFromMap(params, "target_file"); uri != "" {
		return uri
	}
	if uri := strFromMap(params, "targetFile"); uri != "" {
		return uri
	}
	if uri := strFromMap(params, "uri"); uri != "" {
		return uri
	}
	if uri := strFromMap(params, "file"); uri != "" {
		return uri
	}
	return ""
}

// IsValidResourceURI returns true when uri looks like a real resource identifier
// (url, filesystem path, or allowed logical resource scheme).
func IsValidResourceURI(uri string) bool {
	u := strings.TrimSpace(uri)
	if u == "" {
		return false
	}

	low := strings.ToLower(u)
	switch low {
	case "unknown", "none", "null", "nil", "n/a":
		return false
	}

	// Explicitly reject synthetic placeholders.
	if strings.HasPrefix(low, "tool://") {
		return false
	}

	// Allowed explicit schemes.
	if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
		return true
	}
	if strings.HasPrefix(low, "file://") || strings.HasPrefix(low, "memory://") {
		return true
	}

	// If there is some other scheme (x://), reject by default.
	if strings.Contains(low, "://") {
		return false
	}

	// Unix absolute / relative paths.
	if strings.HasPrefix(u, "/") || strings.HasPrefix(u, "./") || strings.HasPrefix(u, "../") || strings.HasPrefix(u, "~/") {
		return true
	}

	// Windows absolute path: C:\... or C:/...
	if len(u) >= 3 && isASCIIAlpha(u[0]) && u[1] == ':' && (u[2] == '\\' || u[2] == '/') {
		return true
	}

	// Common relative path forms like "dir/file.txt" or "dir\\file.txt".
	if strings.Contains(u, "/") || strings.Contains(u, "\\") {
		return true
	}

	return false
}

// CalculateChars calculates the character count from tool output
// It supports UTF-8 normalization to match the behavior of the Plugin
func CalculateChars(output interface{}) int64 {
	if output == nil {
		return 0
	}

	// Try to extract primary text from output
	text := extractPrimaryTextFromToolResult(output)
	if text == "" {
		return 0
	}

	// UTF-8 encode-decode normalize for consistent character count
	normalized := utf8Normalize(text)
	return int64(utf8.RuneCountInString(normalized))
}

// extractPrimaryTextFromToolResult extracts the main text from tool result
func extractPrimaryTextFromToolResult(result interface{}) string {
	if result == nil {
		return ""
	}

	// If it's already a string
	if s, ok := result.(string); ok {
		return s
	}

	// If it's a map/object
	if m, ok := result.(map[string]interface{}); ok {
		// Check for content array
		if content, ok := m["content"].([]interface{}); ok {
			var parts []string
			for _, block := range content {
				if blockMap, ok := block.(map[string]interface{}); ok {
					if blockType, ok := blockMap["type"].(string); ok && blockType == "text" {
						if text, ok := blockMap["text"].(string); ok {
							parts = append(parts, text)
						} else if text, ok := blockMap["content"].(string); ok {
							parts = append(parts, text)
						}
					}
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, "\n")
			}
		}

		// Check common fields
		if text := strFromMap(m, "message"); text != "" {
			return text
		}
		if text := strFromMap(m, "detail"); text != "" {
			return text
		}
		if text := strFromMap(m, "summary"); text != "" {
			return text
		}
		if text := strFromMap(m, "text"); text != "" {
			return text
		}
		if text := strFromMap(m, "output"); text != "" {
			return text
		}
		if text := strFromMap(m, "body"); text != "" {
			return text
		}
		if text := strFromMap(m, "data"); text != "" {
			return text
		}

		// Fallback to JSON string
		if bytes, err := json.Marshal(m); err == nil {
			return string(bytes)
		}
	}

	return ""
}

// utf8Normalize normalizes a string through UTF-8 encode-decode
// This matches the Plugin's behavior for consistent character counting
func utf8Normalize(s string) string {
	// In Go, strings are already UTF-8, so we just normalize by trimming
	return strings.TrimSpace(s)
}

// TruncateSnippet truncates text to a maximum length for snippet
func TruncateSnippet(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	return text[:maxLen-1] + "…"
}

// fileResourceFromShellCommand extracts file resource info from shell command params
type ShellFileResource struct {
	URI        string
	AccessMode string
}

func fileResourceFromShellCommand(params map[string]interface{}) *ShellFileResource {
	command := shellCommandFromParams(params)
	if command == "" {
		return nil
	}

	tokens := tokenizeShellCommand(command)
	if len(tokens) < 2 {
		return nil
	}

	bin := normalizeCmdBin(tokens[0])
	if bin != "trash" && bin != "rm" && bin != "mv" && bin != "cp" {
		return nil
	}

	uri := firstPathOperand(tokens)
	if uri == "" {
		return nil
	}

	return &ShellFileResource{
		URI:        uri,
		AccessMode: "write",
	}
}

func shellCommandFromParams(params map[string]interface{}) string {
	if cmd := strFromMap(params, "command"); cmd != "" {
		return cmd
	}
	if cmd := strFromMap(params, "cmd"); cmd != "" {
		return cmd
	}
	if cmd := strFromMap(params, "shell_command"); cmd != "" {
		return cmd
	}
	return ""
}

func tokenizeShellCommand(command string) []string {
	s := strings.TrimSpace(command)
	if s == "" {
		return []string{}
	}

	var out []string
	var cur strings.Builder
	var quote rune
	var esc bool

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
		if isWhitespace(ch) {
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

func normalizeCmdBin(tok string) string {
	t := strings.ToLower(tok)
	if strings.Contains(t, "/") {
		parts := strings.Split(t, "/")
		if len(parts) > 0 {
			t = parts[len(parts)-1]
		}
	}
	return t
}

func firstPathOperand(tokens []string, from ...int) string {
	start := 1
	if len(from) > 0 {
		start = from[0]
	}

	for i := start; i < len(tokens); i++ {
		t := strings.TrimSpace(tokens[i])
		if t == "" || strings.HasPrefix(t, "-") {
			continue
		}
		return t
	}
	return ""
}

func isWhitespace(ch rune) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'
}

func isASCIIAlpha(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}
