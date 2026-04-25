package model

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"iseeagentc/internal/migrate"
	"iseeagentc/internal/sqltables"
)

func TestQueryRiskOverviewDailyTrends(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	if err := migrate.RunAgentTableMigrations(db); err != nil {
		t.Fatal(err)
	}

	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentThreads + ` (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
VALUES ('t1','OpenClaw','openclaw','main',1,2)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentTraces + ` (trace_id, thread_id, workspace_name, project_name, trace_type, created_at_ms, is_complete, created_from)
VALUES ('tr1','t1','OpenClaw','openclaw','external',1704067200000,1,'test')`)
	if err != nil {
		t.Fatal(err)
	}

	// 2024-01-01: resource flags + command events (including loop >=3)
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentResourceAccess + ` (span_id, trace_id, workspace_name, project_name, thread_key, span_name, start_time_ms, resource_uri, access_mode, semantic_kind, chars, risk_flags, created_at_ms)
VALUES
('ra1','tr1','OpenClaw','openclaw','t1','read',1704067200000,'/etc/passwd','read','file',120,'sensitive_path,large_read',1704067200000),
('ra2','tr1','OpenClaw','openclaw','t1','read',1704067201000,'/tmp/a','read','file',80,'redundant_read',1704067201000),
('ra3','tr1','OpenClaw','openclaw','t1','read',1704067202000,'/tmp/b','read','file',30,'credential_hint,secret_hint',1704067202000)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentExecCommands + ` (span_id, trace_id, workspace_name, project_name, thread_key, span_name, start_time_ms, command, command_key, category, token_risk, command_not_found, permission_denied, created_at_ms)
VALUES
('ec1','tr1','OpenClaw','openclaw','t1','exec',1704067200000,'cat a','cat a','file',1,0,1,1704067200000),
('ec2','tr1','OpenClaw','openclaw','t1','exec',1704067201000,'cat a','cat a','file',0,1,0,1704067201000),
('ec3','tr1','OpenClaw','openclaw','t1','exec',1704067202000,'cat a','cat a','file',0,0,0,1704067202000),
('ec4','tr1','OpenClaw','openclaw','t1','exec',1704067203000,'cat a','cat a','file',0,0,0,1704067203000)`)
	if err != nil {
		t.Fatal(err)
	}

	// 2024-01-02: one sensitive path + one permission denied
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentResourceAccess + ` (span_id, trace_id, workspace_name, project_name, thread_key, span_name, start_time_ms, resource_uri, access_mode, semantic_kind, chars, risk_flags, created_at_ms)
VALUES ('ra4','tr1','OpenClaw','openclaw','t1','read',1704153600000,'/root/.ssh/id_rsa','read','file',10,'sensitive_path',1704153600000)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentExecCommands + ` (span_id, trace_id, workspace_name, project_name, thread_key, span_name, start_time_ms, command, command_key, category, token_risk, command_not_found, permission_denied, created_at_ms)
VALUES ('ec5','tr1','OpenClaw','openclaw','t1','exec',1704153600000,'ls /root','ls /root','system',0,0,1,1704153600000)`)
	if err != nil {
		t.Fatal(err)
	}

	since := int64(1704067200000) // 2024-01-01
	until := int64(1704153600000) // 2024-01-02
	got, err := QueryRiskOverviewDailyTrends(db, RiskOverviewDailyTrendsQuery{
		SinceMs: &since,
		UntilMs: &until,
	})
	if err != nil {
		t.Fatal(err)
	}

	if len(got.Resource.SensitivePath) != 2 {
		t.Fatalf("unexpected day count: %d", len(got.Resource.SensitivePath))
	}
	// Day1
	if got.Resource.SensitivePath[0].Count != 1 || got.Resource.RedundantRead[0].Count != 1 || got.Resource.CredentialAndSecret[0].Count != 1 || got.Resource.LargeRead[0].Count != 1 {
		t.Fatalf("unexpected day1 resource trend: %+v %+v %+v %+v", got.Resource.SensitivePath[0], got.Resource.RedundantRead[0], got.Resource.CredentialAndSecret[0], got.Resource.LargeRead[0])
	}
	if got.Command.PermissionDenied[0].Count != 1 || got.Command.InvalidCommand[0].Count != 1 || got.Command.CommandLoop[0].Count != 1 || got.Command.SensitiveCommandTokenRisk[0].Count != 1 {
		t.Fatalf("unexpected day1 command trend: %+v %+v %+v %+v", got.Command.PermissionDenied[0], got.Command.InvalidCommand[0], got.Command.CommandLoop[0], got.Command.SensitiveCommandTokenRisk[0])
	}
	// Day2
	if got.Resource.SensitivePath[1].Count != 1 || got.Command.PermissionDenied[1].Count != 1 {
		t.Fatalf("unexpected day2 trend: %+v %+v", got.Resource.SensitivePath[1], got.Command.PermissionDenied[1])
	}
}
