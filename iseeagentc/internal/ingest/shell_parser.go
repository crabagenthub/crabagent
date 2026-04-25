package ingest

import (
	"encoding/json"
	"strings"
)

// ShellCommandInfo represents parsed shell command information
type ShellCommandInfo struct {
	Command          string
	CommandKey       string // Normalized command without arguments
	Category         string // file, network, system, process, package, other
	ExitCode         int
	StdoutLen        int64
	StderrLen        int64
	TokenRisk        bool
	CommandNotFound  bool
	PermissionDenied bool
	FileOperations   []FileOperation
}

// FileOperation represents a file operation parsed from shell command
type FileOperation struct {
	Path       string
	AccessType string // read, write, delete
}

// ShellCommandConfig defines shell command parsing rules
type ShellCommandConfig struct {
	ReadLikeCommands   []string `toml:"readLikeCommands"`
	TokenRiskThreshold int64    `toml:"tokenRiskThreshold"`
	Categories         struct {
		File    []string `toml:"file"`
		Network []string `toml:"network"`
		System  []string `toml:"system"`
		Process []string `toml:"process"`
		Package []string `toml:"package"`
	} `toml:"categories"`
}

// DefaultShellCommandConfig returns the default shell command parsing rules
func DefaultShellCommandConfig() *ShellCommandConfig {
	return &ShellCommandConfig{
		ReadLikeCommands: []string{
			"cat", "head", "tail", "less", "grep", "rg", "find", "type", "findstr",
			"get-content", "select-string",
		},
		TokenRiskThreshold: 24000,
		Categories: struct {
			File    []string `toml:"file"`
			Network []string `toml:"network"`
			System  []string `toml:"system"`
			Process []string `toml:"process"`
			Package []string `toml:"package"`
		}{
			File: []string{
				"ls", "cat", "head", "tail", "less", "more", "find", "grep", "rg", "fd",
				"cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "stat",
				"diff", "wc", "sort", "uniq", "tee", "xargs", "sed", "awk", "readlink",
				"realpath", "tree", "dir", "type", "copy", "move", "del", "erase",
				"findstr", "where", "get-childitem", "get-content", "set-content",
				"copy-item", "move-item", "remove-item", "select-string",
				"git", "svn", "hg", "fossil",
			},
			Network: []string{
				"curl", "wget", "ping", "ssh", "scp", "rsync", "nc", "netcat", "telnet",
				"dig", "nslookup", "invoke-webrequest", "irm", "mbsync", "offlineimap",
				"mailsync", "isync",
			},
			System: []string{
				"sudo", "su", "systemctl", "service", "mount", "umount", "df", "du", "free",
				"uname", "whoami", "id", "env", "printenv", "export", "ulimit", "sysctl",
				"setx", "which", "whereis", "hash", "docker", "kubectl", "podman", "nerdctl",
				"crictl", "ctr",
			},
			Process: []string{
				"ps", "top", "htop", "kill", "killall", "pkill", "pgrep", "jobs", "fg", "bg",
				"nohup", "nice", "tasklist", "taskkill", "get-process", "stop-process",
			},
			Package: []string{
				"npm", "pnpm", "yarn", "bun", "pip", "pip3", "apt", "apt-get", "yum", "dnf",
				"brew", "cargo", "go", "choco", "winget", "make", "cmake", "ninja", "meson",
				"gradle", "mvn", "maven",
			},
		},
	}
}

