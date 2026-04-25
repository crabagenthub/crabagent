#!/usr/bin/env bash
# 统一时间线聚合查询 EXPLAIN 辅助脚本
# 用法：
#  1) SQLite:
#     ./scripts/investigation-timeline-explain.sh sqlite /absolute/path/to/collector.db
#  2) Postgres:
#     PG_DSN='postgres://user:pass@host:5432/db?sslmode=disable' \
#       ./scripts/investigation-timeline-explain.sh postgres
set -euo pipefail

mode="${1:-}"
if [[ -z "$mode" ]]; then
  echo "usage: $0 <sqlite|postgres> [sqlite_db_path]" >&2
  exit 1
fi

if [[ "$mode" == "sqlite" ]]; then
  db_path="${2:-}"
  if [[ -z "$db_path" ]]; then
    echo "sqlite mode requires db path" >&2
    exit 1
  fi
  sqlite3 "$db_path" <<'SQL'
EXPLAIN QUERY PLAN
SELECT key, event_type, time_ms, trace_id
FROM (
  SELECT ('cmd:' || COALESCE(NULLIF(TRIM(e.span_id), ''), (COALESCE(e.trace_id, '') || ':' || CAST(COALESCE(e.start_time_ms,0) AS TEXT)))) AS key,
         'command' AS event_type,
         COALESCE(e.start_time_ms, 0) AS time_ms,
         COALESCE(e.trace_id, '') AS trace_id
  FROM agent_exec_commands e
  WHERE COALESCE(e.start_time_ms, 0) >= 0
UNION ALL
  SELECT ('res:' || COALESCE(NULLIF(TRIM(ra.span_id), ''), (COALESCE(ra.trace_id, '') || ':' || CAST(COALESCE(ra.start_time_ms,0) AS TEXT)))) AS key,
         'resource' AS event_type,
         COALESCE(ra.start_time_ms, 0) AS time_ms,
         COALESCE(ra.trace_id, '') AS trace_id
  FROM agent_resource_access ra
  WHERE COALESCE(ra.start_time_ms, 0) >= 0
UNION ALL
  SELECT ('pol:' || COALESCE(NULLIF(TRIM(s.id), ''), (COALESCE(s.trace_id, '') || ':' || CAST(COALESCE(s.created_at_ms,0) AS TEXT)))) AS key,
         'policy_hit' AS event_type,
         COALESCE(s.created_at_ms, 0) AS time_ms,
         COALESCE(s.trace_id, '') AS trace_id
  FROM agent_security_audit_logs s
  WHERE COALESCE(s.created_at_ms, 0) >= 0
) u
ORDER BY time_ms DESC, key DESC
LIMIT 120 OFFSET 0;
SQL
  exit 0
fi

if [[ "$mode" == "postgres" ]]; then
  if [[ -z "${PG_DSN:-}" ]]; then
    echo "postgres mode requires PG_DSN env var" >&2
    exit 1
  fi
  psql "$PG_DSN" <<'SQL'
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT key, event_type, time_ms, trace_id
FROM (
  SELECT ('cmd:' || COALESCE(NULLIF(TRIM(e.span_id), ''), (COALESCE(e.trace_id, '') || ':' || CAST(COALESCE(e.start_time_ms,0) AS TEXT)))) AS key,
         'command' AS event_type,
         COALESCE(e.start_time_ms, 0) AS time_ms,
         COALESCE(e.trace_id, '') AS trace_id
  FROM agent_exec_commands e
  WHERE COALESCE(e.start_time_ms, 0) >= 0
UNION ALL
  SELECT ('res:' || COALESCE(NULLIF(TRIM(ra.span_id), ''), (COALESCE(ra.trace_id, '') || ':' || CAST(COALESCE(ra.start_time_ms,0) AS TEXT)))) AS key,
         'resource' AS event_type,
         COALESCE(ra.start_time_ms, 0) AS time_ms,
         COALESCE(ra.trace_id, '') AS trace_id
  FROM agent_resource_access ra
  WHERE COALESCE(ra.start_time_ms, 0) >= 0
UNION ALL
  SELECT ('pol:' || COALESCE(NULLIF(TRIM(s.id), ''), (COALESCE(s.trace_id, '') || ':' || CAST(COALESCE(s.created_at_ms,0) AS TEXT)))) AS key,
         'policy_hit' AS event_type,
         COALESCE(s.created_at_ms, 0) AS time_ms,
         COALESCE(s.trace_id, '') AS trace_id
  FROM agent_security_audit_logs s
  WHERE COALESCE(s.created_at_ms, 0) >= 0
) u
ORDER BY time_ms DESC, key DESC
LIMIT 120 OFFSET 0;
SQL
  exit 0
fi

echo "unknown mode: $mode" >&2
exit 1
