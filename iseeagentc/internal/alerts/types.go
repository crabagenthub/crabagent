package alerts

// AdvancedFilter mirrors frontend advanced_json / template fields.
type AdvancedFilter struct {
	SourceTable    string
	ConditionField string
	MatchType      string
	CountThreshold float64
	TraceIDFilter  string
	// FrequencyMode: "immediate" | "windowed" (default windowed when empty).
	FrequencyMode string
	// SubWindowMinutes: if >0 and < WindowMinutes, split [since,until] into sub-ranges for count metrics (any_max).
	SubWindowMinutes int
	// SubWindowMode: "any_max" (default) = breach if any sub-window count exceeds threshold.
	SubWindowMode string
}

// EvalResult is one evaluation pass.
type EvalResult struct {
	Value           float64
	ConditionPreview string
	Breached        bool
	Details         string
}
