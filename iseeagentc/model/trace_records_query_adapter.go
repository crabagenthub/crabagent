package model

func QueryTraceRecordsDB(db QueryDB, q TraceRecordsListQuery, postgres bool) ([]map[string]interface{}, error) {
	if db == nil {
		return []map[string]interface{}{}, nil
	}
	if postgres {
		return loadTraceRecordsPostgres(db, q)
	}
	return loadTraceRecords(db, q)
}

func CountTraceRecordsDB(db QueryDB, q TraceRecordsListQuery, postgres bool) (int64, error) {
	if db == nil {
		return 0, nil
	}
	if postgres {
		return countTraceRecordsPostgresModel(db, q)
	}
	return countTraceRecordsModel(db, q)
}

func QueryThreadRecordsDB(db QueryDB, q ThreadRecordsListQuery) ([]map[string]interface{}, error) {
	if db == nil {
		return []map[string]interface{}{}, nil
	}
	return loadThreadRecords(db, q)
}

func CountThreadRecordsDB(db QueryDB, q ThreadRecordsListQuery) (int64, error) {
	if db == nil {
		return 0, nil
	}
	return countThreadRecordsModel(db, q)
}

func QuerySpanRecordsDB(db QueryDB, q SpanRecordsListQuery) ([]map[string]interface{}, error) {
	if db == nil {
		return []map[string]interface{}{}, nil
	}
	return loadSpanRecords(db, q)
}

func CountSpanRecordsDB(db QueryDB, q SpanRecordsListQuery) (int64, error) {
	if db == nil {
		return 0, nil
	}
	return countSpanRecordsModel(db, q)
}
