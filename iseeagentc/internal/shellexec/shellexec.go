// Package shellexec parses shell/tool spans and computes shell summary metrics.
package shellexec

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"iseeagentc/conf"
	"iseeagentc/internal/calendardays"
	textparser "iseeagentc/internal/parser"

	toml "github.com/pelletier/go-toml/v2"
)

func isFiniteFloat(x float64) bool {
	return !math.IsNaN(x) && !math.IsInf(x, 0)
}

const tokenRiskStdoutCharsDefault = 24_000
const tokenApproxDivisor = 4
const usdPerMtok = 0.5

// SpanRow is a scanned agent_spans row for shell analytics.
type SpanRow struct {
	SpanID             string
	TraceID            string
	ParentSpanID       sql.NullString
	Name               sql.NullString
	SpanType           sql.NullString
	StartTimeMs        sql.NullInt64
	EndTimeMs          sql.NullInt64
	DurationMs         sql.NullInt64
	InputJSON          sql.NullString
	OutputJSON         sql.NullString
	ErrorInfoJSON      sql.NullString
	MetadataJSON       sql.NullString
	ThreadMetadataJSON sql.NullString
	ThreadKey          sql.NullString
	AgentName          sql.NullString
	ChannelName        sql.NullString
	// Preparsed 非空时跳过 JSON 解析，直接使用 agent_exec_commands 等入库字段（与 ComputeShellSummaryFromRows 搭配）。
	Preparsed *ParsedShellSpan
}

// --- Config (resource-audit-config.ts shellExec subtree) ---

// ShellCommandCategory mirrors TS.
type ShellCommandCategory string

const (
	CategoryFile    ShellCommandCategory = "file"
	CategoryNetwork ShellCommandCategory = "network"
	CategorySystem  ShellCommandCategory = "system"
	CategoryProcess ShellCommandCategory = "process"
	CategoryPackage ShellCommandCategory = "package"
	CategoryOther   ShellCommandCategory = "other"
)

// ResourceAuditConfig holds only fields needed by shell parsing (standalone package).
type ResourceAuditConfig struct {
	ShellExec ShellExecConfig `json:"shellExec"`
}

type ShellExecConfig struct {
	LoopAlerts struct {
		MinRepeatCount int `json:"minRepeatCount"`
		MaxItems       int `json:"maxItems"`
	} `json:"loopAlerts"`
	TokenRisks struct {
		StdoutCharsThreshold int `json:"stdoutCharsThreshold"`
		MaxItems             int `json:"maxItems"`
	} `json:"tokenRisks"`
	CommandSemantics ShellCommandSemantics `json:"commandSemantics"`
}

type ShellCommandSemantics struct {
	Enabled         bool   `json:"enabled"`
	DefaultPlatform string `json:"defaultPlatform"`
	PlatformDetect  struct {
		PreferSpanNameHints bool `json:"preferSpanNameHints"`
		SpanNameHints       struct {
			Unix       []string `json:"unix"`
			WindowsCmd []string `json:"windows_cmd"`
			Powershell []string `json:"powershell"`
		} `json:"spanNameHints"`
	} `json:"platformDetect"`
	Aliases     map[string]string  `json:"aliases"`
	Categories  CommandCategories  `json:"categories"`
	ReadLike    []string           `json:"readLikeCommands"`
	Diagnostics DiagnosticPatterns `json:"diagnosticPatterns"`
}

type CommandCategories struct {
	File    []string `json:"file"`
	Network []string `json:"network"`
	System  []string `json:"system"`
	Process []string `json:"process"`
	Package []string `json:"package"`
}

type DiagnosticPatterns struct {
	CommandNotFound  []string `json:"commandNotFound"`
	PermissionDenied []string `json:"permissionDenied"`
	IllegalArgHint   []string `json:"illegalArgHint"`
}

// DefaultResourceAuditConfig returns the TS DEFAULT_CONFIG shellExec subtree.
func DefaultResourceAuditConfig() ResourceAuditConfig {
	var c ResourceAuditConfig
	c.ShellExec.LoopAlerts.MinRepeatCount = 3
	c.ShellExec.LoopAlerts.MaxItems = 20
	c.ShellExec.TokenRisks.StdoutCharsThreshold = 24_000
	c.ShellExec.TokenRisks.MaxItems = 15
	cs := &c.ShellExec.CommandSemantics
	cs.Enabled = true
	cs.DefaultPlatform = "unix"
	cs.PlatformDetect.PreferSpanNameHints = true
	cs.PlatformDetect.SpanNameHints.Unix = []string{"bash", "zsh", "sh", "terminal", "shell"}
	cs.PlatformDetect.SpanNameHints.WindowsCmd = []string{"cmd", "cmd.exe", "run_cmd", "runcmd"}
	cs.PlatformDetect.SpanNameHints.Powershell = []string{"pwsh", "powershell"}
	cs.Aliases = map[string]string{
		"ls": "get-childitem", "dir": "get-childitem", "gci": "get-childitem",
		"cat": "get-content", "type": "get-content", "gc": "get-content",
		"rm": "remove-item", "del": "remove-item", "erase": "remove-item",
		"cp": "copy-item", "copy": "copy-item", "mv": "move-item", "move": "move-item",
	}
	cs.Categories.File = []string{
		"ls", "cat", "head", "tail", "less", "more", "find", "grep", "rg", "fd", "cp", "mv", "rm", "mkdir", "rmdir",
		"touch", "chmod", "chown", "stat", "diff", "wc", "sort", "uniq", "tee", "xargs", "sed", "awk", "readlink",
		"realpath", "tree", "dir", "type", "copy", "move", "del", "erase", "findstr", "where",
		"get-childitem", "get-content", "set-content", "copy-item", "move-item", "remove-item", "select-string",
		"git", "svn", "hg", "fossil",
	}
	cs.Categories.Network = []string{
		"curl", "wget", "ping", "ssh", "scp", "rsync", "nc", "netcat", "telnet", "dig", "nslookup", "invoke-webrequest", "irm",
		"mbsync", "offlineimap", "mailsync", "isync",
	}
	cs.Categories.System = []string{
		"sudo", "su", "systemctl", "service", "mount", "umount", "df", "du", "free", "uname", "whoami", "id", "env", "printenv", "export", "ulimit", "sysctl", "setx",
		"which", "whereis", "hash", "docker", "kubectl", "podman", "nerdctl", "crictl", "ctr",
	}
	cs.Categories.Process = []string{"ps", "top", "htop", "kill", "killall", "pkill", "pgrep", "jobs", "fg", "bg", "nohup", "nice", "tasklist", "taskkill", "get-process", "stop-process"}
	cs.Categories.Package = []string{
		"npm", "pnpm", "yarn", "bun", "pip", "pip3", "apt", "apt-get", "yum", "dnf", "brew", "cargo", "go", "choco", "winget",
		"make", "cmake", "ninja", "meson", "gradle", "mvn", "maven",
	}
	cs.ReadLike = []string{"cat", "head", "tail", "less", "grep", "rg", "find", "type", "findstr", "get-content", "select-string"}
	cs.Diagnostics.CommandNotFound = []string{"command not found", "not found as command", "is not recognized as an internal or external command"}
	cs.Diagnostics.PermissionDenied = []string{"permission denied", "access is denied", "operation not permitted", "eacces"}
	cs.Diagnostics.IllegalArgHint = []string{"illegal option", "invalid option", "unrecognized option", "syntax error", "usage:", "parameter cannot be found"}
	return c
}

