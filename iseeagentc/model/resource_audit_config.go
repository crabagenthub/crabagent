package model

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"

	"iseeagentc/conf"

	toml "github.com/pelletier/go-toml/v2"
)

// ResourceAuditQueryConfig 与 Node ResourceAuditConfig 对齐（JSON camelCase）；资源审计查询使用该配置。
type ResourceAuditQueryConfig struct {
	DangerousPathRules struct {
		PosixPrefixes   []string `json:"posixPrefixes"`
		WindowsPrefixes []string `json:"windowsPrefixes"`
		WindowsRegex    []string `json:"windowsRegex"`
		CaseInsensitive bool     `json:"caseInsensitive"`
	} `json:"dangerousPathRules"`
	LargeRead struct {
		ThresholdChars int `json:"thresholdChars"`
	} `json:"largeRead"`
	LargeToolResult struct {
		ThresholdChars int `json:"thresholdChars"`
	} `json:"largeToolResult"`
	PolicyLink struct {
		Enabled       bool     `json:"enabled"`
		TargetActions []string `json:"targetActions"`
		MatchScope    string   `json:"matchScope"` // "span" | "trace"
	} `json:"policyLink"`
	ShellExec struct {
		LoopAlerts struct {
			MinRepeatCount int `json:"minRepeatCount"`
			MaxItems       int `json:"maxItems"`
		} `json:"loopAlerts"`
		TokenRisks struct {
			StdoutCharsThreshold int `json:"stdoutCharsThreshold"`
			MaxItems             int `json:"maxItems"`
		} `json:"tokenRisks"`
		CommandSemantics struct {
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
			Aliases    map[string]string `json:"aliases"`
			Categories struct {
				File    []string `json:"file"`
				Network []string `json:"network"`
				System  []string `json:"system"`
				Process []string `json:"process"`
				Package []string `json:"package"`
			} `json:"categories"`
			ReadLikeCommands   []string `json:"readLikeCommands"`
			DiagnosticPatterns struct {
				CommandNotFound  []string `json:"commandNotFound"`
				PermissionDenied []string `json:"permissionDenied"`
				IllegalArgHint   []string `json:"illegalArgHint"`
			} `json:"diagnosticPatterns"`
		} `json:"commandSemantics"`
	} `json:"shellExec"`
}

func loadBaseFromEmbedded() (ResourceAuditQueryConfig, error) {
	b, err := decodeConfigBytesToJSON(conf.DefaultResourceAuditConfigTOML())
	if err != nil {
		return ResourceAuditQueryConfig{}, err
	}
	var c ResourceAuditQueryConfig
	if err := json.Unmarshal(b, &c); err != nil {
		return ResourceAuditQueryConfig{}, err
	}
	return c, nil
}

func decodeConfigBytesToJSON(raw []byte) ([]byte, error) {
	var anyMap map[string]any
	if err := toml.Unmarshal(raw, &anyMap); err == nil {
		return json.Marshal(anyMap)
	}
	if err := json.Unmarshal(raw, &anyMap); err == nil {
		return json.Marshal(anyMap)
	}
	return nil, errors.New("invalid config format: expect TOML or JSON object")
}

// DefaultResourceAuditQueryConfig 等价于 Node defaultResourceAuditConfig()（内嵌 JSON 的副本）。
func DefaultResourceAuditQueryConfig() ResourceAuditQueryConfig {
	c, err := loadBaseFromEmbedded()
	if err != nil {
		return ResourceAuditQueryConfig{}
	}
	return c
}

