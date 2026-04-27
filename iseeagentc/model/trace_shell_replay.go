package model

import (
	"database/sql"
	"fmt"
	"strings"
)

// ShellReplayItem is one shell execution step for observational replay (ordered timeline).
type ShellReplayItem struct {
	SpanID      string  `json:"span_id"`
	TraceID     string  `json:"trace_id"`
	StartTimeMs *int64  `json:"start_time_ms"`
	DurationMs  *int64  `json:"duration_ms"`
	Command     string  `json:"command"`
	CommandKey  string  `json:"command_key"`
	Category    string  `json:"category"`
	Platform    string  `json:"platform"`
	Status      string  `json:"status"`
	ErrorInfo   string  `json:"error_info,omitempty"`
	TokenRisk   bool    `json:"token_risk"`
	SpanName    string  `json:"span_name"`
	Workspace   *string `json:"workspace_name"`
	Project     *string `json:"project_name"`
	ThreadKey   *string `json:"thread_key"`
	AgentName   *string `json:"agent_name"`
	ChannelName *string `json:"channel_name"`
}

// QueryShellExecReplay returns shell rows from agent_exec_commands for a trace, time-ordered.
func QueryShellExecReplay(db *sql.DB, traceID string) ([]ShellReplayItem, error) {
	tid := strings.TrimSpace(traceID)
	if tid == "" {
		return nil, nil
	}
	q := fmt.Sprintf(`SELECT span_id, trace_id, start_time_ms, duration_ms, command, command_key, category, platform,
 status, error_info, token_risk, span_name, workspace_name, project_name, thread_key, agent_name, channel_name
 FROM %s WHERE trace_id = ? ORDER BY (start_time_ms IS NULL) ASC, start_time_ms ASC, span_id ASC`, CT.ExecCommands)
	rows, err := db.Query(q, tid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ShellReplayItem
	for rows.Next() {
		var it ShellReplayItem
		var start, dur sql.NullInt64
		var tr int
		var ws, proj, tk, ag, ch sql.NullString
		var st sql.NullString
		var errInfo sql.NullString
		if err := rows.Scan(&it.SpanID, &it.TraceID, &start, &dur, &it.Command, &it.CommandKey, &it.Category, &it.Platform,
			&st, &errInfo, &tr, &it.SpanName, &ws, &proj, &tk, &ag, &ch); err != nil {
			return nil, err
		}
		if start.Valid {
			v := start.Int64
			it.StartTimeMs = &v
		}
		if dur.Valid {
			v := dur.Int64
			it.DurationMs = &v
		}
		if st.Valid {
			it.Status = st.String
		} else {
			it.Status = "success"
		}
		if errInfo.Valid {
			it.ErrorInfo = errInfo.String
		}
		it.TokenRisk = tr != 0
		if ws.Valid {
			s := ws.String
			it.Workspace = &s
		}
		if proj.Valid {
			s := proj.String
			it.Project = &s
		}
		if tk.Valid {
			s := tk.String
			it.ThreadKey = &s
		}
		if ag.Valid {
			s := ag.String
			it.AgentName = &s
		}
		if ch.Valid {
			s := ch.String
			it.ChannelName = &s
		}
		out = append(out, it)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
