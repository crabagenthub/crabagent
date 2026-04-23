package migrate

import (
	"database/sql"
	"fmt"
	"strings"

	"iseeagentc/internal/sqltables"
	"iseeagentc/internal/sqlutil"
)

func tableExists(db *sql.DB, name string) (bool, error) {
	if sqlutil.IsSQLite(db) {
		var n int
		err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n)
		return n > 0, err
	}
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
		strings.ToLower(name),
	).Scan(&n)
	return n > 0, err
}

type renamePair struct {
	old string
	new string
}

// RunAgentTableMigrations renames legacy tables to agent_* names, drops unused
// resource_audit_configs, and creates SQLite schema when the DB is empty.
// 增量 DDL（如新表 agent_exec_commands）追加在本包后，可单独执行：go run ./cmd/agent-migrate -env=dev
// 或 make migrate（见 iseeagentc/Makefile、scripts/agent-db-migrate.sh）。
func RunAgentTableMigrations(db *sql.DB) error {
	if db == nil {
		return nil
	}

	// Children of traces first, then traces, then threads; then auxiliary tables; then security.
	pairs := []renamePair{
		{sqltables.LegacyTableOpikSpans, sqltables.TableAgentSpans},
		{sqltables.LegacyTableOpikTraceFeedback, sqltables.TableAgentTraceFeedback},
		{sqltables.LegacyTableOpikAttachments, sqltables.TableAgentAttachments},
		{sqltables.LegacyTableOpikTraces, sqltables.TableAgentTraces},
		{sqltables.LegacyTableOpikThreads, sqltables.TableAgentThreads},
		{sqltables.LegacyTableOpikRawIngest, sqltables.TableAgentRawIngest},
		{sqltables.LegacyTableSecurityAuditLogs, sqltables.TableAgentSecurityAuditLogs},
		{sqltables.LegacyTableInterceptionPolicies, sqltables.TableAgentSecurityPolicies},
	}

	for _, p := range pairs {
		hasNew, err := tableExists(db, p.new)
		if err != nil {
			return fmt.Errorf("migrate: check table %q: %w", p.new, err)
		}
		if hasNew {
			continue
		}
		hasOld, err := tableExists(db, p.old)
		if err != nil {
			return fmt.Errorf("migrate: check table %q: %w", p.old, err)
		}
		if !hasOld {
			continue
		}
		q := fmt.Sprintf(`ALTER TABLE %s RENAME TO %s`, quoteIdent(db, p.old), quoteIdent(db, p.new))
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("migrate: %s: %w", q, err)
		}
	}

	if _, err := db.Exec(fmt.Sprintf(
		`DROP TABLE IF EXISTS %s`,
		quoteIdent(db, sqltables.LegacyResourceAuditConfigs),
	)); err != nil {
		return fmt.Errorf("migrate: drop resource_audit_configs: %w", err)
	}

	hasCore, err := tableExists(db, sqltables.TableAgentTraces)
	if err != nil {
		return err
	}
	if hasCore {
		if err := ensureAgentExecCommandsTable(db); err != nil {
			return err
		}
		if err := ensureAgentSecurityPoliciesPulledAtMsColumn(db); err != nil {
			return err
		}
		if err := ensureAgentResourceAccessTable(db); err != nil {
			return err
		}
		if err := ensureAgentResourceAccessColumns(db); err != nil {
			return err
		}
		if err := ensureAgentAlertRulesTable(db); err != nil {
			return err
		}
		if err := ensureAgentAlertEventsTable(db); err != nil {
			return err
		}
		return ensureAgentAlertEventsWsFiredIndex(db)
	}
	if sqlutil.IsSQLite(db) {
		return execSQLiteAgentSchema(db)
	}
	return execPostgresAgentSchema(db)
}