func mergeShellExecFromPatch(base ResourceAuditConfig, p ShellExecConfig) ResourceAuditConfig {
	out := base
	se := &out.ShellExec
	if p.LoopAlerts.MinRepeatCount >= 1 {
		se.LoopAlerts.MinRepeatCount = p.LoopAlerts.MinRepeatCount
	}
	if p.LoopAlerts.MaxItems >= 1 {
		se.LoopAlerts.MaxItems = p.LoopAlerts.MaxItems
	}
	if p.TokenRisks.MaxItems >= 1 {
		se.TokenRisks.MaxItems = p.TokenRisks.MaxItems
	}
	if p.TokenRisks.StdoutCharsThreshold > 0 {
		se.TokenRisks.StdoutCharsThreshold = p.TokenRisks.StdoutCharsThreshold
	}
	cs := p.CommandSemantics
	if len(cs.Aliases) > 0 || len(cs.Categories.File) > 0 || len(cs.ReadLike) > 0 ||
		len(cs.Diagnostics.CommandNotFound) > 0 || cs.DefaultPlatform != "" {
		se.CommandSemantics = cs
		if len(se.CommandSemantics.Aliases) == 0 {
			se.CommandSemantics.Aliases = cloneStringMap(base.ShellExec.CommandSemantics.Aliases)
		}
		if len(se.CommandSemantics.Categories.File) == 0 {
			se.CommandSemantics.Categories = base.ShellExec.CommandSemantics.Categories
		}
		if len(se.CommandSemantics.ReadLike) == 0 {
			se.CommandSemantics.ReadLike = append([]string{}, base.ShellExec.CommandSemantics.ReadLike...)
		}
		if len(se.CommandSemantics.Diagnostics.CommandNotFound) == 0 {
			se.CommandSemantics.Diagnostics = base.ShellExec.CommandSemantics.Diagnostics
		}
		dp := se.CommandSemantics.DefaultPlatform
		if dp != "windows_cmd" && dp != "powershell" {
			if dp == "" {
				se.CommandSemantics.DefaultPlatform = base.ShellExec.CommandSemantics.DefaultPlatform
			} else {
				se.CommandSemantics.DefaultPlatform = "unix"
			}
		}
		if len(se.CommandSemantics.PlatformDetect.SpanNameHints.Unix) == 0 &&
			len(se.CommandSemantics.PlatformDetect.SpanNameHints.WindowsCmd) == 0 &&
			len(se.CommandSemantics.PlatformDetect.SpanNameHints.Powershell) == 0 {
			se.CommandSemantics.PlatformDetect = base.ShellExec.CommandSemantics.PlatformDetect
		}
	}
	return out
}

func cloneStringMap(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[strings.ToLower(strings.TrimSpace(k))] = strings.ToLower(strings.TrimSpace(v))
	}
	return out
}

// LoadResourceAuditConfig only uses embedded conf/resourceaudit.toml.
func LoadResourceAuditConfig() ResourceAuditConfig {
	base := DefaultResourceAuditConfig()
	var anyMap map[string]any
	if err := toml.Unmarshal(conf.DefaultResourceAuditConfigTOML(), &anyMap); err != nil {
		return base
	}
	b, err := json.Marshal(anyMap)
	if err != nil {
		return base
	}
	var top map[string]json.RawMessage
	if json.Unmarshal(b, &top) != nil {
		return base
	}
	raw, ok := top["shellExec"]
	if !ok {
		return base
	}
	var patch ShellExecConfig
	if json.Unmarshal(raw, &patch) != nil {
		return base
	}
	return mergeShellExecFromPatch(base, patch)
}

// --- Parsing (shell-exec-analytics.ts) ---

type ShellCommandAstNode struct {
	Kind     string                `json:"kind"`
	Raw      string                `json:"raw"`
	Argv     []string              `json:"argv"`
	Children []ShellCommandAstNode `json:"children,omitempty"`
}

type ShellCommandAst struct {
	Shell string                `json:"shell"`
	Nodes []ShellCommandAstNode `json:"nodes"`
}

type ParsedShellSpan struct {
	Command          string               `json:"command"`
	CommandKey       string               `json:"commandKey"`
	Category         ShellCommandCategory `json:"category"`
	ExitCode         *int                 `json:"exitCode"`
	Success          *bool                `json:"success"`
	StdoutLen        int                  `json:"stdoutLen"`
	StderrLen        int                  `json:"stderrLen"`
	StdoutPreview    *string              `json:"stdoutPreview"`
	StderrPreview    *string              `json:"stderrPreview"`
	EstTokens        int                  `json:"estTokens"`
	EstUsd           float64              `json:"estUsd"`
	TokenRisk        bool                 `json:"tokenRisk"`
	CommandNotFound  bool                 `json:"commandNotFound"`
	PermissionDenied bool                 `json:"permissionDenied"`
	IllegalArgHint   bool                 `json:"illegalArgHint"`
	Cwd              *string              `json:"cwd"`
	EnvKeys          []string             `json:"envKeys"`
	UserID           *string              `json:"userId"`
	Host             *string              `json:"host"`
	Platform         string               `json:"platform"`
	CommandAst       ShellCommandAst      `json:"commandAst"`
}

