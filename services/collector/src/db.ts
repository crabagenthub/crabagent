import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type CrabagentDb = ReturnType<typeof openDatabase>;

/**
 * 仅保留 opik-openclaw / Opik SDK 形态表（Thread → Trace → Span、附件、反馈、原始包）。
 */
function opikSchemaDdl(): string {
  return `
    CREATE TABLE opik_threads (
      thread_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL DEFAULT 'default',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      first_seen_ms INTEGER NOT NULL,
      last_seen_ms INTEGER NOT NULL,
      metadata_json TEXT,
      agent_name TEXT,
      channel_name TEXT,
      PRIMARY KEY (thread_id, workspace_name, project_name)
    );
    CREATE INDEX idx_opik_threads_last_seen ON opik_threads(last_seen_ms DESC);

    CREATE TABLE opik_traces (
      trace_id TEXT PRIMARY KEY,
      thread_id TEXT,
      workspace_name TEXT NOT NULL DEFAULT 'default',
      project_name TEXT NOT NULL DEFAULT 'openclaw',
      name TEXT,
      tags_json TEXT,
      input_json TEXT,
      output_json TEXT,
      metadata_json TEXT,
      error_info_json TEXT,
      success INTEGER,
      duration_ms INTEGER,
      total_cost REAL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER,
      ended_at_ms INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
      created_from TEXT NOT NULL DEFAULT 'opik-openclaw',
      FOREIGN KEY (thread_id, workspace_name, project_name)
        REFERENCES opik_threads (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_opik_traces_thread ON opik_traces(thread_id, workspace_name, project_name);
    CREATE INDEX idx_opik_traces_project ON opik_traces(workspace_name, project_name, created_at_ms DESC);
    CREATE INDEX idx_opik_traces_created ON opik_traces(created_at_ms DESC);
    CREATE INDEX idx_opik_traces_complete ON opik_traces(is_complete, ended_at_ms);

    CREATE TABLE opik_spans (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES opik_traces(trace_id) ON DELETE CASCADE,
      parent_span_id TEXT REFERENCES opik_spans(span_id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      span_type TEXT NOT NULL DEFAULT 'general'
        CHECK (span_type IN ('general', 'tool', 'llm', 'guardrail')),
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      duration_ms INTEGER,
      metadata_json TEXT,
      input_json TEXT,
      output_json TEXT,
      tags_json TEXT,
      usage_json TEXT,
      model TEXT,
      provider TEXT,
      error_info_json TEXT,
      total_cost REAL,
      sort_index INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1))
    );
    CREATE INDEX idx_opik_spans_trace ON opik_spans(trace_id);
    CREATE INDEX idx_opik_spans_parent ON opik_spans(parent_span_id);
    CREATE INDEX idx_opik_spans_type ON opik_spans(span_type);

    CREATE TABLE opik_attachments (
      attachment_id TEXT PRIMARY KEY,
      trace_id TEXT REFERENCES opik_traces(trace_id) ON DELETE CASCADE,
      span_id TEXT REFERENCES opik_spans(span_id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('trace', 'span')),
      content_type TEXT,
      file_name TEXT,
      url TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX idx_opik_attachments_trace ON opik_attachments(trace_id);
    CREATE INDEX idx_opik_attachments_span ON opik_attachments(span_id);

    CREATE TABLE opik_trace_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL REFERENCES opik_traces(trace_id) ON DELETE CASCADE,
      score_name TEXT NOT NULL,
      value REAL NOT NULL,
      category_name TEXT,
      reason TEXT,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX idx_opik_feedback_trace ON opik_trace_feedback(trace_id);

    CREATE TABLE opik_raw_ingest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at_ms INTEGER NOT NULL,
      route TEXT,
      trace_id TEXT,
      span_id TEXT,
      body_json TEXT NOT NULL
    );
    CREATE INDEX idx_opik_raw_trace ON opik_raw_ingest(trace_id);
    CREATE INDEX idx_opik_raw_received ON opik_raw_ingest(received_at_ms DESC);
  `;
}

/**
 * 仅在显式重置（`CRABAGENT_DB_RESET=1`）时调用：删除 opik 与历史 Crabagent 表，便于得到干净 schema。
 * 顺序：子表 → 父表（`IF EXISTS`）。
 */
function dropAllTables(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS opik_raw_ingest;
    DROP TABLE IF EXISTS opik_trace_feedback;
    DROP TABLE IF EXISTS opik_attachments;
    DROP TABLE IF EXISTS opik_spans;
    DROP TABLE IF EXISTS opik_traces;
    DROP TABLE IF EXISTS opik_threads;

    DROP TABLE IF EXISTS ext_raw_ingest;
    DROP TABLE IF EXISTS ext_attachments;
    DROP TABLE IF EXISTS ext_spans;
    DROP TABLE IF EXISTS ext_traces;
    DROP TABLE IF EXISTS ext_threads;

    DROP TABLE IF EXISTS evaluations;
    DROP TABLE IF EXISTS spans;
    DROP TABLE IF EXISTS traces;
    DROP TABLE IF EXISTS daily_session_aggregates;
    DROP TABLE IF EXISTS daily_aggregates;
    DROP TABLE IF EXISTS optimizations;
    DROP TABLE IF EXISTS generations;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS channel_peers;
    DROP TABLE IF EXISTS agents;
    DROP TABLE IF EXISTS otel_spans;
    DROP TABLE IF EXISTS events;
  `);
}

function resetSchema(db: Database.Database) {
  dropAllTables(db);
  db.exec(opikSchemaDdl());
}

function opikCoreTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'opik_traces'`)
    .get() as { ok: number } | undefined;
  return row != null;
}

function opikThreadsTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'opik_threads'`)
    .get() as { ok: number } | undefined;
  return row != null;
}

/** Add agent / channel columns on existing DBs (no-op when already present). */
function ensureOpikThreadsAgentChannelColumns(db: Database.Database): void {
  if (!opikThreadsTableExists(db)) {
    return;
  }
  const cols = db.prepare(`PRAGMA table_info(opik_threads)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("agent_name")) {
    db.exec(`ALTER TABLE opik_threads ADD COLUMN agent_name TEXT`);
  }
  if (!names.has("channel_name")) {
    db.exec(`ALTER TABLE opik_threads ADD COLUMN channel_name TEXT`);
  }
}

/**
 * 打开 SQLite：默认**保留已有数据**，仅在库中尚无 `opik_traces` 时创建 Opik 形态表。
 * 开发/清库：启动前设置 `CRABAGENT_DB_RESET=1`（或 `true`）会执行 `dropAllTables` 后重建。
 */
export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const resetFlag = process.env.CRABAGENT_DB_RESET?.trim().toLowerCase();
  const forceReset = resetFlag === "1" || resetFlag === "true" || resetFlag === "yes";

  if (forceReset) {
    resetSchema(db);
  } else if (!opikCoreTableExists(db)) {
    db.exec(opikSchemaDdl());
  } else {
    ensureOpikThreadsAgentChannelColumns(db);
  }

  return db;
}
