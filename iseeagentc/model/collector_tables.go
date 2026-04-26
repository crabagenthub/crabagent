package model

import "iseeagentc/internal/sqltables"

// CT 为 Model 层 SQL 使用的表名单一来源（与 ingest、migrate 共用 internal/sqltables）。
var CT = struct {
	Spans, Traces, Threads, SecurityPolicies, SecurityPolicyHits, ExecCommands, AgentResourceAccess, AlertRules, AlertEvents string
}{
	Spans:               sqltables.TableAgentSpans,
	Traces:              sqltables.TableAgentTraces,
	Threads:             sqltables.TableAgentThreads,
	SecurityPolicies:    sqltables.TableAgentSecurityPolicies,
	SecurityPolicyHits:  sqltables.TableAgentSecurityPolicyHits,
	ExecCommands:        sqltables.TableAgentExecCommands,
	AgentResourceAccess: sqltables.TableAgentResourceAccess,
	AlertRules:          sqltables.TableAgentAlertRules,
	AlertEvents:         sqltables.TableAgentAlertEvents,
}