func quoteIdent(db *sql.DB, name string) string {
	if sqlutil.IsSQLite(db) {
		return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// ensureAgentExecCommandsTable creates agent_exec_commands on existing DBs (empty DBs get it via full DDL).
func ensureAgentExecCommandsTable(db *sql.DB) error {
	has, err := tableExists(db, sqltables.TableAgentExecCommands)
	if err != nil {
		return fmt.Errorf("migrate: check exec commands table: %w", err)
	}
	if has {
		return nil
	}
	ec := quoteIdent(db, sqltables.TableAgentExecCommands)
	tr := quoteIdent(db, sqltables.TableAgentTraces)
	var ddl string
	if sqlutil.IsSQLite(db) {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES %s(trace_id) ON DELETE CASCADE,
  parent_span_id TEXT,
  workspace_name TEXT,
  project_name TEXT,
  thread_key TEXT,
  agent_name TEXT,
  channel_name TEXT,
  span_name TEXT NOT NULL DEFAULT '',
  start_time_ms INTEGER,
  end_time_ms INTEGER,
  duration_ms INTEGER,
  command TEXT NOT NULL DEFAULT '',
  command_key TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  platform TEXT NOT NULL DEFAULT 'unix',
  exit_code INTEGER,
  success INTEGER,
  stdout_len INTEGER NOT NULL DEFAULT 0,
  stderr_len INTEGER NOT NULL DEFAULT 0,
  est_tokens INTEGER NOT NULL DEFAULT 0,
  est_usd REAL NOT NULL DEFAULT 0,
  token_risk INTEGER NOT NULL DEFAULT 0 CHECK (token_risk IN (0, 1)),
  command_not_found INTEGER NOT NULL DEFAULT 0 CHECK (command_not_found IN (0, 1)),
  permission_denied INTEGER NOT NULL DEFAULT 0 CHECK (permission_denied IN (0, 1)),
  illegal_arg_hint INTEGER NOT NULL DEFAULT 0 CHECK (illegal_arg_hint IN (0, 1)),
  cwd TEXT,
  env_keys_json TEXT,
  user_id TEXT,
  host TEXT,
  parser_version INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER
);
CREATE INDEX idx_agent_exec_commands_trace ON %s(trace_id);
CREATE INDEX idx_agent_exec_commands_start ON %s(start_time_ms DESC);
CREATE INDEX idx_agent_exec_commands_category ON %s(category);
`, ec, tr, ec, ec, ec)
	} else {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES %s(trace_id) ON DELETE CASCADE,
  parent_span_id TEXT,
  workspace_name TEXT,
  project_name TEXT,
  thread_key TEXT,
  agent_name TEXT,
  channel_name TEXT,
  span_name TEXT NOT NULL DEFAULT '',
  start_time_ms BIGINT,
  end_time_ms BIGINT,
  duration_ms BIGINT,
  command TEXT NOT NULL DEFAULT '',
  command_key TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  platform TEXT NOT NULL DEFAULT 'unix',
  exit_code INTEGER,
  success INTEGER,
  stdout_len INTEGER NOT NULL DEFAULT 0,
  stderr_len INTEGER NOT NULL DEFAULT 0,
  est_tokens INTEGER NOT NULL DEFAULT 0,
  est_usd REAL NOT NULL DEFAULT 0,
  token_risk INTEGER NOT NULL DEFAULT 0 CHECK (token_risk IN (0, 1)),
  command_not_found INTEGER NOT NULL DEFAULT 0 CHECK (command_not_found IN (0, 1)),
  permission_denied INTEGER NOT NULL DEFAULT 0 CHECK (permission_denied IN (0, 1)),
  illegal_arg_hint INTEGER NOT NULL DEFAULT 0 CHECK (illegal_arg_hint IN (0, 1)),
  cwd TEXT,
  env_keys_json TEXT,
  user_id TEXT,
  host TEXT,
  parser_version INTEGER NOT NULL DEFAULT 1,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT
);
CREATE INDEX idx_agent_exec_commands_trace ON %s(trace_id);
CREATE INDEX idx_agent_exec_commands_start ON %s(start_time_ms DESC);
CREATE INDEX idx_agent_exec_commands_category ON %s(category);
`, ec, tr, ec, ec, ec)
	}
	if _, err := db.Exec(ddl); err != nil {
		return fmt.Errorf("migrate: create exec commands table: %w", err)
	}
	return nil
}

// ensureAgentSecurityPoliciesPulledAtMsColumn adds pulled_at_ms column if it doesn't exist
func ensureAgentSecurityPoliciesPulledAtMsColumn(db *sql.DB) error {
	pol := quoteIdent(db, sqltables.TableAgentSecurityPolicies)

	// Check if column exists
	var colExists bool
	if sqlutil.IsSQLite(db) {
		// SQLite: use PRAGMA to check if column exists
		rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, pol))
		if err != nil {
			return fmt.Errorf("migrate: check pulled_at_ms column: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, dataType string
			var notNull, pk int
			var dfltValue sql.NullString
			if err := rows.Scan(&cid, &name, &dataType, &notNull, &dfltValue, &pk); err != nil {
				return fmt.Errorf("migrate: scan column info: %w", err)
			}
			if name == "pulled_at_ms" {
				colExists = true
				break
			}
		}
		if !colExists {
			if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN pulled_at_ms INTEGER`, pol)); err != nil {
				return fmt.Errorf("migrate: add pulled_at_ms column: %w", err)
			}
		}
	} else {
		// PostgreSQL: check information_schema
		err := db.QueryRow(`
			SELECT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name = $1 AND column_name = $2
			)`, sqltables.TableAgentSecurityPolicies, "pulled_at_ms").Scan(&colExists)
		if err != nil {
			return fmt.Errorf("migrate: check pulled_at_ms column: %w", err)
		}
		if !colExists {
			if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN pulled_at_ms BIGINT`, pol)); err != nil {
				return fmt.Errorf("migrate: add pulled_at_ms column: %w", err)
			}
		}
	}
	return nil
}

