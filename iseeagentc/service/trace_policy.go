package service

import "iseeagentc/model"

type TracePolicyService struct {
	db model.QueryDB
}

func NewTracePolicyService(db model.QueryDB) *TracePolicyService {
	return &TracePolicyService{db: db}
}

func (s *TracePolicyService) List(workspaceName string) ([]model.InterceptionPolicy, error) {
	return model.QueryAllPoliciesDB(s.db, workspaceName)
}

func (s *TracePolicyService) Upsert(body map[string]interface{}, workspaceName string) (*model.InterceptionPolicy, error) {
	return model.UpsertPolicyDB(s.db, body, workspaceName)
}

func (s *TracePolicyService) Delete(id string, workspaceName string) error {
	return model.DeletePolicyDB(s.db, id, workspaceName)
}

func (s *TracePolicyService) ReportPulled(pulledAtMs int64, workspaceName string) (int64, error) {
	return model.ReportPoliciesPulledDB(s.db, pulledAtMs, workspaceName)
}
