package ingest

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"iseeagentc/internal/migrate"
	"iseeagentc/internal/sqltables"
)

func TestApplyOpikBatchWritesAgentExecCommands(t *testing.T) {
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

	traceID := "tr-test-1"
	threadID := "th-1"
	body := map[string]interface{}{
		"threads": []interface{}{
			map[string]interface{}{
				"thread_id":     threadID,
				"workspace_name": "OpenClaw",
				"project_name":  "openclaw",
				"agent_name":    "ag1",
				"channel_name":  "ch1",
				"first_seen_ms": float64(1),
				"last_seen_ms":  float64(2),
			},
		},
		"traces": []interface{}{
			map[string]interface{}{
				"trace_id":       traceID,
				"thread_id":      threadID,
				"workspace_name": "OpenClaw",
				"project_name":   "openclaw",
				"created_at_ms":    float64(1000),
			},
		},
		"spans": []interface{}{
			map[string]interface{}{
				"span_id":        "sp-1",
				"trace_id":       traceID,
				"type":           "tool",
				"name":           "bash",
				"workspace_name": "OpenClaw",
				"start_time_ms":  float64(100),
				"input": map[string]interface{}{
					"params": map[string]interface{}{
						"command": "echo hi",
					},
				},
				"output": map[string]interface{}{
					"result": map[string]interface{}{
						"stdout": "hi\n",
					},
				},
			},
		},
	}
	res, err := ApplyOpikBatch(db, body)
	if err != nil {
		t.Fatal(err)
	}
	if res.Accepted.Spans != 1 {
		t.Fatalf("spans: %+v skipped: %#v", res.Accepted, res.Skipped)
	}
	var cmd, cat string
	err = db.QueryRow(`SELECT command, category FROM `+sqltables.TableAgentExecCommands+` WHERE span_id = ?`, "sp-1").Scan(&cmd, &cat)
	if err != nil {
		t.Fatal(err)
	}
	if cmd == "" {
		t.Fatal("empty command")
	}
}

func TestApplyOpikBatchDeletesExecWhenSpanNoLongerShell(t *testing.T) {
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
	traceID := "tr-2"
	threadID := "th-2"
	mk := func(cmd string) map[string]interface{} {
		return map[string]interface{}{
			"threads": []interface{}{
				map[string]interface{}{
					"thread_id": threadID, "workspace_name": "OpenClaw", "project_name": "openclaw",
					"first_seen_ms": float64(1), "last_seen_ms": float64(2),
				},
			},
			"traces": []interface{}{
				map[string]interface{}{
					"trace_id": traceID, "thread_id": threadID, "workspace_name": "OpenClaw", "project_name": "openclaw",
					"created_at_ms": float64(1000),
				},
			},
			"spans": []interface{}{
				map[string]interface{}{
					"span_id": "sp-x", "trace_id": traceID, "type": "tool", "name": "bash", "workspace_name": "OpenClaw",
					"input": map[string]interface{}{"params": map[string]interface{}{"command": cmd}},
				},
			},
		}
	}
	if _, err := ApplyOpikBatch(db, mk("echo a")); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM `+sqltables.TableAgentExecCommands+` WHERE span_id = 'sp-x'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("want 1 row got %d err %v", n, err)
	}
	// Second batch: same span id but non-shell tool name and no command in input
	body2 := mk("echo a")
	spans := body2["spans"].([]interface{})
	sp := spans[0].(map[string]interface{})
	sp["name"] = "read_file"
	sp["input"] = map[string]interface{}{"params": map[string]interface{}{"path": "/x"}}
	if _, err := ApplyOpikBatch(db, body2); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM `+sqltables.TableAgentExecCommands+` WHERE span_id = 'sp-x'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("want 0 rows got %d err %v", n, err)
	}
}