func getRawObject(m map[string]json.RawMessage, key string) map[string]json.RawMessage {
	v, ok := m[key]
	if !ok || len(v) == 0 {
		return map[string]json.RawMessage{}
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(v, &obj) != nil {
		return map[string]json.RawMessage{}
	}
	return obj
}

func cleanStringArrayFromRaw(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var arr []any
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil
	}
	var out []string
	for _, x := range arr {
		s := strings.TrimSpace(stringFromJSONScalar(x))
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

func stringFromJSONScalar(x any) string {
	switch v := x.(type) {
	case string:
		return v
	default:
		b, _ := json.Marshal(v)
		return strings.TrimSpace(string(b))
	}
}

func cleanStringMapFromRaw(raw json.RawMessage) map[string]string {
	if len(raw) == 0 {
		return map[string]string{}
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return map[string]string{}
	}
	out := make(map[string]string)
	for k, val := range m {
		key := strings.ToLower(strings.TrimSpace(k))
		next := strings.ToLower(strings.TrimSpace(stringFromJSONScalar(val)))
		if key == "" || next == "" {
			continue
		}
		out[key] = next
	}
	return out
}

func intFromRawGEZero(raw json.RawMessage, fallback int) int {
	if len(raw) == 0 {
		return fallback
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err != nil {
		return fallback
	}
	if !isFiniteFloatForConfig(n) || n < 0 {
		return fallback
	}
	return int(n)
}

func intFromRawGEFloor1(raw json.RawMessage, fallback int) int {
	if len(raw) == 0 {
		return fallback
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err != nil {
		return fallback
	}
	if !isFiniteFloatForConfig(n) || n < 1 {
		return fallback
	}
	return int(n)
}

func isFiniteFloatForConfig(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

func boolFromRaw(raw json.RawMessage, fallback bool) bool {
	if len(raw) == 0 {
		return fallback
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err != nil {
		return fallback
	}
	return b
}

func stringFromRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return ""
	}
	return strings.TrimSpace(s)
}

func copyCategories(dst *ResourceAuditQueryConfig, src ResourceAuditQueryConfig) {
	dst.ShellExec.CommandSemantics.Categories.File = append([]string(nil), src.ShellExec.CommandSemantics.Categories.File...)
	dst.ShellExec.CommandSemantics.Categories.Network = append([]string(nil), src.ShellExec.CommandSemantics.Categories.Network...)
	dst.ShellExec.CommandSemantics.Categories.System = append([]string(nil), src.ShellExec.CommandSemantics.Categories.System...)
	dst.ShellExec.CommandSemantics.Categories.Process = append([]string(nil), src.ShellExec.CommandSemantics.Categories.Process...)
	dst.ShellExec.CommandSemantics.Categories.Package = append([]string(nil), src.ShellExec.CommandSemantics.Categories.Package...)
}

func copyAliases(dst *ResourceAuditQueryConfig, src ResourceAuditQueryConfig) {
	if src.ShellExec.CommandSemantics.Aliases == nil {
		dst.ShellExec.CommandSemantics.Aliases = map[string]string{}
		return
	}
	m := make(map[string]string, len(src.ShellExec.CommandSemantics.Aliases))
	for k, v := range src.ShellExec.CommandSemantics.Aliases {
		m[k] = v
	}
	dst.ShellExec.CommandSemantics.Aliases = m
}

// normalizeResourceAuditConfigBytes 对齐 Node normalizeResourceAuditConfig；ok 为 false 表示校验失败（如非法正则），调用方应退回默认配置。
func normalizeResourceAuditConfigBytes(b []byte) (ResourceAuditQueryConfig, bool) {
	base, err := loadBaseFromEmbedded()
	if err != nil {
		return ResourceAuditQueryConfig{}, false
	}

	jsonBytes, err := decodeConfigBytesToJSON(b)
	if err != nil {
		return base, true
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(jsonBytes, &raw); err != nil {
		return base, true
	}

	dangerous := getRawObject(raw, "dangerousPathRules")
	largeRead := getRawObject(raw, "largeRead")
	largeToolResult := getRawObject(raw, "largeToolResult")
	policyLink := getRawObject(raw, "policyLink")
	shellExec := getRawObject(raw, "shellExec")
	shellLoopAlerts := getRawObject(shellExec, "loopAlerts")
	shellTokenRisks := getRawObject(shellExec, "tokenRisks")
	commandSemantics := getRawObject(shellExec, "commandSemantics")
	platformDetect := getRawObject(commandSemantics, "platformDetect")
	spanNameHints := getRawObject(platformDetect, "spanNameHints")
	categories := getRawObject(commandSemantics, "categories")
	diagnosticPatterns := getRawObject(commandSemantics, "diagnosticPatterns")

	var next ResourceAuditQueryConfig

	next.DangerousPathRules.PosixPrefixes = cleanStringArrayFromRaw(dangerous["posixPrefixes"])
	next.DangerousPathRules.WindowsPrefixes = cleanStringArrayFromRaw(dangerous["windowsPrefixes"])
	next.DangerousPathRules.WindowsRegex = cleanStringArrayFromRaw(dangerous["windowsRegex"])
	if _, ok := dangerous["caseInsensitive"]; ok {
		next.DangerousPathRules.CaseInsensitive = boolFromRaw(dangerous["caseInsensitive"], base.DangerousPathRules.CaseInsensitive)
	} else {
		next.DangerousPathRules.CaseInsensitive = base.DangerousPathRules.CaseInsensitive
	}

	next.LargeRead.ThresholdChars = intFromRawGEZero(largeRead["thresholdChars"], base.LargeRead.ThresholdChars)
	next.LargeToolResult.ThresholdChars = intFromRawGEZero(largeToolResult["thresholdChars"], base.LargeToolResult.ThresholdChars)

	next.PolicyLink.Enabled = boolFromRaw(policyLink["enabled"], base.PolicyLink.Enabled)
	next.PolicyLink.TargetActions = cleanStringArrayFromRaw(policyLink["targetActions"])
	ms := stringFromRaw(policyLink["matchScope"])
	if ms == "trace" {
		next.PolicyLink.MatchScope = "trace"
	} else {
		next.PolicyLink.MatchScope = "span"
	}

	next.ShellExec.LoopAlerts.MinRepeatCount = intFromRawGEFloor1(shellLoopAlerts["minRepeatCount"], base.ShellExec.LoopAlerts.MinRepeatCount)
	next.ShellExec.LoopAlerts.MaxItems = intFromRawGEFloor1(shellLoopAlerts["maxItems"], base.ShellExec.LoopAlerts.MaxItems)
	next.ShellExec.TokenRisks.StdoutCharsThreshold = intFromRawGEZero(shellTokenRisks["stdoutCharsThreshold"], base.ShellExec.TokenRisks.StdoutCharsThreshold)
	next.ShellExec.TokenRisks.MaxItems = intFromRawGEFloor1(shellTokenRisks["maxItems"], base.ShellExec.TokenRisks.MaxItems)

	next.ShellExec.CommandSemantics.Enabled = boolFromRaw(commandSemantics["enabled"], base.ShellExec.CommandSemantics.Enabled)
	dp := stringFromRaw(commandSemantics["defaultPlatform"])
	if dp == "windows_cmd" || dp == "powershell" {
		next.ShellExec.CommandSemantics.DefaultPlatform = dp
	} else {
		next.ShellExec.CommandSemantics.DefaultPlatform = "unix"
	}
	if _, ok := platformDetect["preferSpanNameHints"]; ok {
		next.ShellExec.CommandSemantics.PlatformDetect.PreferSpanNameHints = boolFromRaw(
			platformDetect["preferSpanNameHints"],
			base.ShellExec.CommandSemantics.PlatformDetect.PreferSpanNameHints,
		)
	} else {
		next.ShellExec.CommandSemantics.PlatformDetect.PreferSpanNameHints = base.ShellExec.CommandSemantics.PlatformDetect.PreferSpanNameHints
	}
	next.ShellExec.CommandSemantics.PlatformDetect.SpanNameHints.Unix = cleanStringArrayFromRaw(spanNameHints["unix"])
	next.ShellExec.CommandSemantics.PlatformDetect.SpanNameHints.WindowsCmd = cleanStringArrayFromRaw(spanNameHints["windows_cmd"])
	next.ShellExec.CommandSemantics.PlatformDetect.SpanNameHints.Powershell = cleanStringArrayFromRaw(spanNameHints["powershell"])

	next.ShellExec.CommandSemantics.Aliases = cleanStringMapFromRaw(commandSemantics["aliases"])
	next.ShellExec.CommandSemantics.Categories.File = cleanStringArrayFromRaw(categories["file"])
	next.ShellExec.CommandSemantics.Categories.Network = cleanStringArrayFromRaw(categories["network"])
	next.ShellExec.CommandSemantics.Categories.System = cleanStringArrayFromRaw(categories["system"])
	next.ShellExec.CommandSemantics.Categories.Process = cleanStringArrayFromRaw(categories["process"])
	next.ShellExec.CommandSemantics.Categories.Package = cleanStringArrayFromRaw(categories["package"])
	next.ShellExec.CommandSemantics.ReadLikeCommands = cleanStringArrayFromRaw(commandSemantics["readLikeCommands"])
	next.ShellExec.CommandSemantics.DiagnosticPatterns.CommandNotFound = cleanStringArrayFromRaw(diagnosticPatterns["commandNotFound"])
	next.ShellExec.CommandSemantics.DiagnosticPatterns.PermissionDenied = cleanStringArrayFromRaw(diagnosticPatterns["permissionDenied"])
	next.ShellExec.CommandSemantics.DiagnosticPatterns.IllegalArgHint = cleanStringArrayFromRaw(diagnosticPatterns["illegalArgHint"])

	if len(next.ShellExec.CommandSemantics.Aliases) == 0 {
		copyAliases(&next, base)
	}
	if len(next.ShellExec.CommandSemantics.Categories.File) == 0 {
		copyCategories(&next, base)
	}
	if len(next.ShellExec.CommandSemantics.ReadLikeCommands) == 0 {
		next.ShellExec.CommandSemantics.ReadLikeCommands = append([]string(nil), base.ShellExec.CommandSemantics.ReadLikeCommands...)
	}

	for _, pat := range next.DangerousPathRules.WindowsRegex {
		if _, err := regexp.Compile(pat); err != nil {
			return ResourceAuditQueryConfig{}, false
		}
	}
	return next, true
}

// NormalizeResourceAuditConfig 对齐 Node normalizeResourceAuditConfig；非法 JSON 或校验失败时退回内嵌默认。
func NormalizeResourceAuditQueryConfig(raw []byte) ResourceAuditQueryConfig {
	c, ok := normalizeResourceAuditConfigBytes(raw)
	if !ok {
		return DefaultResourceAuditQueryConfig()
	}
	return c
}

// LoadResourceAuditQueryConfig 仅加载内嵌 conf/resourceaudit.toml。
func LoadResourceAuditQueryConfig() ResourceAuditQueryConfig {
	if c, ok := normalizeResourceAuditConfigBytes(conf.DefaultResourceAuditConfigTOML()); ok {
		return c
	}
	return ResourceAuditQueryConfig{}
}
