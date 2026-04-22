package model

func QuerySecurityAuditEventsDB(db QueryDB, q SecurityAuditListQuery) ([]map[string]interface{}, error) {
	if db == nil {
		return []map[string]interface{}{}, nil
	}
	return loadSecurityAuditEvents(db, q)
}

func CountSecurityAuditEventsDB(db QueryDB, q SecurityAuditListQuery) (int64, error) {
	if db == nil {
		return 0, nil
	}
	return countSecurityAuditEventsModel(db, q)
}

func QuerySecurityAuditPolicyEventCountsDB(db QueryDB, workspaceName *string) ([]SecurityAuditPolicyEventCount, error) {
	if db == nil {
		return []SecurityAuditPolicyEventCount{}, nil
	}
	return loadSecurityAuditPolicyEventCounts(db, workspaceName)
}
