import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type CrabagentDb = ReturnType<typeof openDatabase>;

/**
 * Bump when `events` / `otel_spans` / observability DDL changes.
 * v13: `spans.metadata` JSON; synthetic `AGENT_LOOP` parents; refined `type` (LLM / MEMORY / …).
 */
const SCHEMA_USER_VERSION = 13;

const OTEL_SPANS_DDL = `
    DROP TABLE IF EXISTS otel_spans;
    CREATE TABLE otel_spans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      name TEXT NOT NULL,
      kind INTEGER,
      start_time_unix_nano TEXT NOT NULL,
      end_time_unix_nano TEXT NOT NULL,
      status_code TEXT,
      status_message TEXT,
      attributes_json TEXT NOT NULL DEFAULT '{}',
      resource_json TEXT NOT NULL DEFAULT '{}',
      service_name TEXT,
      scope_name TEXT,
      trace_root_id TEXT,
      msg_id TEXT,
      event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(trace_id, span_id)
    );
    CREATE INDEX IF NOT EXISTS idx_otel_spans_trace ON otel_spans(trace_id);
    CREATE INDEX IF NOT EXISTS idx_otel_spans_trace_root ON otel_spans(trace_root_id);
    CREATE INDEX IF NOT EXISTS idx_otel_spans_msg_id ON otel_spans(msg_id);
    CREATE INDEX IF NOT EXISTS idx_otel_spans_event_id ON otel_spans(event_id);
`;

const OBSERVABILITY_CREATE_DDL = `
    CREATE TABLE traces (
      trace_id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      total_tokens INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id);
    CREATE INDEX IF NOT EXISTS idx_traces_user ON traces(user_id);
    CREATE INDEX IF NOT EXISTS idx_traces_start ON traces(start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);

    CREATE TABLE spans (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_id TEXT,
      module TEXT NOT NULL DEFAULT 'OTHER',
      type TEXT NOT NULL DEFAULT 'IO',
      name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '{}',
      output TEXT NOT NULL DEFAULT '{}',
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trace_id) REFERENCES traces(trace_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sem_spans_trace ON spans(trace_id);
    CREATE INDEX IF NOT EXISTS idx_sem_spans_parent ON spans(parent_id);
    CREATE INDEX IF NOT EXISTS idx_sem_spans_module ON spans(module);
    CREATE INDEX IF NOT EXISTS idx_sem_spans_type ON spans(type);

    CREATE TABLE generations (
      span_id TEXT PRIMARY KEY,
      model_name TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT,
      context_full TEXT,
      context_sent TEXT,
      FOREIGN KEY (span_id) REFERENCES spans(span_id) ON DELETE CASCADE
    );

    CREATE TABLE optimizations (
      opt_id TEXT PRIMARY KEY,
      span_id TEXT NOT NULL,
      saved_tokens INTEGER NOT NULL DEFAULT 0,
      strategy TEXT NOT NULL,
      cost_saved REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (span_id) REFERENCES spans(span_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_opts_span ON optimizations(span_id);
`;

function applyEventsSchema(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS optimizations;
    DROP TABLE IF EXISTS generations;
    DROP TABLE IF EXISTS spans;
    DROP TABLE IF EXISTS traces;
    DROP TABLE IF EXISTS otel_spans;
    DROP TABLE IF EXISTS events;
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      trace_root_id TEXT,
      session_id TEXT,
      session_key TEXT,
      agent_id TEXT,
      agent_name TEXT,
      chat_title TEXT,
      run_id TEXT,
      msg_id TEXT,
      channel TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      client_ts TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_root_id);
    CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_root_id, id);
    CREATE INDEX IF NOT EXISTS idx_events_run ON events(trace_root_id, run_id, id);
    CREATE INDEX IF NOT EXISTS idx_events_msg_id ON events(msg_id);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
  `);
  db.exec(OTEL_SPANS_DDL);
  db.exec(OBSERVABILITY_CREATE_DDL);
  db.pragma(`user_version = ${SCHEMA_USER_VERSION}`);
}

function migrateV9OtelSpansRename(db: Database.Database) {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
  const names = new Set(rows.map((r) => r.name));
  if (names.has("spans") && !names.has("otel_spans")) {
    db.exec(`ALTER TABLE spans RENAME TO otel_spans;`);
  }
}

function migrateV9AddObservabilityTables(db: Database.Database) {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
  const names = new Set(rows.map((r) => r.name));
  if (!names.has("traces")) {
    db.exec(OBSERVABILITY_CREATE_DDL);
  }
}

function migrateV10AddSpansTypeColumn(db: Database.Database) {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spans'`).get();
  if (!rows) {
    return;
  }
  const cols = db.prepare(`PRAGMA table_info(spans)`).all() as { name: string }[];
  if (cols.some((c) => c.name === "type")) {
    return;
  }
  db.exec(`ALTER TABLE spans ADD COLUMN type TEXT NOT NULL DEFAULT 'IO';`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sem_spans_type ON spans(type);`);
}

function migrateV11AddSpansModuleColumn(db: Database.Database) {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spans'`).get();
  if (!rows) {
    return;
  }
  const cols = db.prepare(`PRAGMA table_info(spans)`).all() as { name: string }[];
  if (cols.some((c) => c.name === "module")) {
    return;
  }
  db.exec(`ALTER TABLE spans ADD COLUMN module TEXT NOT NULL DEFAULT 'OTHER';`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sem_spans_module ON spans(module);`);
}

function migrateV12AddSpansMetadataColumn(db: Database.Database) {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spans'`).get();
  if (!rows) {
    return;
  }
  const cols = db.prepare(`PRAGMA table_info(spans)`).all() as { name: string }[];
  if (cols.some((c) => c.name === "metadata")) {
    return;
  }
  db.exec(`ALTER TABLE spans ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';`);
}