type ParsedShellSpanLite struct {
	Command          string               `json:"command"`
	Category         ShellCommandCategory `json:"category"`
	ExitCode         *int                 `json:"exitCode"`
	Success          *bool                `json:"success"`
	StdoutLen        int                  `json:"stdoutLen"`
	StderrLen        int                  `json:"stderrLen"`
	EstTokens        int                  `json:"estTokens"`
	EstUsd           float64              `json:"estUsd"`
	TokenRisk        bool                 `json:"tokenRisk"`
	CommandNotFound  bool                 `json:"commandNotFound"`
	PermissionDenied bool                 `json:"permissionDenied"`
	Cwd              *string              `json:"cwd"`
	UserID           *string              `json:"userId"`
	Host             *string              `json:"host"`
	Platform         string               `json:"platform"`
}

func ToParsedShellSpanLite(p ParsedShellSpan) ParsedShellSpanLite {
	cmd := p.Command
	if len(cmd) > 2000 {
		cmd = cmd[:2000]
	}
	return ParsedShellSpanLite{
		Command:          cmd,
		Category:         p.Category,
		ExitCode:         p.ExitCode,
		Success:          p.Success,
		StdoutLen:        p.StdoutLen,
		StderrLen:        p.StderrLen,
		EstTokens:        p.EstTokens,
		EstUsd:           math.Round(p.EstUsd*10000) / 10000,
		TokenRisk:        p.TokenRisk,
		CommandNotFound:  p.CommandNotFound,
		PermissionDenied: p.PermissionDenied,
		Cwd:              p.Cwd,
		UserID:           p.UserID,
		Host:             p.Host,
		Platform:         p.Platform,
	}
}

func NormalizeCommandKeyForLoop(cmd string) string {
	t := strings.TrimSpace(strings.Join(strings.Fields(cmd), " "))
	if len(t) > 400 {
		t = t[:400]
	}
	return strings.ToLower(t)
}

func extractCommandFromInput(input map[string]any) string {
	return textparser.ExtractCommandFromInput(input)
}

var wsSplit = regexp.MustCompile(`[\s;&|]+`)

func firstToken(cmd string) string {
	parts := wsSplit.Split(strings.TrimSpace(cmd), -1)
	var t string
	for _, p := range parts {
		if p != "" {
			t = p
			break
		}
	}
	t = strings.Trim(t, `'"`)
	if idx := strings.LastIndex(t, "/"); idx >= 0 {
		t = t[idx+1:]
	}
	t = strings.TrimPrefix(t, "./")
	return strings.ToLower(t)
}

func normalizeToken(tok string, cfg ResourceAuditConfig) string {
	key := strings.ToLower(strings.TrimSpace(tok))
	if v, ok := cfg.ShellExec.CommandSemantics.Aliases[key]; ok {
		return v
	}
	return key
}

func detectPlatform(command string, metadataJSON *string, cfg ResourceAuditConfig) string {
	meta := textparser.ParseJSONObjectPtr(metadataJSON)
	spanName := strings.ToLower(fmt.Sprint(meta["name"]))
	h := cfg.ShellExec.CommandSemantics.PlatformDetect.SpanNameHints
	if cfg.ShellExec.CommandSemantics.PlatformDetect.PreferSpanNameHints {
		for _, x := range h.Powershell {
			if strings.Contains(spanName, strings.ToLower(x)) {
				return "powershell"
			}
		}
		for _, x := range h.WindowsCmd {
			if strings.Contains(spanName, strings.ToLower(x)) {
				return "windows_cmd"
			}
		}
		for _, x := range h.Unix {
			if strings.Contains(spanName, strings.ToLower(x)) {
				return "unix"
			}
		}
	}
	t := firstToken(command)
	for _, x := range []string{"powershell", "pwsh", "get-childitem", "get-content", "remove-item"} {
		if t == x {
			return "powershell"
		}
	}
	for _, x := range []string{"cmd", "cmd.exe", "dir", "type", "del", "copy", "move", "findstr"} {
		if t == x {
			return "windows_cmd"
		}
	}
	dp := cfg.ShellExec.CommandSemantics.DefaultPlatform
	if dp == "windows_cmd" || dp == "powershell" {
		return dp
	}
	return "unix"
}

func containsStr(slice []string, v string) bool {
	for _, s := range slice {
		if s == v {
			return true
		}
	}
	return false
}

func tokenizeBySpace(input string) []string {
	return textparser.TokenizeShellCommand(input)
}

