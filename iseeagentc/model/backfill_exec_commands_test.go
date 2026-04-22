package model

import (
	"database/sql"
	"encoding/json"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"iseeagentc/internal/migrate"
	"iseeagentc/internal/sqltables"
)

func TestBackfillAgentExecCommands(t *testing.T) {
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
 VALUES ('t','OpenClaw','openclaw','main',1,2)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentTraces + ` (trace_id, thread_id, workspace_name, project_name, trace_type, created_at_ms, is_complete, created_from)
 VALUES ('trb','t','OpenClaw','openclaw','external',1000,0,'test')`)
	if err != nil {
		t.Fatal(err)
	}
	inp, _ := json.Marshal(map[string]interface{}{"params": map[string]interface{}{"command": "ls"}})
	_, err = db.Exec(`INSERT INTO `+sqltables.TableAgentSpans+` (span_id, trace_id, name, span_type, workspace_name, input_json, is_complete)
 VALUES ('spb','trb','bash','tool','OpenClaw',?,0)`, string(inp))
	if err != nil {
		t.Fatal(err)
	}
	n, err := BackfillAgentExecCommands(db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("backfill inserted %d", n)
	}
	var cmd string
	if err := db.QueryRow(`SELECT command FROM `+sqltables.TableAgentExecCommands+` WHERE span_id='spb'`).Scan(&cmd); err != nil {
		t.Fatal(err)
	}
	if cmd == "" {
		t.Fatal("expected command")
	}
}

func TestResyncAgentExecCommands(t *testing.T) {
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
 VALUES ('t','OpenClaw','openclaw','main',1,2)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO ` + sqltables.TableAgentTraces + ` (trace_id, thread_id, workspace_name, project_name, trace_type, created_at_ms, is_complete, created_from)
 VALUES ('trr','t','OpenClaw','openclaw','external',5000,0,'test')`)
	if err != nil {
		t.Fatal(err)
	}
	inp, _ := json.Marshal(map[string]interface{}{"params": map[string]interface{}{"command": "echo hi"}})
	_, err = db.Exec(`INSERT INTO `+sqltables.TableAgentSpans+` (span_id, trace_id, name, span_type, workspace_name, input_json, is_complete, start_time_ms)
 VALUES ('spr','trr','bash','tool','OpenClaw',?,0,6000)`, string(inp))
	if err != nil {
		t.Fatal(err)
	}
	all0, sh0, ex0, err := ExecCommandsResyncDiagnostics(db)
	if err != nil {
		t.Fatal(err)
	}
	if all0 != 1 || sh0 != 1 || ex0 != 0 {
		t.Fatalf("diagnostics before: spans=%d shell=%d exec=%d", all0, sh0, ex0)
	}
	n, err := ResyncAgentExecCommands(db, ResyncExecCommandsOptions{Batch: 10})
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("first resync upserted=%d want 1", n)
	}
	n2, err := ResyncAgentExecCommands(db, ResyncExecCommandsOptions{Batch: 10})
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 1 {
		t.Fatalf("second resync upserted=%d want 1 (idempotent re-upsert)", n2)
	}
	since := int64(9999)
	n3, err := ResyncAgentExecCommands(db, ResyncExecCommandsOptions{Batch: 10, SinceMs: &since})
	if err != nil {
		t.Fatal(err)
	}
	if n3 != 0 {
		t.Fatalf("since filter upserted=%d want 0", n3)
	}
}