// ParseShellCommand parses a shell span to extract command information
func ParseShellCommand(spanName, inputJSON, outputJSON *string, config *ShellCommandConfig) *ShellCommandInfo {
	if config == nil {
		config = DefaultShellCommandConfig()
	}

	// Extract command from input
	command := extractCommandFromInput(inputJSON)
	if command == "" {
		return nil
	}

	info := &ShellCommandInfo{
		Command:    command,
		CommandKey: normalizeCommandKey(command),
		Category:   classifyCommand(command, config),
	}

	// Parse output for exit code and lengths
	if outputJSON != nil {
		info.ExitCode = extractExitCode(outputJSON)
		info.StdoutLen = extractOutputLength(outputJSON, "stdout")
		info.StderrLen = extractOutputLength(outputJSON, "stderr")
		info.TokenRisk = checkTokenRisk(outputJSON, config)
		info.CommandNotFound = checkCommandNotFound(outputJSON)
		info.PermissionDenied = checkPermissionDenied(outputJSON)
	}

	// Parse file operations
	info.FileOperations = ParseShellCommandForFileOps(command)

	return info
}

// extractCommandFromInput extracts the command string from input JSON
func extractCommandFromInput(inputJSON *string) string {
	if inputJSON == nil {
		return ""
	}

	var input map[string]interface{}
	if err := json.Unmarshal([]byte(*inputJSON), &input); err != nil {
		return ""
	}

	// Try common parameter names
	params, ok := input["params"].(map[string]interface{})
	if !ok {
		params = input
	}

	if cmd := strFromMap(params, "command"); cmd != "" {
		return cmd
	}
	if cmd := strFromMap(params, "cmd"); cmd != "" {
		return cmd
	}
	if cmd := strFromMap(params, "shell_command"); cmd != "" {
		return cmd
	}
	if cmd := strFromMap(params, "line"); cmd != "" {
		return cmd
	}

	return ""
}

// normalizeCommandKey normalizes the command by removing arguments
func normalizeCommandKey(command string) string {
	tokens := tokenizeShellCommand(command)
	if len(tokens) == 0 {
		return ""
	}
	return normalizeCmdBin(tokens[0])
}

// classifyCommand classifies a command into a category
func classifyCommand(command string, config *ShellCommandConfig) string {
	cmdKey := normalizeCommandKey(command)
	cmdKeyLower := strings.ToLower(cmdKey)

	// Check each category
	categories := []struct {
		name     string
		commands []string
	}{
		{"file", config.Categories.File},
		{"network", config.Categories.Network},
		{"system", config.Categories.System},
		{"process", config.Categories.Process},
		{"package", config.Categories.Package},
	}

	for _, cat := range categories {
		for _, cmd := range cat.commands {
			if strings.ToLower(cmd) == cmdKeyLower {
				return cat.name
			}
		}
	}

	return "other"
}

// extractExitCode extracts the exit code from output JSON
func extractExitCode(outputJSON *string) int {
	if outputJSON == nil {
		return 0
	}

	var output map[string]interface{}
	if err := json.Unmarshal([]byte(*outputJSON), &output); err != nil {
		return 0
	}

	if result, ok := output["result"].(map[string]interface{}); ok {
		if exitCode, ok := result["exit_code"].(float64); ok {
			return int(exitCode)
		}
		if exitCode, ok := result["exitCode"].(float64); ok {
			return int(exitCode)
		}
		if exitCode, ok := result["exitcode"].(float64); ok {
			return int(exitCode)
		}
		if exitCode, ok := result["exit_status"].(float64); ok {
			return int(exitCode)
		}
	}

	return 0
}

// extractOutputLength extracts the length of stdout or stderr from output JSON
func extractOutputLength(outputJSON *string, field string) int64 {
	if outputJSON == nil {
		return 0
	}

	var output map[string]interface{}
	if err := json.Unmarshal([]byte(*outputJSON), &output); err != nil {
		return 0
	}

	if result, ok := output["result"].(map[string]interface{}); ok {
		if stdout, ok := result[field].(string); ok {
			return int64(len(stdout))
		}
	}

	return 0
}

// checkTokenRisk checks if output has token risk (large stdout)
func checkTokenRisk(outputJSON *string, config *ShellCommandConfig) bool {
	if outputJSON == nil {
		return false
	}

	stdoutLen := extractOutputLength(outputJSON, "stdout")
	threshold := config.TokenRiskThreshold
	if threshold <= 0 {
		threshold = 24000 // Default threshold
	}

	return stdoutLen > threshold
}

