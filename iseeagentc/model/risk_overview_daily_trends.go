package model

import (
	"database/sql"
	"fmt"
	"strings"

	"iseeagentc/internal/calendardays"
	"iseeagentc/internal/sqlutil"
)

type RiskOverviewDailyTrendsQuery struct {
	SinceMs       *int64
	UntilMs       *int64
	WorkspaceName *string
}

type DailyRiskPoint struct {
	Day   string `json:"day"`
	Count int64  `json:"count"`
}

type RiskOverviewDailyTrends struct {
	Resource struct {
		SensitivePath       []DailyRiskPoint `json:"sensitive_path"`
		RedundantRead       []DailyRiskPoint `json:"redundant_read"`
		CredentialAndSecret []DailyRiskPoint `json:"credential_and_secret"`
		LargeRead           []DailyRiskPoint `json:"large_read"`
	} `json:"resource"`
	Command struct {
		PermissionDenied          []DailyRiskPoint `json:"permission_denied"`
		InvalidCommand            []DailyRiskPoint `json:"invalid_command"`
		CommandLoop               []DailyRiskPoint `json:"command_loop"`
		SensitiveCommandTokenRisk []DailyRiskPoint `json:"sensitive_command_token_risk"`
	} `json:"command"`
}

func QueryRiskOverviewDailyTrends(db *sql.DB, q RiskOverviewDailyTrendsQuery) (RiskOverviewDailyTrends, error) {
	var out RiskOverviewDailyTrends
	if db == nil {
		return out, nil
	}

	dayExprRes := "strftime('%Y-%m-%d', datetime(CAST(COALESCE(ra.start_time_ms, 0) AS REAL) / 1000, 'unixepoch'))"
	dayExprCmd := "strftime('%Y-%m-%d', datetime(CAST(COALESCE(e.start_time_ms, 0) AS REAL) / 1000, 'unixepoch'))"
	if !sqlutil.IsSQLite(db) {
		dayExprRes = "TO_CHAR(TO_TIMESTAMP(COALESCE(ra.start_time_ms, 0) / 1000.0), 'YYYY-MM-DD')"
		dayExprCmd = "TO_CHAR(TO_TIMESTAMP(COALESCE(e.start_time_ms, 0) / 1000.0), 'YYYY-MM-DD')"
	}

	resWhere := []string{"1=1"}
	cmdWhere := []string{"1=1"}
	var resArgs []any
	var cmdArgs []any

	if q.SinceMs != nil && *q.SinceMs > 0 {
		resWhere = append(resWhere, "COALESCE(ra.start_time_ms, 0) >= ?")
		cmdWhere = append(cmdWhere, "COALESCE(e.start_time_ms, 0) >= ?")
		resArgs = append(resArgs, *q.SinceMs)
		cmdArgs = append(cmdArgs, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		resWhere = append(resWhere, "COALESCE(ra.start_time_ms, 0) <= ?")
		cmdWhere = append(cmdWhere, "COALESCE(e.start_time_ms, 0) <= ?")
		resArgs = append(resArgs, *q.UntilMs)
		cmdArgs = append(cmdArgs, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		resWhere = append(resWhere, "lower(COALESCE(NULLIF(TRIM(ra.workspace_name), ''), 'OpenClaw')) = lower(?)")
		cmdWhere = append(cmdWhere, "lower(COALESCE(NULLIF(TRIM(e.workspace_name), ''), 'OpenClaw')) = lower(?)")
		ws := strings.TrimSpace(*q.WorkspaceName)
		resArgs = append(resArgs, ws)
		cmdArgs = append(cmdArgs, ws)
	}

	resourceSQL := fmt.Sprintf(`
SELECT day,
       SUM(CASE WHEN ra.risk_flags LIKE '%%sensitive_path%%' THEN 1 ELSE 0 END) AS sensitive_path,
       SUM(CASE WHEN ra.risk_flags LIKE '%%redundant_read%%' THEN 1 ELSE 0 END) AS redundant_read,
       SUM(CASE WHEN (ra.risk_flags LIKE '%%credential_hint%%' OR ra.risk_flags LIKE '%%secret_hint%%') THEN 1 ELSE 0 END) AS credential_and_secret,
       SUM(CASE WHEN ra.risk_flags LIKE '%%large_read%%' THEN 1 ELSE 0 END) AS large_read
FROM (
  SELECT %s AS day, ra.risk_flags
  FROM %s ra
  WHERE %s
) ra
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
`, dayExprRes, CT.AgentResourceAccess, strings.Join(resWhere, " AND "))

	resRows, err := db.Query(sqlutil.RebindIfPostgres(db, resourceSQL), resArgs...)
	if err != nil {
		return out, err
	}
	defer resRows.Close()

	type resDay struct {
		Day                 string
		SensitivePath       int64
		RedundantRead       int64
		CredentialAndSecret int64
		LargeRead           int64
	}
	resMap := map[string]resDay{}
	for resRows.Next() {
		var day sql.NullString
		var sp, rr, cs, lr sql.NullInt64
		if err := resRows.Scan(&day, &sp, &rr, &cs, &lr); err != nil {
			return out, err
		}
		d := strings.TrimSpace(day.String)
		if d == "" {
			continue
		}
		resMap[d] = resDay{
			Day:                 d,
			SensitivePath:       sp.Int64,
			RedundantRead:       rr.Int64,
			CredentialAndSecret: cs.Int64,
			LargeRead:           lr.Int64,
		}
	}
	if err := resRows.Err(); err != nil {
		return out, err
	}

	commandSQL := fmt.Sprintf(`
WITH base AS (
  SELECT %s AS day,
         e.trace_id,
         COALESCE(NULLIF(TRIM(e.command_key), ''), NULLIF(TRIM(e.command), ''), '') AS cmd_key,
         COALESCE(e.permission_denied, 0) AS permission_denied,
         COALESCE(e.command_not_found, 0) AS command_not_found,
         COALESCE(e.token_risk, 0) AS token_risk
  FROM %s e
  WHERE %s
),
loop_groups AS (
  SELECT day, trace_id, cmd_key, COUNT(*) AS n
  FROM base
  WHERE cmd_key <> ''
  GROUP BY day, trace_id, cmd_key
  HAVING COUNT(*) >= 3
),
loop_daily AS (
  SELECT day, COUNT(*) AS command_loop
  FROM loop_groups
  GROUP BY day
)
SELECT b.day,
       SUM(CASE WHEN b.permission_denied <> 0 THEN 1 ELSE 0 END) AS permission_denied,
       SUM(CASE WHEN b.command_not_found <> 0 THEN 1 ELSE 0 END) AS invalid_command,
       COALESCE(ld.command_loop, 0) AS command_loop,
       SUM(CASE WHEN b.token_risk <> 0 THEN 1 ELSE 0 END) AS sensitive_command_token_risk
FROM base b
LEFT JOIN loop_daily ld ON ld.day = b.day
GROUP BY b.day, ld.command_loop
HAVING b.day IS NOT NULL AND b.day <> ''
ORDER BY b.day ASC
`, dayExprCmd, CT.ExecCommands, strings.Join(cmdWhere, " AND "))

	cmdRows, err := db.Query(sqlutil.RebindIfPostgres(db, commandSQL), cmdArgs...)
	if err != nil {
		return out, err
	}
	defer cmdRows.Close()

	type cmdDay struct {
		Day                       string
		PermissionDenied          int64
		InvalidCommand            int64
		CommandLoop               int64
		SensitiveCommandTokenRisk int64
	}
	cmdMap := map[string]cmdDay{}
	for cmdRows.Next() {
		var day sql.NullString
		var pd, ic, cl, st sql.NullInt64
		if err := cmdRows.Scan(&day, &pd, &ic, &cl, &st); err != nil {
			return out, err
		}
		d := strings.TrimSpace(day.String)
		if d == "" {
			continue
		}
		cmdMap[d] = cmdDay{
			Day:                       d,
			PermissionDenied:          pd.Int64,
			InvalidCommand:            ic.Int64,
			CommandLoop:               cl.Int64,
			SensitiveCommandTokenRisk: st.Int64,
		}
	}
	if err := cmdRows.Err(); err != nil {
		return out, err
	}

	var dayKeys []string
	if q.SinceMs != nil && q.UntilMs != nil && *q.SinceMs > 0 && *q.UntilMs >= *q.SinceMs {
		dayKeys = calendardays.UTCYMDInclusive(*q.SinceMs, *q.UntilMs, calendardays.DefaultMaxTrendDays)
	} else {
		seen := map[string]struct{}{}
		for k := range resMap {
			seen[k] = struct{}{}
		}
		for k := range cmdMap {
			seen[k] = struct{}{}
		}
		for k := range seen {
			dayKeys = append(dayKeys, k)
		}
		// simple lexical sort for YYYY-MM-DD
		for i := 0; i < len(dayKeys); i++ {
			for j := i + 1; j < len(dayKeys); j++ {
				if dayKeys[j] < dayKeys[i] {
					dayKeys[i], dayKeys[j] = dayKeys[j], dayKeys[i]
				}
			}
		}
	}

	for _, day := range dayKeys {
		r := resMap[day]
		c := cmdMap[day]
		out.Resource.SensitivePath = append(out.Resource.SensitivePath, DailyRiskPoint{Day: day, Count: r.SensitivePath})
		out.Resource.RedundantRead = append(out.Resource.RedundantRead, DailyRiskPoint{Day: day, Count: r.RedundantRead})
		out.Resource.CredentialAndSecret = append(out.Resource.CredentialAndSecret, DailyRiskPoint{Day: day, Count: r.CredentialAndSecret})
		out.Resource.LargeRead = append(out.Resource.LargeRead, DailyRiskPoint{Day: day, Count: r.LargeRead})

		out.Command.PermissionDenied = append(out.Command.PermissionDenied, DailyRiskPoint{Day: day, Count: c.PermissionDenied})
		out.Command.InvalidCommand = append(out.Command.InvalidCommand, DailyRiskPoint{Day: day, Count: c.InvalidCommand})
		out.Command.CommandLoop = append(out.Command.CommandLoop, DailyRiskPoint{Day: day, Count: c.CommandLoop})
		out.Command.SensitiveCommandTokenRisk = append(out.Command.SensitiveCommandTokenRisk, DailyRiskPoint{Day: day, Count: c.SensitiveCommandTokenRisk})
	}
	return out, nil
}