// ensureAgentResourceAccessColumns adds missing columns to agent_resource_access table
func ensureAgentResourceAccessColumns(db *sql.DB) error {
	ra := quoteIdent(db, sqltables.TableAgentResourceAccess)

	// Required columns that should exist
	requiredColumns := map[string]string{
		"resource_uri":      "TEXT NOT NULL DEFAULT ''",
		"access_mode":       "TEXT NOT NULL DEFAULT 'read'",
		"semantic_kind":     "TEXT NOT NULL DEFAULT 'other'",
		"chars":             "INTEGER NOT NULL DEFAULT 0",
		"snippet":           "TEXT",
		"uri_repeat_count":  "INTEGER NOT NULL DEFAULT 0",
		"risk_flags":        "TEXT NOT NULL DEFAULT ''",
		"policy_hint_flags": "TEXT NOT NULL DEFAULT ''",
	}

	var existingCols []string
	if sqlutil.IsSQLite(db) {
		// SQLite: use PRAGMA to get column info
		rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, ra))
		if err != nil {
			return fmt.Errorf("migrate: check resource access columns: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, dataType string
			var notNull, pk int
			var dfltValue sql.NullString
			if err := rows.Scan(&cid, &name, &dataType, &notNull, &dfltValue, &pk); err != nil {
				return fmt.Errorf("migrate: scan column info: %w", err)
			}
			existingCols = append(existingCols, name)
		}
	} else {
		// PostgreSQL: check information_schema
		rows, err := db.Query(`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_name = $1
		`, sqltables.TableAgentResourceAccess)
		if err != nil {
			return fmt.Errorf("migrate: check resource access columns: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return fmt.Errorf("migrate: scan column info: %w", err)
			}
			existingCols = append(existingCols, name)
		}
	}

	// Check which columns are missing and add them
	existingMap := make(map[string]bool)
	for _, col := range existingCols {
		existingMap[col] = true
	}

	for colName, colDef := range requiredColumns {
		if !existingMap[colName] {
			colType := "INTEGER"
			if sqlutil.IsSQLite(db) {
				colType = colDef
			} else {
				// Convert SQLite types to PostgreSQL types
				if strings.Contains(colDef, "TEXT") {
					colType = "TEXT"
				} else if strings.Contains(colDef, "INTEGER") {
					colType = "BIGINT"
				}
			}
			if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, ra, colName, colType)); err != nil {
				return fmt.Errorf("migrate: add column %s: %w", colName, err)
			}
		}
	}

	return nil
}

// ensureAgentResourceAccessTable creates agent_resource_access on existing DBs (empty DBs get it via full DDL).
func ensureAgentResourceAccessTable(db *sql.DB) error {
	has, err := tableExists(db, sqltables.TableAgentResourceAccess)
	if err != nil {
		return fmt.Errorf("migrate: check resource access table: %w", err)
	}
	if has {
		return nil
	}
	ra := quoteIdent(db, sqltables.TableAgentResourceAccess)
	tr := quoteIdent(db, sqltables.TableAgentTraces)
	var ddl string
	if sqlutil.IsSQLite(db) {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES %s(trace_id) ON DELETE CASCADE,
  workspace_name TEXT,
  project_name TEXT,
  thread_key TEXT,
  agent_name TEXT,
  channel_name TEXT,
  span_name TEXT NOT NULL DEFAULT '',
  start_time_ms INTEGER,
  end_time_ms INTEGER,
  duration_ms INTEGER,
  resource_uri TEXT NOT NULL DEFAULT '',
  access_mode TEXT NOT NULL DEFAULT 'read',
  semantic_kind TEXT NOT NULL DEFAULT 'other',
  chars INTEGER NOT NULL DEFAULT 0,
  snippet TEXT,
  uri_repeat_count INTEGER NOT NULL DEFAULT 0,
  risk_flags TEXT NOT NULL DEFAULT '',
  policy_hint_flags TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms
);
CREATE INDEX idx_agent_resource_access_trace ON %s(trace_id);
CREATE INDEX idx_agent_resource_access_start ON %s(start_time_ms DESC);
CREATE INDEX idx_agent_resource_access_semantic ON %s(semantic_kind);
CREATE INDEX idx_agent_resource_access_uri ON %s(resource_uri);
`, ra, tr, ra, ra, ra, ra)
	} else {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES %s(trace_id) ON DELETE CASCADE,
  workspace_name TEXT,
  project_name TEXT,
  thread_key TEXT,
  agent_name TEXT,
  channel_name TEXT,
  span_name TEXT NOT NULL DEFAULT '',
  start_time_ms BIGINT,
  end_time_ms BIGINT,
  duration_ms BIGINT,
  resource_uri TEXT NOT NULL DEFAULT '',
  access_mode TEXT NOT NULL DEFAULT 'read',
  semantic_kind TEXT NOT NULL DEFAULT 'other',
  chars INTEGER NOT NULL DEFAULT 0,
  snippet TEXT,
  uri_repeat_count INTEGER NOT NULL DEFAULT 0,
  risk_flags TEXT NOT NULL DEFAULT '',
  policy_hint_flags TEXT NOT NULL DEFAULT '',
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT
);
CREATE INDEX idx_agent_resource_access_trace ON %s(trace_id);
CREATE INDEX idx_agent_resource_access_start ON %s(start_time_ms DESC);
CREATE INDEX idx_agent_resource_access_semantic ON %s(semantic_kind);
CREATE INDEX idx_agent_resource_access_uri ON %s(resource_uri);
`, ra, tr, ra, ra, ra, ra)
	}
	if _, err := db.Exec(ddl); err != nil {
		return fmt.Errorf("migrate: create %s: %w", sqltables.TableAgentResourceAccess, err)
	}
	return nil
}

