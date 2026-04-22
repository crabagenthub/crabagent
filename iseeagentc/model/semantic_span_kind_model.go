package model

import "strings"

func normalizeSemanticKind(metadata map[string]interface{}) string {
	sk, _ := metadata["semantic_kind"]
	if sk == nil {
		sk = metadata["semanticKind"]
	}
	s, _ := sk.(string)
	return strings.ToLower(strings.TrimSpace(s))
}

func metadataResourceURI(metadata map[string]interface{}) string {
	r, ok := metadata["resource"].(map[string]interface{})
	if !ok || r == nil {
		return ""
	}
	u, _ := r["uri"].(string)
	return strings.TrimSpace(u)
}

func inferSkillFromToolName(toolName string) bool {
	n := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(toolName), "-", "_"))
	if n == "" {
		return false
	}
	if n == "skill" || n == "skills" {
		return true
	}
	return strings.HasPrefix(n, "skills.") || strings.HasPrefix(n, "skill.")
}

func inferMemoryFromToolName(toolName string) bool {
	n := strings.ToLower(toolName)
	if strings.TrimSpace(n) == "" {
		return false
	}
	if inferSkillFromToolName(toolName) {
		return false
	}
	if strings.Contains(n, "memory") || strings.Contains(n, "recall") || strings.Contains(n, "rag") {
		return true
	}
	return strings.Contains(n, "search") && (strings.Contains(n, "kb") || strings.Contains(n, "knowledge") || strings.Contains(n, "vector"))
}

func toolSpanSemanticFromMetadata(name string, metadata map[string]interface{}) string {
	sk := normalizeSemanticKind(metadata)
	if sk == "memory" {
		return "MEMORY"
	}
	if sk == "skill" {
		return "SKILL"
	}
	if uri := metadataResourceURI(metadata); strings.HasPrefix(strings.ToLower(uri), "memory://") {
		return "MEMORY"
	}
	if inferSkillFromToolName(name) {
		return "SKILL"
	}
	if inferMemoryFromToolName(name) {
		return "MEMORY"
	}
	return "TOOL"
}

func MapSpanTypeToApi(spanType, name string, metadata map[string]interface{}) string {
	sk := normalizeSemanticKind(metadata)
	switch strings.ToLower(strings.TrimSpace(spanType)) {
	case "llm":
		return "LLM"
	case "tool":
		return toolSpanSemanticFromMetadata(name, metadata)
	case "guardrail":
		return "GUARDRAIL"
	}
	if strings.TrimSpace(name) == "agent_loop" {
		return "AGENT_LOOP"
	}
	if sk == "memory" {
		return "MEMORY"
	}
	return "IO"
}
