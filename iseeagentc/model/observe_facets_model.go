package model

import (
	"database/sql"
	"strings"
)

type ObserveFacetsResult struct {
	Agents   []string `json:"agents"`
	Channels []string `json:"channels"`
}

const observeFacetLimit = 500

func loadObserveFacets(db QueryDB, workspaceName *string) (*ObserveFacetsResult, error) {
	out := &ObserveFacetsResult{}
	var wsArg interface{}
	wsWhere := ""
	if workspaceName != nil && strings.TrimSpace(*workspaceName) != "" {
		wsWhere = "AND lower(workspace_name) = lower(?)"
		wsArg = strings.TrimSpace(*workspaceName)
	}
	qAgents := `SELECT DISTINCT TRIM(agent_name) AS v FROM ` + CT.Threads + `
WHERE agent_name IS NOT NULL AND TRIM(agent_name) != '' ` + wsWhere + `
ORDER BY v COLLATE NOCASE LIMIT ?`
	qCh := `SELECT DISTINCT TRIM(channel_name) AS v FROM ` + CT.Threads + `
WHERE channel_name IS NOT NULL AND TRIM(channel_name) != '' ` + wsWhere + `
ORDER BY v COLLATE NOCASE LIMIT ?`

	var rows *sql.Rows
	var err error
	if wsArg != nil {
		rows, err = db.Query(qAgents, wsArg, observeFacetLimit)
	} else {
		rows, err = db.Query(qAgents, observeFacetLimit)
	}
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return nil, err
		}
		out.Agents = append(out.Agents, v)
	}
	rows.Close()

	if wsArg != nil {
		rows, err = db.Query(qCh, wsArg, observeFacetLimit)
	} else {
		rows, err = db.Query(qCh, observeFacetLimit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out.Channels = append(out.Channels, v)
	}
	return out, rows.Err()
}