func ensureAgentAlertRulesTable(db *sql.DB) error {
	has, err := tableExists(db, sqltables.TableAgentAlertRules)
	if err != nil {
		return fmt.Errorf("migrate: check alert rules table: %w", err)
	}
	if has {
		return nil
	}
	ar := quoteIdent(db, sqltables.TableAgentAlertRules)
	var ddl string
	if sqlutil.IsSQLite(db) {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  id TEXT PRIMARY KEY,
  workspace_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  alert_code TEXT,
  severity TEXT,
  aggregate_key TEXT,
  condition_summary TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  metric_key TEXT NOT NULL DEFAULT 'error_rate_pct',
  operator TEXT NOT NULL DEFAULT 'gt',
  threshold REAL NOT NULL DEFAULT 0,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  delivery TEXT NOT NULL DEFAULT 'webhook',
  webhook_type TEXT NOT NULL DEFAULT 'generic',
  webhook_url TEXT NOT NULL DEFAULT '',
  advanced_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_agent_alert_rules_ws ON %s(workspace_name);
CREATE INDEX idx_agent_alert_rules_enabled ON %s(enabled);
`, ar, ar, ar)
	} else {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  id TEXT PRIMARY KEY,
  workspace_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  alert_code TEXT,
  severity TEXT,
  aggregate_key TEXT,
  condition_summary TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  metric_key TEXT NOT NULL DEFAULT 'error_rate_pct',
  operator TEXT NOT NULL DEFAULT 'gt',
  threshold DOUBLE PRECISION NOT NULL DEFAULT 0,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  delivery TEXT NOT NULL DEFAULT 'webhook',
  webhook_type TEXT NOT NULL DEFAULT 'generic',
  webhook_url TEXT NOT NULL DEFAULT '',
  advanced_json TEXT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL
);
CREATE INDEX idx_agent_alert_rules_ws ON %s(workspace_name);
CREATE INDEX idx_agent_alert_rules_enabled ON %s(enabled);
`, ar, ar, ar)
	}
	if _, err := db.Exec(ddl); err != nil {
		return fmt.Errorf("migrate: create %s: %w", sqltables.TableAgentAlertRules, err)
	}
	return nil
}

