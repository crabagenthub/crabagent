-- 与 services/collector/src/db.ts 一致；写入入口 POST /v1/opik/batch

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
