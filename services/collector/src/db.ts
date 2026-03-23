import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type CrabagentDb = ReturnType<typeof openDatabase>;

/** Bump when `events` DDL changes; triggers DROP + recreate (trace data is ephemeral). */
const SCHEMA_USER_VERSION = 4;

function applyEventsSchema(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS events;
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      trace_root_id TEXT,
      session_id TEXT,
      session_key TEXT,
      run_id TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  `);
  db.pragma(`user_version = ${SCHEMA_USER_VERSION}`);
}

export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const rawVersion = db.pragma("user_version", { simple: true });
  const userVersion =
    typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 0;

  if (userVersion !== SCHEMA_USER_VERSION) {
    applyEventsSchema(db);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        trace_root_id TEXT,
        session_id TEXT,
        session_key TEXT,
        run_id TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    `);
  }

  return db;
}
