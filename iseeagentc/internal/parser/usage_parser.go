package parser

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

type UsageExtendedResult struct {
	PromptTokens     *float64
	CompletionTokens *float64
	TotalTokens      *float64
	CacheReadTokens  *float64
	UsageBreakdown   map[string]float64
}

func UsageHasTokenSignals(u interface{}) bool {
	o, ok := u.(map[string]interface{})
	if !ok || o == nil {
		return false
	}
	keys := []string{
		"input", "output", "inputTokens", "outputTokens", "total_tokens", "totalTokens",
		"totalTokenCount", "prompt_tokens", "completion_tokens", "input_tokens", "output_tokens",
		"prompt_token_count", "completion_token_count", "candidatesTokenCount", "promptTokenCount",
		"inputTokenCount", "outputTokenCount",
	}
	for _, k := range keys {
		v := o[k]
		if _, ok := toFiniteFloat(v); ok {
			return true
		}
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			if _, err := parseFloatTrim(s); err == nil {
				return true
			}
		}
	}
	um, ok := o["usageMetadata"].(map[string]interface{})
	if !ok || um == nil {
		return false
	}
	for _, kk := range []string{"totalTokenCount", "totalTokens", "promptTokenCount", "candidatesTokenCount"} {
		if _, ok := toFiniteFloat(um[kk]); ok {
			return true
		}
	}
	return false
}

func ParseUsageExtended(usageJSON *string) UsageExtendedResult {
	empty := UsageExtendedResult{nil, nil, nil, nil, map[string]float64{}}
	if usageJSON == nil || strings.TrimSpace(*usageJSON) == "" {
		return empty
	}
	var o map[string]interface{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(*usageJSON)), &o); err != nil || len(o) == 0 {
		return empty
	}

	um, _ := o["usageMetadata"].(map[string]interface{})
	if um == nil {
		um = map[string]interface{}{}
	}
	usageNested, _ := o["usage"].(map[string]interface{})
	if usageNested == nil {
		usageNested = map[string]interface{}{}
	}
	umNested, _ := usageNested["usageMetadata"].(map[string]interface{})
	if umNested == nil {
		umNested = map[string]interface{}{}
	}

	num := func(v interface{}) *float64 { return floatPtrFinite(v) }
	pick := func(vals ...interface{}) *float64 {
		for _, v := range vals {
			if n := num(v); n != nil {
				return n
			}
		}
		return nil
	}

	promptN := pick(o["prompt_tokens"], o["promptTokens"], o["input"], um["promptTokenCount"], um["inputTokenCount"],
		usageNested["prompt_tokens"], usageNested["promptTokens"], usageNested["prompt_token_count"],
		usageNested["input_tokens"], usageNested["inputTokens"], usageNested["promptTokenCount"], usageNested["inputTokenCount"],
		umNested["promptTokenCount"], umNested["inputTokenCount"])
	prompt := 0.0
	if promptN != nil {
		prompt = math.Trunc(*promptN)
	}

	completionN := pick(o["completion_tokens"], o["completionTokens"], o["output"], um["candidatesTokenCount"], um["outputTokenCount"],
		usageNested["completion_tokens"], usageNested["completionTokens"], usageNested["completion_token_count"],
		usageNested["output_tokens"], usageNested["outputTokens"], usageNested["candidatesTokenCount"], usageNested["outputTokenCount"],
		umNested["candidatesTokenCount"], umNested["outputTokenCount"])
	completion := 0.0
	if completionN != nil {
		completion = math.Trunc(*completionN)
	}

	cacheRead := pick(o["cache_read_tokens"], o["cacheReadTokens"], o["cacheRead"], um["cachedContentTokenCount"], o["cached_prompt_tokens"],
		um["cacheReadInputTokens"], usageNested["cache_read_tokens"], usageNested["cacheReadTokens"], usageNested["cacheRead"],
		umNested["cachedContentTokenCount"], umNested["cacheReadInputTokens"])

	totalExplicit := pick(o["total_tokens"], o["totalTokens"], o["total"], um["totalTokenCount"], um["totalTokens"], o["totalTokenCount"],
		usageNested["total_tokens"], usageNested["totalTokens"], usageNested["totalTokenCount"], usageNested["total"],
		umNested["totalTokenCount"], umNested["totalTokens"])

	usageBreakdown := map[string]float64{}
	for k, v := range o {
		if k != "usageMetadata" {
			if n := num(v); n != nil {
				usageBreakdown[k] = *n
			}
		}
	}
	for k, v := range um {
		if n := num(v); n != nil {
			usageBreakdown["usageMetadata."+k] = *n
		}
	}

	sumPc := prompt + completion
	var total *float64
	if totalExplicit != nil {
		t := math.Trunc(*totalExplicit)
		total = &t
	} else if sumPc > 0 {
		cr := 0.0
		if cacheRead != nil {
			cr = math.Trunc(*cacheRead)
		}
		t := sumPc + cr
		total = &t
	}
	hasUsage := totalExplicit != nil || sumPc > 0 || (cacheRead != nil && *cacheRead > 0) || len(usageBreakdown) > 0
	if !hasUsage {
		return empty
	}
	pt := prompt
	ct := completion
	var crt *float64
	if cacheRead != nil {
		v := math.Trunc(*cacheRead)
		crt = &v
	}
	return UsageExtendedResult{&pt, &ct, total, crt, usageBreakdown}
}

func parseFloatTrim(s string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(s), 64)
}

func toFiniteFloat(v interface{}) (float64, bool) {
	n := floatPtrFinite(v)
	if n == nil {
		return 0, false
	}
	return *n, true
}

func floatPtrFinite(v interface{}) *float64 {
	switch x := v.(type) {
	case float64:
		if !math.IsNaN(x) && !math.IsInf(x, 0) {
			return &x
		}
	case float32:
		f := float64(x)
		if !math.IsNaN(f) && !math.IsInf(f, 0) {
			return &f
		}
	case int:
		f := float64(x)
		return &f
	case int64:
		f := float64(x)
		return &f
	case json.Number:
		if f, err := x.Float64(); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return &f
		}
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return &f
		}
	}
	return nil
}