export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const rawVersion = db.pragma("user_version", { simple: true });
  const userVersion =
    typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 0;

  if (userVersion === 8) {
    const hasOtel = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='otel_spans'`)
      .get();
    const hasLegacySpans = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='spans'`)
      .get();
    if (hasLegacySpans && !hasOtel) {
      db.exec(`ALTER TABLE spans RENAME TO otel_spans;`);
    } else if (!hasOtel) {
      db.exec(`
        CREATE TABLE otel_spans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trace_id TEXT NOT NULL,
          span_id TEXT NOT NULL,
          parent_span_id TEXT,
          name TEXT NOT NULL,
          kind INTEGER,
          start_time_unix_nano TEXT NOT NULL,
          end_time_unix_nano TEXT NOT NULL,
          status_code TEXT,
          status_message TEXT,
          attributes_json TEXT NOT NULL DEFAULT '{}',
          resource_json TEXT NOT NULL DEFAULT '{}',
          service_name TEXT,
          scope_name TEXT,
          trace_root_id TEXT,
          msg_id TEXT,
          event_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(trace_id, span_id)
        );
        CREATE INDEX IF NOT EXISTS idx_otel_spans_trace ON otel_spans(trace_id);
        CREATE INDEX IF NOT EXISTS idx_otel_spans_trace_root ON otel_spans(trace_root_id);
        CREATE INDEX IF NOT EXISTS idx_otel_spans_msg_id ON otel_spans(msg_id);
        CREATE INDEX IF NOT EXISTS idx_otel_spans_event_id ON otel_spans(event_id);
      `);
    }
    db.pragma("user_version = 9");
  }

  const readUv = (): number => {
    const v = db.pragma("user_version", { simple: true });
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };

  let uv = readUv();

  if (uv === 9) {
    migrateV9OtelSpansRename(db);
    migrateV9AddObservabilityTables(db);
    db.pragma("user_version = 10");
    uv = 10;
  }

  if (uv === 10) {
    migrateV10AddSpansTypeColumn(db);
    db.pragma("user_version = 11");
    uv = readUv();
  }

  if (uv === 11) {
    migrateV11AddSpansModuleColumn(db);
    db.pragma("user_version = 12");
    uv = readUv();
  }

  if (uv === 12) {
    migrateV12AddSpansMetadataColumn(db);
    db.pragma(`user_version = ${SCHEMA_USER_VERSION}`);
    uv = SCHEMA_USER_VERSION;
  }

  if (uv !== SCHEMA_USER_VERSION) {
    applyEventsSchema(db);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        trace_root_id TEXT,
        session_id TEXT,
        session_key TEXT,
        agent_id TEXT,
        agent_name TEXT,
        chat_title TEXT,
        run_id TEXT,
        msg_id TEXT,
        channel TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        client_ts TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(event_id)
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_root_id);
      CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_root_id, id);
      CREATE INDEX IF NOT EXISTS idx_events_run ON events(trace_root_id, run_id, id);
      CREATE INDEX IF NOT EXISTS idx_events_msg_id ON events(msg_id);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS otel_spans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind INTEGER,
        start_time_unix_nano TEXT NOT NULL,
        end_time_unix_nano TEXT NOT NULL,
        status_code TEXT,
        status_message TEXT,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        resource_json TEXT NOT NULL DEFAULT '{}',
        service_name TEXT,
        scope_name TEXT,
        trace_root_id TEXT,
        msg_id TEXT,
        event_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(trace_id, span_id)
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_otel_spans_trace ON otel_spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_otel_spans_trace_root ON otel_spans(trace_root_id);
      CREATE INDEX IF NOT EXISTS idx_otel_spans_msg_id ON otel_spans(msg_id);
      CREATE INDEX IF NOT EXISTS idx_otel_spans_event_id ON otel_spans(event_id);
    `);
    migrateV9AddObservabilityTables(db);
    migrateV10AddSpansTypeColumn(db);
    migrateV11AddSpansModuleColumn(db);
    migrateV12AddSpansMetadataColumn(db);
  }

  return db;
}
