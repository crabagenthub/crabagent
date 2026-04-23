package alerts

// AdvancedFilter mirrors frontend advanced_json / template fields.
type AdvancedFilter struct {
	SourceTable     string
	ConditionField  string
	MatchType       string
	CountThreshold  float64
	TraceIDFilter   string
}

// EvalResult is one evaluation pass.
type EvalResult struct {
	Value           float64
	ConditionPreview string
	Breached        bool
	Details         string
}
