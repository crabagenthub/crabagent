package model

func QueryAllPoliciesDB(db QueryDB, workspaceName string) ([]InterceptionPolicy, error) {
	if db == nil {
		return []InterceptionPolicy{}, nil
	}
	return loadAllPolicies(db, workspaceName)
}

func UpsertPolicyDB(db QueryDB, body map[string]interface{}, workspaceName string) (*InterceptionPolicy, error) {
	if db == nil {
		return nil, nil
	}
	return upsertPolicyModel(db, body, workspaceName)
}

func DeletePolicyDB(db QueryDB, id string, workspaceName string) error {
	if db == nil {
		return nil
	}
	return deletePolicyModel(db, id, workspaceName)
}

func ReportPoliciesPulledDB(db QueryDB, pulledAtMs int64, workspaceName string) (int64, error) {
	if db == nil {
		return 0, nil
	}
	return reportPoliciesPulledModel(db, pulledAtMs, workspaceName)
}
