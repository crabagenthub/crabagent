import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type CrabagentDb = ReturnType<typeof openDatabase>;

/**
 * Opik 形态：Thread（含 subagent 会话树）→ Trace → Span。
 */
function opikSchemaDdl(): string {
  return `
    CREATE TABLE opik_threads (
      thread_id TEXT NOT NULL,
      workspace_name TEXT NOT NULL DEFAULT 'default',
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
        REFERENCES opik_threads (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_opik_threads_last_seen ON opik_threads(last_seen_ms DESC);
    CREATE INDEX idx_opik_threads_parent ON opik_threads (workspace_name, project_name, parent_thread_id);

    CREATE TABLE opik_traces (
      trace_id TEXT PRIMARY KEY,
      thread_id TEXT,
      workspace_name TEXT NOT NULL DEFAULT 'default',
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
        REFERENCES opik_threads (thread_id, workspace_name, project_name)
        ON DELETE SET NULL,
      FOREIGN KEY (subagent_thread_id, workspace_name, project_name)
        REFERENCES opik_threads (thread_id, workspace_name, project_name)
        ON DELETE SET NULL
    );
    CREATE INDEX idx_opik_traces_thread ON opik_traces(thread_id, workspace_name, project_name);
    CREATE INDEX idx_opik_traces_project ON opik_traces(workspace_name, project_name, created_at_ms DESC);
    CREATE INDEX idx_opik_traces_created ON opik_traces(created_at_ms DESC);
    CREATE INDEX idx_opik_traces_complete ON opik_traces(is_complete, ended_at_ms);
    CREATE INDEX idx_opik_traces_subagent_thread ON opik_traces(subagent_thread_id);
    CREATE INDEX idx_opik_traces_type_created ON opik_traces(trace_type, created_at_ms DESC);

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

    CREATE TABLE interception_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      pattern TEXT NOT NULL,
      redact_type TEXT NOT NULL CHECK (redact_type IN ('mask', 'hash', 'block')),
      targets_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at_ms INTEGER NOT NULL
    );
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
    DROP TABLE IF EXISTS opik_thread_turns;
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

function tableColumnNames(db: Database.Database, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(cols.map((c) => c.name));
}

/** Add agent / channel columns on existing DBs (no-op when already present). */
function ensureOpikThreadsAgentChannelColumns(db: Database.Database): void {
  if (!opikThreadsTableExists(db)) {
    return;
  }
  const names = tableColumnNames(db, "opik_threads");
  if (!names.has("agent_name")) {
    db.exec(`ALTER TABLE opik_threads ADD COLUMN agent_name TEXT`);
  }
  if (!names.has("channel_name")) {
    db.exec(`ALTER TABLE opik_threads ADD COLUMN channel_name TEXT`);
  }
}

/**
 * 方案 A 列：在**不 reset** 的旧库上 `ALTER TABLE ADD COLUMN`，避免启动即因缺列崩溃。
 * 不使用内联 REFERENCES（部分 SQLite 版本对 ALTER 附加 FK 支持不一致）。
 */
function ensureOpikThreadsPlanColumns(db: Database.Database): void {
  if (!opikThreadsTableExists(db)) {
    return;
  }
  const n = tableColumnNames(db, "opik_threads");
  if (!n.has("thread_type")) {
    db.exec(`ALTER TABLE opik_threads ADD COLUMN thread_type TEXT NOT NULL DEFAULT 'main'`);
  }
  if (!n.has("parent_thread_id")) {
    db.exec(`ALTER TABLE opik_threads ADD COLUMN parent_thread_id TEXT`);
  }
}

function ensureOpikTracesPlanColumns(db: Database.Database): void {
  if (!opikCoreTableExists(db)) {
    return;
  }
  const n = tableColumnNames(db, "opik_traces");
  if (!n.has("setting_json")) {
    db.exec(`ALTER TABLE opik_traces ADD COLUMN setting_json TEXT`);
  }
  if (!n.has("trace_type")) {
    db.exec(`ALTER TABLE opik_traces ADD COLUMN trace_type TEXT NOT NULL DEFAULT 'external'`);
  }
  if (!n.has("subagent_thread_id")) {
    db.exec(`ALTER TABLE opik_traces ADD COLUMN subagent_thread_id TEXT`);
  }
}

function opikSpansTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'opik_spans'`)
    .get() as { ok: number } | undefined;
  return row != null;
}

