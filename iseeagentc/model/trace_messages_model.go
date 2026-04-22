package model

type TraceMessagesListQuery struct {
	Limit  int
	Offset int
	Order  string
	Search *string
}

// loadTraceMessages keeps behavior aligned with current collector implementation.
func loadTraceMessages(_ QueryDB, _ TraceMessagesListQuery) []map[string]interface{} {
	return nil
}