func ensureAgentAlertEventsTable(db *sql.DB) error {
	has, err := tableExists(db, sqltables.TableAgentAlertEvents)
	if err != nil {
		return fmt.Errorf("migrate: check alert events table: %w", err)
	}
	if has {
		return nil
	}
	ae := quoteIdent(db, sqltables.TableAgentAlertEvents)
	ar := quoteIdent(db, sqltables.TableAgentAlertRules)
	var ddl string
	if sqlutil.IsSQLite(db) {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  id TEXT PRIMARY KEY,
  workspace_name TEXT NOT NULL DEFAULT '',
  rule_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'evaluate',
  fired_at_ms INTEGER NOT NULL,
  summary TEXT,
  condition_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_text TEXT,
  breached INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT
);
CREATE INDEX idx_agent_alert_events_rule ON %s(rule_id, fired_at_ms DESC);
CREATE INDEX idx_agent_alert_events_ws ON %s(workspace_name);
`, ae, ae, ae)
	} else {
		ddl = fmt.Sprintf(`
CREATE TABLE %s (
  id TEXT PRIMARY KEY,
  workspace_name TEXT NOT NULL DEFAULT '',
  rule_id TEXT NOT NULL REFERENCES %s(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'evaluate',
  fired_at_ms BIGINT NOT NULL,
  summary TEXT,
  condition_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_text TEXT,
  breached INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT
);
CREATE INDEX idx_agent_alert_events_rule ON %s(rule_id, fired_at_ms DESC);
CREATE INDEX idx_agent_alert_events_ws ON %s(workspace_name);
`, ae, ar, ae, ae)
	}
	if _, err := db.Exec(ddl); err != nil {
		return fmt.Errorf("migrate: create %s: %w", sqltables.TableAgentAlertEvents, err)
	}
	return nil
}

// ensureAgentAlertEventsWsFiredIndex adds a composite index for list-by-workspace + time (alert history API).
func ensureAgentAlertEventsWsFiredIndex(db *sql.DB) error {
	has, err := tableExists(db, sqltables.TableAgentAlertEvents)
	if err != nil {
		return fmt.Errorf("migrate: check alert events: %w", err)
	}
	if !has {
		return nil
	}
	ae := quoteIdent(db, sqltables.TableAgentAlertEvents)
	q := fmt.Sprintf(`CREATE INDEX IF NOT EXISTS idx_agent_alert_events_ws_fired ON %s (workspace_name, fired_at_ms DESC)`, ae)
	if _, err := db.Exec(q); err != nil {
		return fmt.Errorf("migrate: idx_agent_alert_events_ws_fired: %w", err)
	}
	return nil
}

func execSQLiteAgentSchema(db *sql.DB) error {
	ddl := sqliteAgentSchemaDDL()
	_, err := db.Exec(ddl)
	return err
}

func execPostgresAgentSchema(db *sql.DB) error {
	ddl := postgresAgentSchemaDDL()
	_, err := db.Exec(ddl)
	return err
}

// sqliteAgentSchemaDDL mirrors services/collector db.ts opik schema with agent_* table names.
func sqliteAgentSchemaDDL() string {
	th, tr, sp := sqltables.TableAgentThreads, sqltables.TableAgentTraces, sqltables.TableAgentSpans
	at, fb, raw := sqltables.TableAgentAttachments, sqltables.TableAgentTraceFeedback, sqltables.TableAgentRawIngest
	pol, sal := sqltables.TableAgentSecurityPolicies, sqltables.TableAgentSecurityAuditLogs
	ec := sqltables.TableAgentExecCommands
	ra := sqltables.TableAgentResourceAccess

	return fmt.Sprintf(`
    CREATE TABLE %[1]s (
      thread_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      thread_type TEXT NOT NULL DEFAULT 'main'
        CHECK (thread_type IN ('main', 'subagent')),
      parent_thread_id TEXT,
      first_seen_ms INTEGER NOT NULL,
      last_seen_ms INTEGER NOT NULL,
      metadata_json TEXT,
      agent_name TEXT,
      channel_name TEXT,
      PRIMARY KEY (thread_id, workspace_name, project_name),
      FOREIGN KEY (parent_thread_id, workspace_name, project_name)
        REFERENCES %[1]s (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_agent_threads_last_seen ON %[1]s(last_seen_ms DESC);
    CREATE INDEX idx_agent_threads_parent ON %[1]s (workspace_name, project_name, parent_thread_id);

    CREATE TABLE %[2]s (
      trace_id TEXT PRIMARY KEY,
      thread_id TEXT,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      trace_type TEXT NOT NULL DEFAULT 'external'
        CHECK (trace_type IN ('external', 'subagent', 'async_command', 'system')),
      subagent_thread_id TEXT,
      name TEXT,
      input_json TEXT,
      output_json TEXT,
      metadata_json TEXT,
      setting_json TEXT,
      error_info_json TEXT,
      success INTEGER,
      duration_ms INTEGER,
      total_cost REAL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER,
      ended_at_ms INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
      created_from TEXT NOT NULL DEFAULT 'openclaw-iseeu',
      FOREIGN KEY (thread_id, workspace_name, project_name)
        REFERENCES %[1]s (thread_id, workspace_name, project_name)
        ON DELETE SET NULL,
      FOREIGN KEY (subagent_thread_id, workspace_name, project_name)
        REFERENCES %[1]s (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_agent_traces_thread ON %[2]s(thread_id, workspace_name, project_name);
    CREATE INDEX idx_agent_traces_project ON %[2]s(workspace_name, project_name, created_at_ms DESC);
    CREATE INDEX idx_agent_traces_created ON %[2]s(created_at_ms DESC);
    CREATE INDEX idx_agent_traces_complete ON %[2]s(is_complete, ended_at_ms);
    CREATE INDEX idx_agent_traces_subagent_thread ON %[2]s(subagent_thread_id);
    CREATE INDEX idx_agent_traces_type_created ON %[2]s(trace_type, created_at_ms DESC);

    CREATE TABLE %[3]s (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      parent_span_id TEXT REFERENCES %[3]s(span_id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      span_type TEXT NOT NULL DEFAULT 'general'
        CHECK (span_type IN ('general', 'tool', 'llm', 'guardrail')),
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      duration_ms INTEGER,
      metadata_json TEXT,
      input_json TEXT,
      output_json TEXT,
      setting_json TEXT,
      usage_json TEXT,
      usage_preview TEXT,
      model TEXT,
      provider TEXT,
      error_info_json TEXT,
      status TEXT,
      total_cost REAL,
      sort_index INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1))
    );
    CREATE INDEX idx_agent_spans_trace ON %[3]s(trace_id);
    CREATE INDEX idx_agent_spans_parent ON %[3]s(parent_span_id);
    CREATE INDEX idx_agent_spans_type ON %[3]s(span_type);
    CREATE INDEX idx_agent_spans_type_start ON %[3]s(span_type, start_time_ms DESC);

    CREATE TABLE %[4]s (
      attachment_id TEXT PRIMARY KEY,
      trace_id TEXT REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      span_id TEXT REFERENCES %[3]s(span_id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('trace', 'span')),
      content_type TEXT,
      file_name TEXT,
      url TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX idx_agent_attachments_trace ON %[4]s(trace_id);
    CREATE INDEX idx_agent_attachments_span ON %[4]s(span_id);

    CREATE TABLE %[5]s (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      score_name TEXT NOT NULL,
      value REAL NOT NULL,
      category_name TEXT,
      reason TEXT,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX idx_agent_feedback_trace ON %[5]s(trace_id);

    CREATE TABLE %[6]s (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at_ms INTEGER NOT NULL,
      route TEXT,
      trace_id TEXT,
      span_id TEXT,
      body_json TEXT NOT NULL
    );
    CREATE INDEX idx_agent_raw_trace ON %[6]s(trace_id);
    CREATE INDEX idx_agent_raw_received ON %[6]s(received_at_ms DESC);

    CREATE TABLE %[7]s (
      id TEXT PRIMARY KEY,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      name TEXT NOT NULL,
      description TEXT,
      pattern TEXT NOT NULL,
      redact_type TEXT NOT NULL CHECK (redact_type IN ('mask', 'hash', 'block')),
      targets_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      severity TEXT DEFAULT 'high',
      policy_action TEXT DEFAULT 'data_mask',
      intercept_mode TEXT DEFAULT 'enforce',
      hint_type TEXT,
      detection_kind TEXT NOT NULL DEFAULT 'regex' CHECK (detection_kind IN ('regex', 'model')),
      created_at_ms INTEGER,
      pulled_at_ms INTEGER,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE %[8]s (
      id TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      trace_id TEXT NOT NULL,
      span_id TEXT,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      findings_json TEXT NOT NULL DEFAULT '[]',
      total_findings INTEGER NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      intercepted INTEGER NOT NULL DEFAULT 0 CHECK (intercepted IN (0, 1)),
      observe_only INTEGER NOT NULL DEFAULT 0 CHECK (observe_only IN (0, 1))
    );
    CREATE INDEX idx_agent_security_audit_trace ON %[8]s(trace_id);
    CREATE INDEX idx_agent_security_audit_created ON %[8]s(created_at_ms DESC);
    CREATE INDEX idx_agent_security_audit_span ON %[8]s(span_id);

    CREATE TABLE %[9]s (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      parent_span_id TEXT,
      workspace_name TEXT,
      project_name TEXT,
      thread_key TEXT,
      agent_name TEXT,
      channel_name TEXT,
      span_name TEXT NOT NULL DEFAULT '',
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      duration_ms INTEGER,
      command TEXT NOT NULL DEFAULT '',
      command_key TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      platform TEXT NOT NULL DEFAULT 'unix',
      exit_code INTEGER,
      success INTEGER,
      stdout_len INTEGER NOT NULL DEFAULT 0,
      stderr_len INTEGER NOT NULL DEFAULT 0,
      est_tokens INTEGER NOT NULL DEFAULT 0,
      est_usd REAL NOT NULL DEFAULT 0,
      token_risk INTEGER NOT NULL DEFAULT 0 CHECK (token_risk IN (0, 1)),
      command_not_found INTEGER NOT NULL DEFAULT 0 CHECK (command_not_found IN (0, 1)),
      permission_denied INTEGER NOT NULL DEFAULT 0 CHECK (permission_denied IN (0, 1)),
      illegal_arg_hint INTEGER NOT NULL DEFAULT 0 CHECK (illegal_arg_hint IN (0, 1)),
      cwd TEXT,
      env_keys_json TEXT,
      user_id TEXT,
      host TEXT,
      parser_version INTEGER NOT NULL DEFAULT 1,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER
    );
    CREATE INDEX idx_agent_exec_commands_trace ON %[9]s(trace_id);
    CREATE INDEX idx_agent_exec_commands_start ON %[9]s(start_time_ms DESC);
    CREATE INDEX idx_agent_exec_commands_category ON %[9]s(category);

    CREATE TABLE %[10]s (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      workspace_name TEXT,
      project_name TEXT,
      thread_key TEXT,
      agent_name TEXT,
      channel_name TEXT,
      span_name TEXT NOT NULL DEFAULT '',
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      duration_ms INTEGER,
      resource_uri TEXT NOT NULL DEFAULT '',
      access_mode TEXT NOT NULL DEFAULT 'read',
      semantic_kind TEXT NOT NULL DEFAULT 'other',
      chars INTEGER NOT NULL DEFAULT 0,
      snippet TEXT,
      uri_repeat_count INTEGER NOT NULL DEFAULT 0,
      risk_flags TEXT NOT NULL DEFAULT '',
      policy_hint_flags TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER
    );
    CREATE INDEX idx_agent_resource_access_trace ON %[10]s(trace_id);
    CREATE INDEX idx_agent_resource_access_start ON %[10]s(start_time_ms DESC);
    CREATE INDEX idx_agent_resource_access_semantic ON %[10]s(semantic_kind);
    CREATE INDEX idx_agent_resource_access_uri ON %[10]s(resource_uri);
`, th, tr, sp, at, fb, raw, pol, sal, ec, ra)
}

// postgresAgentSchemaDDL creates agent_* tables on an empty PostgreSQL database.
func postgresAgentSchemaDDL() string {
	th, tr, sp := sqltables.TableAgentThreads, sqltables.TableAgentTraces, sqltables.TableAgentSpans
	at, fb, raw := sqltables.TableAgentAttachments, sqltables.TableAgentTraceFeedback, sqltables.TableAgentRawIngest
	pol, sal := sqltables.TableAgentSecurityPolicies, sqltables.TableAgentSecurityAuditLogs
	ec := sqltables.TableAgentExecCommands
	ra := sqltables.TableAgentResourceAccess

	return fmt.Sprintf(`
    CREATE TABLE %[1]s (
      thread_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      thread_type TEXT NOT NULL DEFAULT 'main'
        CHECK (thread_type IN ('main', 'subagent')),
      parent_thread_id TEXT,
      first_seen_ms BIGINT NOT NULL,
      last_seen_ms BIGINT NOT NULL,
      metadata_json TEXT,
      agent_name TEXT,
      channel_name TEXT,
      PRIMARY KEY (thread_id, workspace_name, project_name),
      FOREIGN KEY (parent_thread_id, workspace_name, project_name)
        REFERENCES %[1]s (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_agent_threads_last_seen ON %[1]s(last_seen_ms DESC);
    CREATE INDEX idx_agent_threads_parent ON %[1]s (workspace_name, project_name, parent_thread_id);

    CREATE TABLE %[2]s (
      trace_id TEXT PRIMARY KEY,
      thread_id TEXT,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      trace_type TEXT NOT NULL DEFAULT 'external'
        CHECK (trace_type IN ('external', 'subagent', 'async_command', 'system')),
      subagent_thread_id TEXT,
      name TEXT,
      input_json TEXT,
      output_json TEXT,
      metadata_json TEXT,
      setting_json TEXT,
      error_info_json TEXT,
      success INTEGER,
      duration_ms BIGINT,
      total_cost DOUBLE PRECISION,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT,
      ended_at_ms BIGINT,
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
      created_from TEXT NOT NULL DEFAULT 'openclaw-iseeu',
      FOREIGN KEY (thread_id, workspace_name, project_name)
        REFERENCES %[1]s (thread_id, workspace_name, project_name)
        ON DELETE SET NULL,
      FOREIGN KEY (subagent_thread_id, workspace_name, project_name)
        REFERENCES %[1]s (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_agent_traces_thread ON %[2]s(thread_id, workspace_name, project_name);
    CREATE INDEX idx_agent_traces_project ON %[2]s(workspace_name, project_name, created_at_ms DESC);
    CREATE INDEX idx_agent_traces_created ON %[2]s(created_at_ms DESC);
    CREATE INDEX idx_agent_traces_complete ON %[2]s(is_complete, ended_at_ms);
    CREATE INDEX idx_agent_traces_subagent_thread ON %[2]s(subagent_thread_id);
    CREATE INDEX idx_agent_traces_type_created ON %[2]s(trace_type, created_at_ms DESC);

    CREATE TABLE %[3]s (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      parent_span_id TEXT REFERENCES %[3]s(span_id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      span_type TEXT NOT NULL DEFAULT 'general'
        CHECK (span_type IN ('general', 'tool', 'llm', 'guardrail')),
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      start_time_ms BIGINT,
      end_time_ms BIGINT,
      duration_ms BIGINT,
      metadata_json TEXT,
      input_json TEXT,
      output_json TEXT,
      setting_json TEXT,
      usage_json TEXT,
      usage_preview TEXT,
      model TEXT,
      provider TEXT,
      error_info_json TEXT,
      status TEXT,
      total_cost DOUBLE PRECISION,
      sort_index INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1))
    );
    CREATE INDEX idx_agent_spans_trace ON %[3]s(trace_id);
    CREATE INDEX idx_agent_spans_parent ON %[3]s(parent_span_id);
    CREATE INDEX idx_agent_spans_type ON %[3]s(span_type);
    CREATE INDEX idx_agent_spans_type_start ON %[3]s(span_type, start_time_ms DESC);

    CREATE TABLE %[4]s (
      attachment_id TEXT PRIMARY KEY,
      trace_id TEXT REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      span_id TEXT REFERENCES %[3]s(span_id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('trace', 'span')),
      content_type TEXT,
      file_name TEXT,
      url TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX idx_agent_attachments_trace ON %[4]s(trace_id);
    CREATE INDEX idx_agent_attachments_span ON %[4]s(span_id);

    CREATE TABLE %[5]s (
      id SERIAL PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      score_name TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      category_name TEXT,
      reason TEXT,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX idx_agent_feedback_trace ON %[5]s(trace_id);

    CREATE TABLE %[6]s (
      id SERIAL PRIMARY KEY,
      received_at_ms BIGINT NOT NULL,
      route TEXT,
      trace_id TEXT,
      span_id TEXT,
      body_json TEXT NOT NULL
    );
    CREATE INDEX idx_agent_raw_trace ON %[6]s(trace_id);
    CREATE INDEX idx_agent_raw_received ON %[6]s(received_at_ms DESC);

    CREATE TABLE %[7]s (
      id TEXT PRIMARY KEY,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      name TEXT NOT NULL,
      description TEXT,
      pattern TEXT NOT NULL,
      redact_type TEXT NOT NULL CHECK (redact_type IN ('mask', 'hash', 'block')),
      targets_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      severity TEXT DEFAULT 'high',
      policy_action TEXT DEFAULT 'data_mask',
      intercept_mode TEXT DEFAULT 'enforce',
      hint_type TEXT,
      detection_kind TEXT NOT NULL DEFAULT 'regex' CHECK (detection_kind IN ('regex', 'model')),
      created_at_ms BIGINT,
      pulled_at_ms BIGINT,
      updated_at_ms BIGINT NOT NULL
    );

    CREATE TABLE %[8]s (
      id TEXT PRIMARY KEY,
      created_at_ms BIGINT NOT NULL,
      trace_id TEXT NOT NULL,
      span_id TEXT,
      workspace_name TEXT NOT NULL DEFAULT 'OpenClaw',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      findings_json TEXT NOT NULL DEFAULT '[]',
      total_findings INTEGER NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      intercepted INTEGER NOT NULL DEFAULT 0 CHECK (intercepted IN (0, 1)),
      observe_only INTEGER NOT NULL DEFAULT 0 CHECK (observe_only IN (0, 1))
    );
    CREATE INDEX idx_agent_security_audit_trace ON %[8]s(trace_id);
    CREATE INDEX idx_agent_security_audit_created ON %[8]s(created_at_ms DESC);
    CREATE INDEX idx_agent_security_audit_span ON %[8]s(span_id);

    CREATE TABLE %[9]s (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      parent_span_id TEXT,
      workspace_name TEXT,
      project_name TEXT,
      thread_key TEXT,
      agent_name TEXT,
      channel_name TEXT,
      span_name TEXT NOT NULL DEFAULT '',
      start_time_ms BIGINT,
      end_time_ms BIGINT,
      duration_ms BIGINT,
      command TEXT NOT NULL DEFAULT '',
      command_key TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      platform TEXT NOT NULL DEFAULT 'unix',
      exit_code INTEGER,
      success INTEGER,
      stdout_len INTEGER NOT NULL DEFAULT 0,
      stderr_len INTEGER NOT NULL DEFAULT 0,
      est_tokens INTEGER NOT NULL DEFAULT 0,
      est_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      token_risk INTEGER NOT NULL DEFAULT 0 CHECK (token_risk IN (0, 1)),
      command_not_found INTEGER NOT NULL DEFAULT 0 CHECK (command_not_found IN (0, 1)),
      permission_denied INTEGER NOT NULL DEFAULT 0 CHECK (permission_denied IN (0, 1)),
      illegal_arg_hint INTEGER NOT NULL DEFAULT 0 CHECK (illegal_arg_hint IN (0, 1)),
      cwd TEXT,
      env_keys_json TEXT,
      user_id TEXT,
      host TEXT,
      parser_version INTEGER NOT NULL DEFAULT 1,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT
    );
    CREATE INDEX idx_agent_exec_commands_trace ON %[9]s(trace_id);
    CREATE INDEX idx_agent_exec_commands_start ON %[9]s(start_time_ms DESC);
    CREATE INDEX idx_agent_exec_commands_category ON %[9]s(category);

    CREATE TABLE %[10]s (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES %[2]s(trace_id) ON DELETE CASCADE,
      workspace_name TEXT,
      project_name TEXT,
      thread_key TEXT,
      agent_name TEXT,
      channel_name TEXT,
      span_name TEXT NOT NULL DEFAULT '',
      start_time_ms BIGINT,
      end_time_ms BIGINT,
      duration_ms BIGINT,
      resource_uri TEXT NOT NULL DEFAULT '',
      access_mode TEXT NOT NULL DEFAULT 'read',
      semantic_kind TEXT NOT NULL DEFAULT 'other',
      chars INTEGER NOT NULL DEFAULT 0,
      snippet TEXT,
      uri_repeat_count INTEGER NOT NULL DEFAULT 0,
      risk_flags TEXT NOT NULL DEFAULT '',
      policy_hint_flags TEXT NOT NULL DEFAULT '',
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT
    );
    CREATE INDEX idx_agent_resource_access_trace ON %[10]s(trace_id);
    CREATE INDEX idx_agent_resource_access_start ON %[10]s(start_time_ms DESC);
    CREATE INDEX idx_agent_resource_access_semantic ON %[10]s(semantic_kind);
    CREATE INDEX idx_agent_resource_access_uri ON %[10]s(resource_uri);
`, th, tr, sp, at, fb, raw, pol, sal, ec, ra)
}