function ensureOpikSpansPlanColumns(db: Database.Database): void {
  if (!opikSpansTableExists(db)) {
    return;
  }
  const n = tableColumnNames(db, "opik_spans");
  if (!n.has("setting_json")) {
    db.exec(`ALTER TABLE opik_spans ADD COLUMN setting_json TEXT`);
  }
  if (!n.has("status")) {
    db.exec(`ALTER TABLE opik_spans ADD COLUMN status TEXT`);
  }
  if (!n.has("usage_preview")) {
    db.exec(`ALTER TABLE opik_spans ADD COLUMN usage_preview TEXT`);
  }
}

/** 移除已废弃的 `parent_trace_id` 列（SQLite 3.35+ `DROP COLUMN`）。 */
function dropOpikTracesParentTraceIdColumnIfPresent(db: Database.Database): void {
  if (!opikCoreTableExists(db)) {
    return;
  }
  const tn = tableColumnNames(db, "opik_traces");
  if (!tn.has("parent_trace_id")) {
    return;
  }
  try {
    db.exec(`DROP INDEX IF EXISTS idx_opik_traces_parent`);
    db.exec(`ALTER TABLE opik_traces DROP COLUMN parent_trace_id`);
  } catch {
    /* SQLite 过旧或只读环境：保留列，由运维 reset 处理 */
  }
}

/** 新 schema 索引（旧库可能仅有早期索引）。 */
function ensureOpikPlanIndexes(db: Database.Database): void {
  if (!opikCoreTableExists(db)) {
    return;
  }
  const tn = tableColumnNames(db, "opik_traces");
  if (tn.has("subagent_thread_id")) {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_opik_traces_subagent_thread ON opik_traces (subagent_thread_id)`,
    );
  }
  if (tn.has("trace_type") && tn.has("created_at_ms")) {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_opik_traces_type_created ON opik_traces (trace_type, created_at_ms DESC)`,
    );
  }
  if (opikThreadsTableExists(db)) {
    const th = tableColumnNames(db, "opik_threads");
    if (th.has("parent_thread_id")) {
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_opik_threads_parent ON opik_threads (workspace_name, project_name, parent_thread_id)`,
      );
    }
  }
}

/**
 * 早期仅含 threads/traces/spans 的库没有 attachments / feedback / raw_ingest；
 * `applyOpikBatch` 会写这些表，缺表时需在**不 reset** 的前提下补建。
 */
function ensureOpikAuxTables(db: Database.Database): void {
  if (!opikCoreTableExists(db)) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS opik_raw_ingest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at_ms INTEGER NOT NULL,
      route TEXT,
      trace_id TEXT,
      span_id TEXT,
      body_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opik_raw_trace ON opik_raw_ingest(trace_id);
    CREATE INDEX IF NOT EXISTS idx_opik_raw_received ON opik_raw_ingest(received_at_ms DESC);

    CREATE TABLE IF NOT EXISTS opik_trace_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL REFERENCES opik_traces(trace_id) ON DELETE CASCADE,
      score_name TEXT NOT NULL,
      value REAL NOT NULL,
      category_name TEXT,
      reason TEXT,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opik_feedback_trace ON opik_trace_feedback(trace_id);
  `);
  if (opikSpansTableExists(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS opik_attachments (
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
      CREATE INDEX IF NOT EXISTS idx_opik_attachments_trace ON opik_attachments(trace_id);
      CREATE INDEX IF NOT EXISTS idx_opik_attachments_span ON opik_attachments(span_id);
    `);
  }
}

function ensureInterceptionPoliciesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS interception_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      pattern TEXT NOT NULL,
      redact_type TEXT NOT NULL CHECK (redact_type IN ('mask', 'hash', 'block')),
      targets_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

function ensureOpikIncrementalMigrations(db: Database.Database): void {
  ensureOpikAuxTables(db);
  ensureInterceptionPoliciesTable(db);
  ensureOpikThreadsAgentChannelColumns(db);
  ensureOpikThreadsPlanColumns(db);
  ensureOpikTracesPlanColumns(db);
  dropOpikTracesParentTraceIdColumnIfPresent(db);
  ensureOpikSpansPlanColumns(db);
  ensureOpikPlanIndexes(db);
}

/**
 * 打开 SQLite：默认**保留已有数据**，仅在库中尚无 `opik_traces` 时创建 Opik 形态表。
 * 开发/清库：启动前设置 `CRABAGENT_DB_RESET=1`（或 `true`）会执行 `dropAllTables` 后重建。
 *
 * 已有库：自动 `ALTER TABLE` 补齐方案 A 列（如 `setting_json`、`trace_type` 等）；与完整 reset 相比不保证
 * 与旧 `opik_thread_turns` / `tags_json` 数据语义一致，复杂旧数据仍建议 `CRABAGENT_DB_RESET=1`。
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
    ensureOpikIncrementalMigrations(db);
  }

  return db;
}
