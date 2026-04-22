package model

import (
	"net/url"
	"strings"
)

func ClampFacetFilter(s string) *string {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	if len(t) > 200 {
		t = t[:200]
	}
	return &t
}

type ObserveListStatus string

const (
	StatusRunning ObserveListStatus = "running"
	StatusSuccess ObserveListStatus = "success"
	StatusError   ObserveListStatus = "error"
	StatusTimeout ObserveListStatus = "timeout"
)

type ObserveSpanListType string

const (
	SpanTypeGeneral   ObserveSpanListType = "general"
	SpanTypeTool      ObserveSpanListType = "tool"
	SpanTypeLlm       ObserveSpanListType = "llm"
	SpanTypeGuardrail ObserveSpanListType = "guardrail"
)

func ParseObserveSpanListType(raw string) *ObserveSpanListType {
	t := strings.ToLower(strings.TrimSpace(raw))
	switch t {
	case "general":
		v := SpanTypeGeneral
		return &v
	case "tool":
		v := SpanTypeTool
		return &v
	case "llm":
		v := SpanTypeLlm
		return &v
	case "guardrail":
		v := SpanTypeGuardrail
		return &v
	default:
		return nil
	}
}

func ParseObserveListStatusesFromQuery(v url.Values) []ObserveListStatus {
	raw := v["status"]
	var parts []string
	for _, chunk := range raw {
		for _, piece := range strings.Split(chunk, ",") {
			t := strings.ToLower(strings.TrimSpace(piece))
			if t != "" {
				parts = append(parts, t)
			}
		}
	}
	seen := map[string]struct{}{}
	var out []ObserveListStatus
	for _, t := range parts {
		if _, ok := seen[t]; ok {
			continue
		}
		switch t {
		case "running", "success", "error", "timeout":
			seen[t] = struct{}{}
			out = append(out, ObserveListStatus(t))
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