// checkCommandNotFound checks if command was not found
func checkCommandNotFound(outputJSON *string) bool {
	if outputJSON == nil {
		return false
	}

	var output map[string]interface{}
	if err := json.Unmarshal([]byte(*outputJSON), &output); err != nil {
		return false
	}

	if result, ok := output["result"].(map[string]interface{}); ok {
		if stdout, ok := result["stdout"].(string); ok {
			lower := strings.ToLower(stdout)
			patterns := []string{
				"command not found",
				"not found as command",
				"is not recognized as an internal or external command",
			}
			for _, pattern := range patterns {
				if strings.Contains(lower, pattern) {
					return true
				}
			}
		}
		if stderr, ok := result["stderr"].(string); ok {
			lower := strings.ToLower(stderr)
			patterns := []string{
				"command not found",
				"not found as command",
				"is not recognized as an internal or external command",
			}
			for _, pattern := range patterns {
				if strings.Contains(lower, pattern) {
					return true
				}
			}
		}
	}

	return false
}

// checkPermissionDenied checks if permission was denied
func checkPermissionDenied(outputJSON *string) bool {
	if outputJSON == nil {
		return false
	}

	var output map[string]interface{}
	if err := json.Unmarshal([]byte(*outputJSON), &output); err != nil {
		return false
	}

	if result, ok := output["result"].(map[string]interface{}); ok {
		if stdout, ok := result["stdout"].(string); ok {
			lower := strings.ToLower(stdout)
			patterns := []string{
				"permission denied",
				"access is denied",
				"operation not permitted",
				"eacces",
			}
			for _, pattern := range patterns {
				if strings.Contains(lower, pattern) {
					return true
				}
			}
		}
		if stderr, ok := result["stderr"].(string); ok {
			lower := strings.ToLower(stderr)
			patterns := []string{
				"permission denied",
				"access is denied",
				"operation not permitted",
				"eacces",
			}
			for _, pattern := range patterns {
				if strings.Contains(lower, pattern) {
					return true
				}
			}
		}
	}

	return false
}

// ParseShellCommandForFileOps parses a shell command to identify file operations
func ParseShellCommandForFileOps(command string) []FileOperation {
	tokens := tokenizeShellCommand(command)
	if len(tokens) < 2 {
		return []FileOperation{}
	}

	var ops []FileOperation
	bin := normalizeCmdBin(tokens[0])

	// File deletion commands
	if bin == "rm" || bin == "trash" {
		for i := 1; i < len(tokens); i++ {
			t := strings.TrimSpace(tokens[i])
			if t == "" || strings.HasPrefix(t, "-") {
				continue
			}
			ops = append(ops, FileOperation{
				Path:       t,
				AccessType: "delete",
			})
		}
	}

	// File copy/move commands
	if bin == "cp" || bin == "mv" {
		if len(tokens) >= 3 {
			// First non-flag operand is source
			src := firstPathOperand(tokens, 1)
			// Second non-flag operand is destination
			dst := firstPathOperand(tokens, 2)
			if src != "" {
				accessType := "write"
				if bin == "cp" {
					accessType = "read" // Source is read
				}
				ops = append(ops, FileOperation{
					Path:       src,
					AccessType: accessType,
				})
			}
			if dst != "" {
				ops = append(ops, FileOperation{
					Path:       dst,
					AccessType: "write",
				})
			}
		}
	}

	// File read commands
	if bin == "cat" || bin == "head" || bin == "tail" || bin == "less" || bin == "more" {
		for i := 1; i < len(tokens); i++ {
			t := strings.TrimSpace(tokens[i])
			if t == "" || strings.HasPrefix(t, "-") {
				continue
			}
			ops = append(ops, FileOperation{
				Path:       t,
				AccessType: "read",
			})
		}
	}

	return ops
}
