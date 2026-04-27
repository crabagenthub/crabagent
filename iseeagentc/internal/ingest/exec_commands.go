package ingest

import (
	"database/sql"
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
	spanID, traceID string,
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

	// Determine status from success field
	status := "success"
	if p.Success != nil && !*p.Success {
		status = "error"
	}

	// Extract error_info from errorInfoJSON if present
	var errorInfo interface{}
	if errorInfoJSON != nil && strings.TrimSpace(*errorInfoJSON) != "" {
		errorInfo = *errorInfoJSON
	}

	// Build risk_flags from individual risk indicators
	var riskFlags []string
	if p.TokenRisk {
		riskFlags = append(riskFlags, "token_risk")
	}
	if p.CommandNotFound {
		riskFlags = append(riskFlags, "command_not_found")
	}
	if p.PermissionDenied {
		riskFlags = append(riskFlags, "permission_denied")
	}
	if p.IllegalArgHint {
		riskFlags = append(riskFlags, "illegal_arg_hint")
	}
	riskFlagsStr := strings.Join(riskFlags, ",")

	wsOut := strings.TrimSpace(spanWorkspace)
	if workspaceNameAug != nil && strings.TrimSpace(*workspaceNameAug) != "" {
		wsOut = strings.TrimSpace(*workspaceNameAug)
	}

	q := fmt.Sprintf(`INSERT INTO %[1]s (
  span_id, trace_id, workspace_name, project_name, thread_key, agent_name, channel_name,
  span_name, start_time_ms, end_time_ms, duration_ms,
  command, command_key, category, platform, status, error_info,
  stdout_len, stderr_len, est_tokens, risk_flags,
  user_id, parser_version, created_at_ms, updated_at_ms
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(span_id) DO UPDATE SET
  trace_id = excluded.trace_id,
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
  status = excluded.status,
  error_info = excluded.error_info,
  stdout_len = excluded.stdout_len,
  stderr_len = excluded.stderr_len,
  est_tokens = excluded.est_tokens,
  user_id = excluded.user_id,
  parser_version = excluded.parser_version,
  created_at_ms = COALESCE(%[1]s.created_at_ms, excluded.created_at_ms),
  updated_at_ms = excluded.updated_at_ms`, tbl)

	args := []interface{}{
		spanID, traceID,
		wsOut, nullablePtrStr(projectNameAug), nullablePtrStr(threadKey), nullablePtrStr(agentName), nullablePtrStr(channelName),
		strings.TrimSpace(spanName),
		optPositiveMs(startMs), optPositiveMs(endMs), optPositiveMs(durMs),
		p.Command, p.CommandKey, p.Category, p.Platform,
		status, errorInfo,
		p.StdoutLen, p.StderrLen, p.EstTokens,
		riskFlagsStr,
		p.UserID, 1, nowMs, nowMs,
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
