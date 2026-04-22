package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"time"

	"iseeagentc/internal/migrate"
	"iseeagentc/internal/sqltables"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	// Connect to database
	db, err := sql.Open("sqlite3", "data/crabagent.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Enable foreign keys
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		log.Fatal(err)
	}

	// Run migrations to ensure tables exist
	if err := migrate.RunAgentTableMigrations(db); err != nil {
		log.Fatal(err)
	}

	// Clear existing data
	clearExistingData(db)

	// Insert test data
	insertTestData(db)

	fmt.Println("Test data inserted successfully!")
}

func clearExistingData(db *sql.DB) {
	tables := []string{
		sqltables.TableAgentExecCommands,
		sqltables.TableAgentSpans,
		sqltables.TableAgentTraces,
		sqltables.TableAgentThreads,
	}

	for _, table := range tables {
		if _, err := db.Exec(fmt.Sprintf("DELETE FROM %s", table)); err != nil {
			log.Printf("Warning: failed to clear %s: %v", table, err)
		}
	}
}

func insertTestData(db *sql.DB) {
	rand.Seed(time.Now().UnixNano())
	baseTime := time.Now().UnixMilli() - 86400000 // 24 hours ago

	// Insert threads
	threads := []struct {
		id, workspace, project, threadType string
	}{
		{"thread-001", "test-workspace", "test-project", "main"},
		{"thread-002", "test-workspace", "test-project", "main"},
		{"thread-003", "test-workspace", "test-project", "main"},
	}

	for _, t := range threads {
		_, err := db.Exec(`
			INSERT INTO `+sqltables.TableAgentThreads+` (thread_id, workspace_name, project_name, thread_type, first_seen_ms, last_seen_ms)
			VALUES (?, ?, ?, ?, ?, ?)`,
			t.id, t.workspace, t.project, t.threadType, baseTime, baseTime+3600000)
		if err != nil {
			log.Fatal(err)
		}
	}

	// Insert traces
	traces := []struct {
		id, threadId, workspace, project, traceType string
		createdAtMs                                 int64
	}{
		{"trace-loop-001", "thread-001", "test-workspace", "test-project", "external", baseTime + 1000},
		{"trace-loop-002", "thread-002", "test-workspace", "test-project", "external", baseTime + 2000},
		{"trace-token-001", "thread-003", "test-workspace", "test-project", "external", baseTime + 3000},
		{"trace-read-001", "thread-001", "test-workspace", "test-project", "external", baseTime + 4000},
		{"trace-normal-001", "thread-002", "test-workspace", "test-project", "external", baseTime + 5000},
	}

	for _, t := range traces {
		_, err := db.Exec(`
			INSERT INTO `+sqltables.TableAgentTraces+` (trace_id, thread_id, workspace_name, project_name, trace_type, created_at_ms, is_complete, created_from)
			VALUES (?, ?, ?, ?, ?, ?, 1, 'test')`,
			t.id, t.threadId, t.workspace, t.project, t.traceType, t.createdAtMs)
		if err != nil {
			log.Fatal(err)
		}
	}

	// Insert spans and exec commands
	execCommands := []struct {
		spanId, traceId, command, category string
		startTimeMs, durationMs            int64
		exitCode                           int
		stdoutLen, stderrLen               int
		estTokens                          int
		tokenRisk                          bool
		repeats                            int // for loop detection
	}{
		// Loop detection - same command repeated in same trace
		{"span-loop-001", "trace-loop-001", "ls -la", "file", baseTime + 1000, 100, 0, 1000, 0, 50, false, 5},
		{"span-loop-002", "trace-loop-001", "ls -la", "file", baseTime + 1100, 95, 0, 1000, 0, 50, false, 5},
		{"span-loop-003", "trace-loop-001", "ls -la", "file", baseTime + 1200, 98, 0, 1000, 0, 50, false, 5},
		{"span-loop-004", "trace-loop-001", "ls -la", "file", baseTime + 1300, 102, 0, 1000, 0, 50, false, 5},
		{"span-loop-005", "trace-loop-001", "ls -la", "file", baseTime + 1400, 97, 0, 1000, 0, 50, false, 5},

		// Another trace with different loop
		{"span-loop-006", "trace-loop-002", "ps aux", "process", baseTime + 2000, 150, 0, 2000, 0, 80, false, 3},
		{"span-loop-007", "trace-loop-002", "ps aux", "process", baseTime + 2150, 148, 0, 2000, 0, 80, false, 3},
		{"span-loop-008", "trace-loop-002", "ps aux", "process", baseTime + 2300, 152, 0, 2000, 0, 80, false, 3},

		// Token risk - large stdout
		{"span-token-001", "trace-token-001", "cat /var/log/system.log", "file", baseTime + 3000, 500, 0, 50000, 0, 2500, true, 1},
		{"span-token-002", "trace-token-001", "docker logs mycontainer", "system", baseTime + 3200, 800, 0, 80000, 0, 4000, true, 1},
		{"span-token-003", "trace-token-001", "kubectl get pods -o wide", "system", baseTime + 3500, 300, 0, 30000, 0, 1500, true, 1},

		// Redundant reads - same trace reading same file multiple times
		{"span-read-001", "trace-read-001", "cat /etc/hosts", "file", baseTime + 4000, 50, 0, 500, 0, 25, false, 4},
		{"span-read-002", "trace-read-001", "cat /etc/hosts", "file", baseTime + 4100, 48, 0, 500, 0, 25, false, 4},
		{"span-read-003", "trace-read-001", "cat /etc/hosts", "file", baseTime + 4200, 52, 0, 500, 0, 25, false, 4},
		{"span-read-004", "trace-read-001", "cat /etc/hosts", "file", baseTime + 4300, 49, 0, 500, 0, 25, false, 4},

		// Normal commands
		{"span-normal-001", "trace-normal-001", "git status", "system", baseTime + 5000, 200, 0, 100, 0, 5, false, 1},
		{"span-normal-002", "trace-normal-001", "npm install", "package", baseTime + 5200, 15000, 0, 200, 0, 10, false, 1},
		{"span-normal-003", "trace-normal-001", "echo 'hello'", "system", baseTime + 17000, 10, 0, 6, 0, 1, false, 1},
	}

	for _, cmd := range execCommands {
		// Insert span
		inputJSON, _ := json.Marshal(map[string]interface{}{
			"params": map[string]interface{}{
				"command": cmd.command,
			},
		})

		_, err := db.Exec(`
			INSERT INTO `+sqltables.TableAgentSpans+` (span_id, trace_id, name, span_type, workspace_name, input_json, is_complete, start_time_ms, end_time_ms, duration_ms)
			VALUES (?, ?, ?, 'tool', 'test-workspace', ?, 1, ?, ?, ?)`,
			cmd.spanId, cmd.traceId, "bash", string(inputJSON), cmd.startTimeMs, cmd.startTimeMs+cmd.durationMs, cmd.durationMs)
		if err != nil {
			log.Fatal(err)
		}

		// Insert exec command
		tokenRisk := 0
		if cmd.tokenRisk {
			tokenRisk = 1
		}

		_, err = db.Exec(`
			INSERT INTO `+sqltables.TableAgentExecCommands+` (
				span_id, trace_id, span_name, start_time_ms, end_time_ms, duration_ms,
				command, command_key, category, platform, exit_code, success,
				stdout_len, stderr_len, est_tokens, est_usd, token_risk,
				created_at_ms, updated_at_ms
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unix', ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
			cmd.spanId, cmd.traceId, "bash", cmd.startTimeMs, cmd.startTimeMs+cmd.durationMs, cmd.durationMs,
			cmd.command, cmd.command, cmd.category, cmd.exitCode,
			cmd.stdoutLen, cmd.stderrLen, cmd.estTokens, float64(cmd.estTokens)*0.0001, tokenRisk,
			baseTime, baseTime)
		if err != nil {
			log.Fatal(err)
		}
	}

	fmt.Printf("Inserted %d threads, %d traces, %d spans, %d exec commands\n",
		len(threads), len(traces), len(execCommands), len(execCommands))
}
