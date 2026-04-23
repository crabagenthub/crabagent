package ingest

import (
	"database/sql"
	"strings"
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

func TestApplyOpikBatchBackfillsSecurityAuditFromMetadata(t *testing.T) {
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

	body := map[string]interface{}{
		"threads": []interface{}{
			map[string]interface{}{
				"thread_id":      "th-sec-1",
				"workspace_name": "OpenClaw",
				"project_name":   "openclaw",
				"first_seen_ms":  float64(1),
				"last_seen_ms":   float64(2),
			},
		},
		"traces": []interface{}{
			map[string]interface{}{
				"trace_id":       "tr-sec-1",
				"thread_id":      "th-sec-1",
				"workspace_name": "OpenClaw",
				"project_name":   "openclaw",
				"created_at_ms":  float64(1000),
			},
		},
		"spans": []interface{}{
			map[string]interface{}{
				"span_id":        "sp-sec-1",
				"trace_id":       "tr-sec-1",
				"type":           "llm",
				"name":           "assistant",
				"workspace_name": "OpenClaw",
				"start_time_ms":  float64(100),
				"metadata": map[string]interface{}{
					"crabagent_interception": map[string]interface{}{
						"version":     float64(1),
						"hit_count":   float64(8),
						"intercepted": true,
						"mode":        "enforce",
						"policy_ids":  []interface{}{"pol-1776698194724", "pol-1776698182292"},
						"tags":        []interface{}{"手机号", "身份证号"},
					},
					"crabagent_interception_findings": []interface{}{
						map[string]interface{}{
							"policy_id":     "pol-1776698194724",
							"policy_name":   "手机号",
							"match_count":   float64(3),
							"policy_action": "abort_run",
							"redact_type":   "mask",
						},
						map[string]interface{}{
							"policy_id":     "pol-1776698182292",
							"policy_name":   "身份证号",
							"match_count":   float64(5),
							"policy_action": "abort_run",
							"redact_type":   "mask",
						},
					},
				},
			},
		},
	}

	if _, err := ApplyOpikBatch(db, body); err != nil {
		t.Fatal(err)
	}

	var traceID, spanID, findingsJSON string
	var hitCount, intercepted int
	err = db.QueryRow(
		`SELECT trace_id, COALESCE(span_id, ''), findings_json, hit_count, intercepted
		 FROM `+sqltables.TableAgentSecurityAuditLogs+` WHERE trace_id = ?`,
		"tr-sec-1",
	).Scan(&traceID, &spanID, &findingsJSON, &hitCount, &intercepted)
	if err != nil {
		t.Fatal(err)
	}
	if traceID != "tr-sec-1" || spanID != "sp-sec-1" {
		t.Fatalf("unexpected audit row trace=%q span=%q", traceID, spanID)
	}
	if hitCount != 8 || intercepted != 1 {
		t.Fatalf("unexpected audit summary hit_count=%d intercepted=%d", hitCount, intercepted)
	}
	if !strings.Contains(findingsJSON, "pol-1776698194724") || !strings.Contains(findingsJSON, "身份证号") {
		t.Fatalf("findings_json not backfilled from metadata: %s", findingsJSON)
	}
}

func TestApplyOpikBatchBackfillsSecurityAuditFromMergedPreviousMetadata(t *testing.T) {
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

	prevMeta := `{"crabagent_interception":{"version":1,"hit_count":2,"intercepted":true,"mode":"enforce","policy_ids":["pol-prev-1"],"tags":["手机号"]},"crabagent_interception_findings":[{"policy_id":"pol-prev-1","policy_name":"手机号","match_count":2,"policy_action":"abort_run","redact_type":"mask"}]}`
	if _, err := db.Exec(`INSERT INTO `+sqltables.TableAgentThreads+` (thread_id, workspace_name, project_name, first_seen_ms, last_seen_ms) VALUES (?, ?, ?, ?, ?)`,
		"th-prev-1", "OpenClaw", "openclaw", 1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO `+sqltables.TableAgentTraces+` (trace_id, thread_id, workspace_name, project_name, created_at_ms) VALUES (?, ?, ?, ?, ?)`,
		"tr-prev-1", "th-prev-1", "OpenClaw", "openclaw", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO `+sqltables.TableAgentSpans+` (span_id, trace_id, name, span_type, workspace_name, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`,
		"sp-prev-1", "tr-prev-1", "assistant", "llm", "OpenClaw", prevMeta); err != nil {
		t.Fatal(err)
	}

	body := map[string]interface{}{
		"threads": []interface{}{
			map[string]interface{}{
				"thread_id":      "th-prev-1",
				"workspace_name": "OpenClaw",
				"project_name":   "openclaw",
				"first_seen_ms":  float64(1),
				"last_seen_ms":   float64(3),
			},
		},
		"traces": []interface{}{
			map[string]interface{}{
				"trace_id":       "tr-prev-1",
				"thread_id":      "th-prev-1",
				"workspace_name": "OpenClaw",
				"project_name":   "openclaw",
				"created_at_ms":  float64(1000),
			},
		},
		"spans": []interface{}{
			map[string]interface{}{
				"span_id":        "sp-prev-1",
				"trace_id":       "tr-prev-1",
				"type":           "llm",
				"name":           "assistant",
				"workspace_name": "OpenClaw",
				"start_time_ms":  float64(120),
			},
		},
	}

	if _, err := ApplyOpikBatch(db, body); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM `+sqltables.TableAgentSecurityAuditLogs+` WHERE trace_id = ? AND span_id = ?`,
		"tr-prev-1", "sp-prev-1").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected merged previous metadata to backfill one audit row, got %d", n)
	}
}
