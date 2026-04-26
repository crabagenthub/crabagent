// Package sqltables holds canonical SQL table names for the agent collector schema.
// Legacy names are for one-shot migrations only.
package sqltables

// Current schema (agent_*).
const (
	TableAgentSpans              = "agent_spans"
	TableAgentTraces             = "agent_traces"
	TableAgentThreads            = "agent_threads"
	TableAgentAttachments        = "agent_attachments"
	TableAgentTraceFeedback      = "agent_trace_feedback"
	TableAgentRawIngest          = "agent_raw_ingest"
	TableAgentSecurityPolicies   = "agent_security_policies"
	TableAgentSecurityPolicyHits = "agent_security_policy_hits"
	TableAgentExecCommands       = "agent_exec_commands"
	TableAgentResourceAccess     = "agent_resource_access"
	TableAgentAlertRules         = "agent_alert_rules"
	TableAgentAlertEvents        = "agent_alert_events"
)

// Legacy names — migration only; do not use in application queries.
const (
	LegacyTableOpikSpans            = "opik_spans"
	LegacyTableOpikTraces           = "opik_traces"
	LegacyTableOpikThreads          = "opik_threads"
	LegacyTableOpikAttachments      = "opik_attachments"
	LegacyTableOpikTraceFeedback    = "opik_trace_feedback"
	LegacyTableOpikRawIngest        = "opik_raw_ingest"
	LegacyTableInterceptionPolicies = "interception_policies"
	LegacyTableSecurityAuditLogs    = "security_audit_logs" // deprecated: old name for agent_security_policy_hits
)

// LegacyResourceAuditConfigs is dropped on migrate; kept for DROP IF EXISTS only.
const LegacyResourceAuditConfigs = "resource_audit_configs"