func splitBySep(src string, sep *regexp.Regexp) []string {
	parts := sep.Split(src, -1)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

var reSeq = regexp.MustCompile(`(?:&&|\|\||;)`)
var rePipe = regexp.MustCompile(`\|`)

func parseCommandAst(command string, platform string) ShellCommandAst {
	trim := strings.TrimSpace(command)
	if trim == "" {
		return ShellCommandAst{Shell: platform, Nodes: nil}
	}
	seq := splitBySep(trim, reSeq)
	nodes := make([]ShellCommandAstNode, 0, len(seq))
	for _, raw := range seq {
		pipes := splitBySep(raw, rePipe)
		if len(pipes) <= 1 {
			nodes = append(nodes, ShellCommandAstNode{
				Kind: "command", Raw: raw, Argv: tokenizeBySpace(raw),
			})
			continue
		}
		children := make([]ShellCommandAstNode, 0, len(pipes))
		for _, p := range pipes {
			children = append(children, ShellCommandAstNode{
				Kind: "command", Raw: p, Argv: tokenizeBySpace(p),
			})
		}
		nodes = append(nodes, ShellCommandAstNode{
			Kind: "pipe", Raw: raw, Argv: []string{}, Children: children,
		})
	}
	return ShellCommandAst{Shell: platform, Nodes: nodes}
}

var exitCodeRe = regexp.MustCompile(`(?i)\bexit(?:\s*code)?[:\s]+(-?\d+)`)

func digExitCode(v any, depth int) *int {
	if depth > 8 || v == nil {
		return nil
	}
	switch x := v.(type) {
	case float64:
		if isFiniteFloat(x) {
			n := int(math.Trunc(x))
			return &n
		}
	case bool:
		if x {
			z := 0
			return &z
		}
		o := 1
		return &o
	case string:
		if m := exitCodeRe.FindStringSubmatch(x); len(m) > 1 {
			if n, err := strconv.Atoi(m[1]); err == nil {
				return &n
			}
		}
		return nil
	case map[string]any:
		for _, k := range []string{"exit_code", "exitCode", "code", "status", "returncode", "returnCode"} {
			if val, ok := x[k]; ok {
				if n, ok := val.(float64); ok && isFiniteFloat(n) {
					ni := int(math.Trunc(n))
					return &ni
				}
			}
		}
		for _, k := range []string{"result", "output", "data", "value", "payload"} {
			if val, ok := x[k]; ok {
				if n := digExitCode(val, depth+1); n != nil {
					return n
				}
			}
		}
	case []any:
		for _, it := range x {
			if n := digExitCode(it, depth+1); n != nil {
				return n
			}
		}
	}
	return nil
}

func collectTextLengths(v any, depth int) (out string, errText string) {
	if depth > 10 {
		return "", ""
	}
	if s, ok := v.(string); ok {
		return s, ""
	}
	if v == nil {
		return "", ""
	}
	if arr, ok := v.([]any); ok {
		for _, it := range arr {
			o, e := collectTextLengths(it, depth+1)
			out += o
			errText += e
		}
		return out, errText
	}
	m, ok := v.(map[string]any)
	if !ok {
		return "", ""
	}
	var so, se string
	if x, ok := m["stdout"].(string); ok {
		so = x
	} else if x, ok := m["stdOut"].(string); ok {
		so = x
	} else if x, ok := m["STDOUT"].(string); ok {
		so = x
	}
	if x, ok := m["stderr"].(string); ok {
		se = x
	} else if x, ok := m["stdErr"].(string); ok {
		se = x
	} else if x, ok := m["STDERR"].(string); ok {
		se = x
	}
	out += so
	errText += se
	contentKeys := []string{"content", "text", "output", "message"}
	var content string
	for _, k := range contentKeys {
		if c, ok := m[k].(string); ok && so == "" {
			content = c
			break
		}
	}
	if content != "" {
		out += content
	}
	// OpenClaw / Agent SDK：大块正文常在 `content: [{ type, text }]`，此前仅处理字符串型 content，数组会漏计 → token_risk 永远为 false。
	if so == "" && content == "" {
		if arr, ok := m["content"].([]any); ok {
			for _, it := range arr {
				o, e := collectTextLengths(it, depth+1)
				out += o
				errText += e
			}
		}
	}
	for _, k := range []string{"result", "data", "value", "body"} {
		if m[k] != nil {
			o, e := collectTextLengths(m[k], depth+1)
			out += o
			errText += e
		}
	}
	return out, errText
}

func errorText(errJSON *string) string {
	if errJSON == nil || strings.TrimSpace(*errJSON) == "" {
		return ""
	}
	o := textparser.ParseJSONObjectPtr(errJSON)
	if msg, ok := o["message"].(string); ok {
		return msg
	}
	if msg, ok := o["error"].(string); ok {
		return msg
	}
	if msg, ok := o["detail"].(string); ok {
		return msg
	}
	return *errJSON
}

func threadMetaUserHost(metadataJSON *string) (userID, host *string) {
	m := textparser.ParseJSONObjectPtr(metadataJSON)
	userID = textparser.StringPtrValue(m["user_id"])
	if userID == nil {
		userID = textparser.StringPtrValue(m["userId"])
	}
	if userID == nil {
		userID = textparser.StringPtrValue(m["dingtalk_user_id"])
	}
	if oc, ok := m["openclaw_context"].(map[string]any); ok {
		if userID == nil {
			userID = textparser.StringPtrValue(oc["userId"])
		}
	}
	host = textparser.StringPtrValue(m["host"])
	if host == nil {
		host = textparser.StringPtrValue(m["hostname"])
	}
	if host == nil {
		host = textparser.StringPtrValue(m["machine"])
	}
	if oc, ok := m["openclaw_context"].(map[string]any); ok {
		if host == nil {
			host = textparser.StringPtrValue(oc["host"])
		}
	}
	return userID, host
}

func extractCwdEnv(params map[string]any) (cwd *string, envKeys []string) {
	cwd = textparser.StringPtrValue(params["cwd"])
	if cwd == nil {
		cwd = textparser.StringPtrValue(params["working_directory"])
	}
	if cwd == nil {
		cwd = textparser.StringPtrValue(params["workingDirectory"])
	}
	if cwd == nil {
		cwd = textparser.StringPtrValue(params["pwd"])
	}
	var env any
	if e, ok := params["env"]; ok {
		env = e
	} else if e, ok := params["environment"]; ok {
		env = e
	}
	if em, ok := env.(map[string]any); ok {
		keys := make([]string, 0, len(em))
		for k := range em {
			keys = append(keys, k)
			if len(keys) >= 40 {
				break
			}
		}
		envKeys = keys
	}
	return cwd, envKeys
}

// ParseShellSpanRow mirrors parseShellSpanRow.
func ParseShellSpanRow(inputJSON, outputJSON, errorInfoJSON, metadataJSON, threadMetadataJSON *string, cfg ResourceAuditConfig, tokenRiskStdoutChars *int) ParsedShellSpan {
	input := textparser.ParseJSONObjectPtr(inputJSON)
	outputRoot := textparser.ParseJSONObjectPtr(outputJSON)
	innerResult := any(outputRoot)
	if v, has := outputRoot["result"]; has && v != nil {
		innerResult = v
	}
	errStr := errorText(errorInfoJSON)
	meta := textparser.ParseJSONObjectPtr(metadataJSON)
	var params map[string]any
	if p, ok := input["params"].(map[string]any); ok {
		params = p
	} else {
		params = input
	}
	command := extractCommandFromInput(input)
	ck := strings.TrimSpace(strings.Join(strings.Fields(command), " "))
	if len(ck) > 512 {
		ck = ck[:512]
	}
	platform := detectPlatform(command, metadataJSON, cfg)
	category := classifyCommandCategory(command, cfg, platform)
	commandAst := parseCommandAst(command, platform)
	cwd, envKeys := extractCwdEnv(params)
	exitCode := digExitCode(innerResult, 0)
	stdoutText, stderrText := collectTextLengths(innerResult, 0)
	stdoutLen := len(stdoutText)
	stderrLen := len(stderrText)
	if errStr != "" {
		stderrLen += len(errStr)
	}
	combined := errStr + "\n" + stdoutText + "\n" + stderrText
	commandNotFound := matchAnyPattern(cfg.ShellExec.CommandSemantics.Diagnostics.CommandNotFound, combined)
	permissionDenied := matchAnyPattern(cfg.ShellExec.CommandSemantics.Diagnostics.PermissionDenied, combined)
	illegalArgHint := matchAnyPattern(cfg.ShellExec.CommandSemantics.Diagnostics.IllegalArgHint, combined)
	hasSpanError := strings.TrimSpace(errStr) != ""
	var success *bool
	if exitCode != nil {
		s := *exitCode == 0 && !hasSpanError
		success = &s
	} else if hasSpanError {
		f := false
		success = &f
	} else {
		t := true
		success = &t
	}
	estTokens := int(math.Ceil(float64(stdoutLen+stderrLen) / float64(tokenApproxDivisor)))
	estUsd := (float64(estTokens) / 1_000_000) * usdPerMtok
	thr := tokenRiskStdoutCharsDefault
	if tokenRiskStdoutChars != nil && *tokenRiskStdoutChars >= 0 {
		thr = *tokenRiskStdoutChars
	}
	tokenRisk := stdoutLen >= thr
	userID, host := threadMetaUserHost(threadMetadataJSON)
	preview := func(s string, n int) *string {
		if s == "" {
			return nil
		}
		if len(s) <= n {
			return &s
		}
		x := s[:n] + "…"
		return &x
	}
	var stdoutPreview, stderrPreview *string
	if stdoutLen > 0 {
		stdoutPreview = preview(stdoutText, 8000)
	}
	if stderrLen > 0 {
		comb := stderrText
		if comb == "" {
			comb = errStr
		}
		stderrPreview = preview(comb, 4000)
	}
	_ = meta // metadata name used in detectPlatform via metadataJSON
	return ParsedShellSpan{
		Command:          command,
		CommandKey:       ck,
		Category:         category,
		ExitCode:         exitCode,
		Success:          success,
		StdoutLen:        stdoutLen,
		StderrLen:        stderrLen,
		StdoutPreview:    stdoutPreview,
		StderrPreview:    stderrPreview,
		EstTokens:        estTokens,
		EstUsd:           estUsd,
		TokenRisk:        tokenRisk,
		CommandNotFound:  commandNotFound,
		PermissionDenied: permissionDenied,
		IllegalArgHint:   illegalArgHint,
		Cwd:              cwd,
		EnvKeys:          envKeys,
		UserID:           userID,
		Host:             host,
		Platform:         platform,
		CommandAst:       commandAst,
	}
}

func matchAnyPattern(patterns []string, text string) bool {
	for _, pat := range patterns {
		pat = strings.TrimSpace(pat)
		if pat == "" {
			continue
		}
		re, err := regexp.Compile("(?i)" + regexp.QuoteMeta(pat))
		if err != nil {
			continue
		}
		if re.MatchString(text) {
			return true
		}
	}
	return false
}

// RecordToParseInputs returns JSON pointers for parsing.
func RecordToParseInputs(r SpanRow) (in, out, errj, meta, thmeta *string) {
	if r.InputJSON.Valid {
		in = &r.InputJSON.String
	}
	if r.OutputJSON.Valid {
		out = &r.OutputJSON.String
	}
	if r.ErrorInfoJSON.Valid {
		errj = &r.ErrorInfoJSON.String
	}
	if r.MetadataJSON.Valid {
		meta = &r.MetadataJSON.String
	}
	if r.ThreadMetadataJSON.Valid {
		thmeta = &r.ThreadMetadataJSON.String
	}
	return
}

// ParseShellSpanFromRow parses one stored span row.
func ParseShellSpanFromRow(row SpanRow, cfg ResourceAuditConfig, tokenRiskStdoutChars *int) ParsedShellSpan {
	in, out, ej, meta, th := RecordToParseInputs(row)
	return ParseShellSpanRow(in, out, ej, meta, th, cfg, tokenRiskStdoutChars)
}

// MetricBucket 用于前端柱状图（死循环强度、Token 风险体量分桶等）。
type MetricBucket struct {
	Label string `json:"label"`
	Value int    `json:"value"`
}

type ShellSummaryJSON struct {
	Scanned                 int                          `json:"scanned"`
	Capped                  bool                         `json:"capped"`
	Totals                  ShellSummaryTotals           `json:"totals"`
	CategoryBreakdown       map[ShellCommandCategory]int `json:"category_breakdown"`
	SuccessTrend            []TrendDay                   `json:"success_trend"`
	DailyRiskSeries         []DailyRiskDay               `json:"daily_risk_series,omitempty"`
	DailyLoopAlerts         []DateCount                  `json:"daily_loop_alerts,omitempty"`
	DailyRedundantReadHints []DateCount                  `json:"daily_redundant_read_hints,omitempty"`
	DailyTokenRiskAlerts    []DateCount                  `json:"daily_token_risk_alerts,omitempty"`
	TopCommands             []CommandCount               `json:"top_commands"`
	Slowest                 []SlowestEntry               `json:"slowest"`
	LoopAlerts              []LoopAlert                  `json:"loop_alerts"`
	TokenRisks              []TokenRiskEntry             `json:"token_risks"`
	Diagnostics             ShellDiagnostics             `json:"diagnostics"`
	ChainPreview            *ChainPreview                `json:"chain_preview"`
	RedundantReadHints      []RedundantReadHint          `json:"redundant_read_hints"`
	// LoopRepeatBuckets：按「重复次数」分桶的告警条数（同一 trace 内同命令重复 ≥minRepeat）。
	LoopRepeatBuckets []MetricBucket `json:"loop_repeat_buckets,omitempty"`
	// TokenRiskStdoutBuckets：Token 风险行按 stdout 字符体量的分桶（便于条形图）。
	TokenRiskStdoutBuckets []MetricBucket `json:"token_risk_stdout_buckets,omitempty"`
	// RedundantReadTop：重复读取类命令 TopN（repeats 降序），与 redundant_read_hints 一致维度，专供图表。
	RedundantReadTop []RedundantReadHint `json:"redundant_read_top,omitempty"`
}

type ShellSummaryTotals struct {
	Commands       int `json:"commands"`
	DistinctTraces int `json:"distinct_traces"`
	Success        int `json:"success"`
	Failed         int `json:"failed"`
	Unknown        int `json:"unknown"`
	TokenRiskTotal int `json:"token_risk_total"`
}

type TrendDay struct {
	Day    string `json:"day"`
	Total  int    `json:"total"`
	Failed int    `json:"failed"`
}

// DailyRiskDay is per-day counts for volume vs risk-oriented charts (UTC day).
type DailyRiskDay struct {
	Day                string `json:"day"`
	Commands           int    `json:"commands"`
	Failed             int    `json:"failed"`
	TokenRiskCount     int    `json:"token_risk_count"`
	DiagnosticCount    int    `json:"diagnostic_count"`
	NetworkSystemCount int    `json:"network_system_count"`
}

type DateCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type CommandCount struct {
	Command string `json:"command"`
	Count   int    `json:"count"`
}

type SlowestEntry struct {
	SpanID     string `json:"span_id"`
	TraceID    string `json:"trace_id"`
	Command    string `json:"command"`
	DurationMs *int64 `json:"duration_ms"`
}

type LoopAlert struct {
	TraceID     string  `json:"trace_id"`
	ThreadKey   *string `json:"thread_key"`
	Command     string  `json:"command"`
	RepeatCount int     `json:"repeat_count"`
}

type TokenRiskEntry struct {
	SpanID      string  `json:"span_id"`
	TraceID     string  `json:"trace_id"`
	Command     string  `json:"command"`
	StdoutChars int     `json:"stdout_chars"`
	EstTokens   int     `json:"est_tokens"`
	EstUsd      float64 `json:"est_usd"`
}

type ShellDiagnostics struct {
	CommandNotFound  int `json:"command_not_found"`
	PermissionDenied int `json:"permission_denied"`
	IllegalArgHint   int `json:"illegal_arg_hint"`
}

type ChainPreview struct {
	TraceID string      `json:"trace_id"`
	Steps   []ChainStep `json:"steps"`
}

type ChainStep struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type RedundantReadHint struct {
	TraceID string `json:"trace_id"`
	Command string `json:"command"`
	Repeats int    `json:"repeats"`
}

func dayKey(ms int64) string {
	t := time.UnixMilli(ms).UTC()
	return t.Format("2006-01-02")
}

type ComputeSummaryOptions struct {
	Capped               bool
	LoopAlertMinRepeat   int
	LoopAlertMaxItems    int
	TokenRiskStdoutChars int
	TokenRiskMaxItems    int
	Config               ResourceAuditConfig
	// When both set and Since <= Until, success_trend / daily_risk_series include every UTC calendar day in range with zeros for gaps.
	TrendRangeSinceMs *int64
	TrendRangeUntilMs *int64
}

// ParsedShellSpanFromExecDB 由 agent_exec_commands 列构造 ParsedShellSpan（与入库口径一致）。
func ParsedShellSpanFromExecDB(
	command, commandKey, categoryStr, platformStr string,
	exit sql.NullInt64,
	succ sql.NullInt64,
	stdoutLen, stderrLen int,
	estTok int,
	estUsd float64,
	tokenRisk bool,
	cnf, pden, iarg bool,
	cwd, uid, host sql.NullString,
	envKeysJSON sql.NullString,
	cfg ResourceAuditConfig,
) ParsedShellSpan {
	cat := CategoryOther
	switch ShellCommandCategory(strings.ToLower(strings.TrimSpace(categoryStr))) {
	case CategoryFile, CategoryNetwork, CategorySystem, CategoryProcess, CategoryPackage:
		cat = ShellCommandCategory(strings.ToLower(strings.TrimSpace(categoryStr)))
	case CategoryOther:
		cat = CategoryOther
	}
	pl := strings.TrimSpace(platformStr)
	if pl == "" {
		pl = cfg.ShellExec.CommandSemantics.DefaultPlatform
	}
	ast := parseCommandAst(command, pl)

	var envKeys []string
	if envKeysJSON.Valid && strings.TrimSpace(envKeysJSON.String) != "" {
		_ = json.Unmarshal([]byte(envKeysJSON.String), &envKeys)
	}

	var exitCode *int
	if exit.Valid {
		v := int(exit.Int64)
		exitCode = &v
	}
	var success *bool
	if succ.Valid {
		v := succ.Int64 != 0
		success = &v
	}

	var cwdP, uidP, hostP *string
	if cwd.Valid {
		s := cwd.String
		cwdP = &s
	}
	if uid.Valid {
		s := uid.String
		uidP = &s
	}
	if host.Valid {
		s := host.String
		hostP = &s
	}

	return ParsedShellSpan{
		Command:          command,
		CommandKey:       commandKey,
		Category:         cat,
		ExitCode:         exitCode,
		Success:          success,
		StdoutLen:        stdoutLen,
		StderrLen:        stderrLen,
		StdoutPreview:    nil,
		StderrPreview:    nil,
		EstTokens:        estTok,
		EstUsd:           estUsd,
		TokenRisk:        tokenRisk,
		CommandNotFound:  cnf,
		PermissionDenied: pden,
		IllegalArgHint:   iarg,
		Cwd:              cwdP,
		EnvKeys:          envKeys,
		UserID:           uidP,
		Host:             hostP,
		Platform:         pl,
		CommandAst:       ast,
	}
}

// ComputeShellSummaryFromRows mirrors computeShellSummaryFromRows.
func ComputeShellSummaryFromRows(rows []SpanRow, opts ComputeSummaryOptions) ShellSummaryJSON {
	type pair struct {
		row SpanRow
		p   ParsedShellSpan
	}
	parsed := make([]pair, 0, len(rows))
	for _, row := range rows {
		var p ParsedShellSpan
		if row.Preparsed != nil {
			p = *row.Preparsed
		} else {
			in, out, ej, meta, th := RecordToParseInputs(row)
			thr := opts.TokenRiskStdoutChars
			p = ParseShellSpanRow(in, out, ej, meta, th, opts.Config, &thr)
		}
		parsed = append(parsed, pair{row, p})
	}
	traceIDs := make(map[string]struct{})
	success, failed, unknown, tokenRiskTotal := 0, 0, 0, 0
	catBreak := map[ShellCommandCategory]int{
		CategoryFile: 0, CategoryNetwork: 0, CategorySystem: 0,
		CategoryProcess: 0, CategoryPackage: 0, CategoryOther: 0,
	}
	trendMap := make(map[string]struct{ total, failed int })
	riskAgg := make(map[string]struct{ tokenRisk, diag, netsys int })
	cmdCount := make(map[string]int)
	traceDay := make(map[string]string)
	diag := ShellDiagnostics{}

	for _, x := range parsed {
		tid := x.row.TraceID
		if tid != "" {
			traceIDs[tid] = struct{}{}
		}
		catBreak[x.p.Category]++

		var tms int64
		if x.row.StartTimeMs.Valid {
			tms = x.row.StartTimeMs.Int64
		}
		if tms > 0 {
			dk := dayKey(tms)
			cur := trendMap[dk]
			cur.total++
			if x.p.Success != nil && !*x.p.Success {
				cur.failed++
			}
			trendMap[dk] = cur
			ra := riskAgg[dk]
			if x.p.TokenRisk {
				ra.tokenRisk++
			}
			if x.p.CommandNotFound || x.p.PermissionDenied || x.p.IllegalArgHint {
				ra.diag++
			}
			if x.p.Category == CategoryNetwork || x.p.Category == CategorySystem {
				ra.netsys++
			}
			riskAgg[dk] = ra
			if x.row.TraceID != "" {
				if _, ok := traceDay[x.row.TraceID]; !ok {
					traceDay[x.row.TraceID] = dk
				}
			}
		}

		ck := x.p.CommandKey
		if ck == "" {
			ck = "(empty)"
		} else if len(ck) > 120 {
			ck = ck[:120]
		}
		cmdCount[ck]++

		if x.p.TokenRisk {
			tokenRiskTotal++
		}
		if x.p.Success != nil {
			if *x.p.Success {
				success++
			} else {
				failed++
			}
		} else {
			unknown++
		}
		if x.p.CommandNotFound {
			diag.CommandNotFound++
		}
		if x.p.PermissionDenied {
			diag.PermissionDenied++
		}
		if x.p.IllegalArgHint {
			diag.IllegalArgHint++
		}
	}

	var days []string
	if opts.TrendRangeSinceMs != nil && opts.TrendRangeUntilMs != nil &&
		*opts.TrendRangeSinceMs > 0 && *opts.TrendRangeUntilMs >= *opts.TrendRangeSinceMs {
		days = calendardays.UTCYMDInclusive(*opts.TrendRangeSinceMs, *opts.TrendRangeUntilMs, calendardays.DefaultMaxTrendDays)
	}
	if len(days) == 0 {
		days = make([]string, 0, len(trendMap))
		for d := range trendMap {
			days = append(days, d)
		}
		sort.Strings(days)
	}
	successTrend := make([]TrendDay, 0, len(days))
	for _, d := range days {
		v := trendMap[d]
		successTrend = append(successTrend, TrendDay{Day: d, Total: v.total, Failed: v.failed})
	}
	dailyRiskSeries := make([]DailyRiskDay, 0, len(days))
	for _, d := range days {
		v := trendMap[d]
		r := riskAgg[d]
		dailyRiskSeries = append(dailyRiskSeries, DailyRiskDay{
			Day:                d,
			Commands:           v.total,
			Failed:             v.failed,
			TokenRiskCount:     r.tokenRisk,
			DiagnosticCount:    r.diag,
			NetworkSystemCount: r.netsys,
		})
	}

	type cc struct {
		cmd string
		cnt int
	}
	topList := make([]cc, 0, len(cmdCount))
	for k, v := range cmdCount {
		topList = append(topList, cc{k, v})
	}
	sort.Slice(topList, func(i, j int) bool {
		if topList[i].cnt != topList[j].cnt {
			return topList[i].cnt > topList[j].cnt
		}
		return topList[i].cmd < topList[j].cmd
	})
	topCommands := make([]CommandCount, 0, 10)
	for i := 0; i < len(topList) && i < 10; i++ {
		topCommands = append(topCommands, CommandCount{Command: topList[i].cmd, Count: topList[i].cnt})
	}

	slowestCandidates := make([]SlowestEntry, 0, len(parsed))
	for _, x := range parsed {
		if !x.row.DurationMs.Valid {
			continue
		}
		d := x.row.DurationMs.Int64
		if d < 0 {
			continue
		}
		cmd := x.p.CommandKey
		if len(cmd) > 200 {
			cmd = cmd[:200]
		}
		dd := d
		slowestCandidates = append(slowestCandidates, SlowestEntry{
			SpanID: x.row.SpanID, TraceID: x.row.TraceID, Command: cmd, DurationMs: &dd,
		})
	}
	sort.Slice(slowestCandidates, func(i, j int) bool {
		ai := int64(0)
		if slowestCandidates[i].DurationMs != nil {
			ai = *slowestCandidates[i].DurationMs
		}
		aj := int64(0)
		if slowestCandidates[j].DurationMs != nil {
			aj = *slowestCandidates[j].DurationMs
		}
		return ai > aj
	})
	slowest := slowestCandidates
	if len(slowest) > 10 {
		slowest = slowest[:10]
	}

	byTraceLoops := make(map[string]map[string]int)
	for _, x := range parsed {
		tid := x.row.TraceID
		if tid == "" || strings.TrimSpace(x.p.CommandKey) == "" {
			continue
		}
		key := NormalizeCommandKeyForLoop(x.p.CommandKey)
		if byTraceLoops[tid] == nil {
			byTraceLoops[tid] = make(map[string]int)
		}
		byTraceLoops[tid][key]++
	}
	var loopAlerts []LoopAlert
	for tid, m := range byTraceLoops {
		for cmd, rc := range m {
			if rc >= opts.LoopAlertMinRepeat {
				var threadKey *string
				for _, x := range parsed {
					if x.row.TraceID == tid {
						if x.row.ThreadKey.Valid {
							s := x.row.ThreadKey.String
							threadKey = &s
						}
						break
					}
				}
				loopAlerts = append(loopAlerts, LoopAlert{
					TraceID: tid, ThreadKey: threadKey, Command: cmd, RepeatCount: rc,
				})
			}
		}
	}
	sort.Slice(loopAlerts, func(i, j int) bool {
		return loopAlerts[i].RepeatCount > loopAlerts[j].RepeatCount
	})
	if len(loopAlerts) > opts.LoopAlertMaxItems {
		loopAlerts = loopAlerts[:opts.LoopAlertMaxItems]
	}

	var tokenRisks []TokenRiskEntry
	for _, x := range parsed {
		if !x.p.TokenRisk {
			continue
		}
		cmd := x.p.CommandKey
		if len(cmd) > 160 {
			cmd = cmd[:160]
		}
		tokenRisks = append(tokenRisks, TokenRiskEntry{
			SpanID: x.row.SpanID, TraceID: x.row.TraceID, Command: cmd,
			StdoutChars: x.p.StdoutLen, EstTokens: x.p.EstTokens,
			EstUsd: math.Round(x.p.EstUsd*10000) / 10000,
		})
	}
	sort.Slice(tokenRisks, func(i, j int) bool {
		return tokenRisks[i].StdoutChars > tokenRisks[j].StdoutChars
	})
	if len(tokenRisks) > opts.TokenRiskMaxItems {
		tokenRisks = tokenRisks[:opts.TokenRiskMaxItems]
	}

	readLike := func(cmd string) bool {
		parts := wsSplit.Split(strings.TrimSpace(cmd), -1)
		var first string
		for _, p := range parts {
			if p != "" {
				first = p
				break
			}
		}
		t := strings.Trim(first, `'"`)
		t = strings.TrimPrefix(strings.ToLower(t), "./")
		norm := opts.Config.ShellExec.CommandSemantics.Aliases[t]
		if norm == "" {
			norm = t
		}
		return containsStr(opts.Config.ShellExec.CommandSemantics.ReadLike, norm)
	}
	redundantMap := make(map[string]int)
	for _, x := range parsed {
		if !readLike(x.p.CommandKey) {
			continue
		}
		tid := x.row.TraceID
		k := tid + "::" + NormalizeCommandKeyForLoop(x.p.CommandKey)
		redundantMap[k]++
	}
	var redundant []RedundantReadHint
	for k, n := range redundantMap {
		if n < 3 {
			continue
		}
		parts := strings.SplitN(k, "::", 2)
		if len(parts) != 2 {
			continue
		}
		redundant = append(redundant, RedundantReadHint{TraceID: parts[0], Command: parts[1], Repeats: n})
	}
	sort.Slice(redundant, func(i, j int) bool {
		return redundant[i].Repeats > redundant[j].Repeats
	})
	if len(redundant) > 12 {
		redundant = redundant[:12]
	}

	loopBuckets := map[string]int{"3-4": 0, "5-9": 0, "10+": 0}
	for _, la := range loopAlerts {
		n := la.RepeatCount
		switch {
		case n >= 3 && n <= 4:
			loopBuckets["3-4"]++
		case n >= 5 && n <= 9:
			loopBuckets["5-9"]++
		case n >= 10:
			loopBuckets["10+"]++
		}
	}
	var loopRepeatBuckets []MetricBucket
	for _, label := range []string{"3-4", "5-9", "10+"} {
		if v := loopBuckets[label]; v > 0 {
			loopRepeatBuckets = append(loopRepeatBuckets, MetricBucket{Label: label, Value: v})
		}
	}

	thr := opts.TokenRiskStdoutChars
	if thr <= 0 {
		thr = tokenRiskStdoutCharsDefault
	}
	_, trB2, trB3 := thr, thr*4, thr*16
	tokBuckets := map[string]int{
		fmt.Sprintf("[%d,%d)", thr, trB2):  0,
		fmt.Sprintf("[%d,%d)", trB2, trB3): 0,
		fmt.Sprintf("[%d,∞)", trB3):        0,
	}
	tokOrder := []string{
		fmt.Sprintf("[%d,%d)", thr, trB2),
		fmt.Sprintf("[%d,%d)", trB2, trB3),
		fmt.Sprintf("[%d,∞)", trB3),
	}
	for _, x := range parsed {
		if !x.p.TokenRisk {
			continue
		}
		sl := x.p.StdoutLen
		switch {
		case sl < trB2:
			tokBuckets[tokOrder[0]]++
		case sl < trB3:
			tokBuckets[tokOrder[1]]++
		default:
			tokBuckets[tokOrder[2]]++
		}
	}
	var tokenRiskStdoutBuckets []MetricBucket
	for _, label := range tokOrder {
		if v := tokBuckets[label]; v > 0 {
			tokenRiskStdoutBuckets = append(tokenRiskStdoutBuckets, MetricBucket{Label: label, Value: v})
		}
	}

	redundantTop := append([]RedundantReadHint(nil), redundant...)
	if len(redundantTop) > 20 {
		redundantTop = redundantTop[:20]
	}

	loopDayCounts := make(map[string]int)
	for _, la := range loopAlerts {
		if d, ok := traceDay[la.TraceID]; ok {
			loopDayCounts[d]++
		}
	}

	redundantDayCounts := make(map[string]int)
	for _, rd := range redundant {
		if d, ok := traceDay[rd.TraceID]; ok {
			redundantDayCounts[d]++
		}
	}

	dailyLoopAlerts := make([]DateCount, 0, len(days))
	dailyRedundantReadHints := make([]DateCount, 0, len(days))
	dailyTokenRiskAlerts := make([]DateCount, 0, len(days))
	for _, d := range days {
		dailyLoopAlerts = append(dailyLoopAlerts, DateCount{Day: d, Count: loopDayCounts[d]})
		dailyRedundantReadHints = append(dailyRedundantReadHints, DateCount{Day: d, Count: redundantDayCounts[d]})
		dailyTokenRiskAlerts = append(dailyTokenRiskAlerts, DateCount{Day: d, Count: riskAgg[d].tokenRisk})
	}

	var chainPreview *ChainPreview
	if len(parsed) > 0 {
		tid := parsed[0].row.TraceID
		if tid != "" {
			chainPreview = &ChainPreview{TraceID: tid, Steps: nil}
		}
	}

	return ShellSummaryJSON{
		Scanned: len(rows),
		Capped:  opts.Capped,
		Totals: ShellSummaryTotals{
			Commands: len(parsed), DistinctTraces: len(traceIDs),
			Success: success, Failed: failed, Unknown: unknown,
			TokenRiskTotal: tokenRiskTotal,
		},
		CategoryBreakdown:       catBreak,
		SuccessTrend:            successTrend,
		DailyRiskSeries:         dailyRiskSeries,
		TopCommands:             topCommands,
		Slowest:                 slowest,
		LoopAlerts:              loopAlerts,
		TokenRisks:              tokenRisks,
		Diagnostics:             diag,
		ChainPreview:            chainPreview,
		RedundantReadHints:      redundant,
		LoopRepeatBuckets:       loopRepeatBuckets,
		TokenRiskStdoutBuckets:  tokenRiskStdoutBuckets,
		DailyLoopAlerts:         dailyLoopAlerts,
		DailyRedundantReadHints: dailyRedundantReadHints,
		DailyTokenRiskAlerts:    dailyTokenRiskAlerts,
		RedundantReadTop:        redundantTop,
	}
}
