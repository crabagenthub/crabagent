package ingest

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"iseeagentc/internal/shellexec"
	"iseeagentc/internal/sqltables"
	"iseeagentc/internal/sqlutil"
)

func boolTo01(b bool) int {
	if b {
		return 1
	}
	return 0
}

func optPositiveMs(v int64) interface{} {
	if v <= 0 {
		return nil
	}
	return v
}

// SyncAgentExecCommandRow upserts or deletes agent_exec_commands for one span (ingest or backfill).
// trustSQLShellHint 为 true 时跳过 isShellLikeToolSpan（仅用于已通过 model.ShellToolWhereSQL 筛过的 Resync/Backfill，
// 避免 SQLite json_extract 与 Go 启发式漂移导致「shell_like 统计有值但从不 INSERT」）。
func SyncAgentExecCommandRow(tx *sql.Tx, db *sql.DB, nowMs int64, cfg shellexec.ResourceAuditConfig,
	spanID, traceID string, parentSpanID *string,
	spanName, spanType string, startMs, endMs, durMs int64, spanWorkspace string,
	inputJSON, outputJSON, errorInfoJSON, metadataJSON *string,
	workspaceNameAug, projectNameAug, threadKey, agentName, channelName *string,
	trustSQLShellHint bool,
) error {
	tbl := sqltables.TableAgentExecCommands
	if !trustSQLShellHint && !isShellLikeToolSpan(spanType, spanName, inputJSON) {
		_, err := tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`DELETE FROM %s WHERE span_id = ?`, tbl)), spanID)
		return err
	}
	thr := cfg.ShellExec.TokenRisks.StdoutCharsThreshold
	p := shellexec.ParseShellSpanRow(inputJSON, outputJSON, errorInfoJSON, metadataJSON, nil, cfg, &thr)

	var envKeys *string
	if len(p.EnvKeys) > 0 {
		b, err := json.Marshal(p.EnvKeys)
		if err == nil {
			s := string(b)
			envKeys = &s
		}
	}

	parent := interface{}(nil)
	if parentSpanID != nil && strings.TrimSpace(*parentSpanID) != "" {
		parent = strings.TrimSpace(*parentSpanID)
	}

	var exitCode interface{}
	if p.ExitCode != nil {
		exitCode = *p.ExitCode
	}
	var success interface{}
	if p.Success != nil {
		if *p.Success {
			success = 1
		} else {
			success = 0
		}
	}

	wsOut := strings.TrimSpace(spanWorkspace)
	if workspaceNameAug != nil && strings.TrimSpace(*workspaceNameAug) != "" {
		wsOut = strings.TrimSpace(*workspaceNameAug)
	}

	q := fmt.Sprintf(`INSERT INTO %[1]s (
  span_id, trace_id, parent_span_id, workspace_name, project_name, thread_key, agent_name, channel_name,
  span_name, start_time_ms, end_time_ms, duration_ms,
  command, command_key, category, platform, exit_code, success,
  stdout_len, stderr_len, est_tokens, est_usd,
  token_risk, command_not_found, permission_denied, illegal_arg_hint,
  cwd, env_keys_json, user_id, host, parser_version, created_at_ms, updated_at_ms
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(span_id) DO UPDATE SET
  trace_id = excluded.trace_id,
  parent_span_id = excluded.parent_span_id,
  workspace_name = excluded.workspace_name,
  project_name = excluded.project_name,
  thread_key = excluded.thread_key,
  agent_name = excluded.agent_name,
  channel_name = excluded.channel_name,
  span_name = excluded.span_name,
  start_time_ms = excluded.start_time_ms,
  end_time_ms = excluded.end_time_ms,
  duration_ms = excluded.duration_ms,
  command = excluded.command,
  command_key = excluded.command_key,
  category = excluded.category,
  platform = excluded.platform,
  exit_code = excluded.exit_code,
  success = excluded.success,
  stdout_len = excluded.stdout_len,
  stderr_len = excluded.stderr_len,
  est_tokens = excluded.est_tokens,
  est_usd = excluded.est_usd,
  token_risk = excluded.token_risk,
  command_not_found = excluded.command_not_found,
  permission_denied = excluded.permission_denied,
  illegal_arg_hint = excluded.illegal_arg_hint,
  cwd = excluded.cwd,
  env_keys_json = excluded.env_keys_json,
  user_id = excluded.user_id,
  host = excluded.host,
  parser_version = excluded.parser_version,
  created_at_ms = COALESCE(%[1]s.created_at_ms, excluded.created_at_ms),
  updated_at_ms = excluded.updated_at_ms`, tbl)

	args := []interface{}{
		spanID, traceID, parent,
		wsOut, nullablePtrStr(projectNameAug), nullablePtrStr(threadKey), nullablePtrStr(agentName), nullablePtrStr(channelName),
		strings.TrimSpace(spanName),
		optPositiveMs(startMs), optPositiveMs(endMs), optPositiveMs(durMs),
		p.Command, p.CommandKey, string(p.Category), p.Platform,
		exitCode, success,
		p.StdoutLen, p.StderrLen, p.EstTokens, p.EstUsd,
		boolTo01(p.TokenRisk), boolTo01(p.CommandNotFound), boolTo01(p.PermissionDenied), boolTo01(p.IllegalArgHint),
		p.Cwd, envKeys, p.UserID, p.Host,
		1, nowMs, nowMs,
	}
	_, err := tx.Exec(sqlutil.RebindIfPostgres(db, q), args...)
	return err
}

func nullablePtrStr(s *string) interface{} {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return v
}
