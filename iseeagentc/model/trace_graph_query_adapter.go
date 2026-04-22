package model

func QueryTraceMessagesDB(db QueryDB, q TraceMessagesListQuery) []map[string]interface{} {
	if db == nil {
		return []map[string]interface{}{}
	}
	return loadTraceMessages(db, q)
}

func ResolveCanonicalTraceIDForSpanDB(db QueryDB, traceID string) string {
	if db == nil {
		return traceID
	}
	return resolveCanonicalTraceIDForSpan(db, traceID)
}

func resolveCanonicalTraceIDForSpan(db QueryDB, traceID string) string {
	return resolveCanonicalTraceIDForSpanModel(db, traceID)
}

func QuerySemanticSpansByTraceIDDB(db QueryDB, traceID string) ([]SemanticSpanRow, error) {
	if db == nil {
		return []SemanticSpanRow{}, nil
	}
	return querySemanticSpansByTraceIDModel(db, traceID)
}

func QueryTraceInputByTraceIDDB(db QueryDB, traceID string) map[string]interface{} {
	if db == nil {
		return nil
	}
	return queryTraceInputByTraceIDModel(db, traceID)
}

func QueryThreadTraceEventsDB(db QueryDB, threadKey string) ([]map[string]interface{}, error) {
	if db == nil {
		return []map[string]interface{}{}, nil
	}
	return loadThreadTraceEvents(db, threadKey)
}

func QueryThreadTokenBreakdownDB(db QueryDB, threadID string) (*ThreadTokenBreakdown, error) {
	if db == nil {
		return nil, nil
	}
	return loadThreadTokenBreakdown(db, threadID)
}

func QueryThreadTurnsTreeDB(db QueryDB, threadID string) (*ThreadTurnsResponse, error) {
	if db == nil {
		return nil, nil
	}
	return loadThreadTurnsTree(db, threadID)
}

func QueryThreadTraceGraphDB(db QueryDB, threadID string, maxNodes int) (*TraceGraphResponse, error) {
	if db == nil {
		return nil, nil
	}
	return loadThreadTraceGraph(db, threadID, maxNodes)
}

func QueryConversationExecutionGraphDB(db QueryDB, threadID string, maxNodes int) (*ExecutionGraphResponse, error) {
	if db == nil {
		return nil, nil
	}
	return loadConversationExecutionGraph(db, threadID, maxNodes)
}

func QueryTraceExecutionGraphDB(db QueryDB, traceID string, maxNodes int) (*ExecutionGraphResponse, error) {
	if db == nil {
		return nil, nil
	}
	return loadTraceExecutionGraph(db, traceID, maxNodes)
}

func QueryObserveFacetsDB(db QueryDB, workspaceName *string) (*ObserveFacetsResult, error) {
	if db == nil {
		return nil, nil
	}
	return loadObserveFacets(db, workspaceName)
}
