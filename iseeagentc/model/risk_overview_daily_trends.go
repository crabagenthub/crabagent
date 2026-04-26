package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

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
		SensitivePath       []DailyRiskPoint `json:"sensitivePath"`
		RedundantRead       []DailyRiskPoint `json:"redundantRead"`
		CredentialAndSecret []DailyRiskPoint `json:"credentialAndSecret"`
		LargeRead           []DailyRiskPoint `json:"largeRead"`
	} `json:"resource"`
	Command struct {
		PermissionDenied          []DailyRiskPoint `json:"permissionDenied"`
		InvalidCommand            []DailyRiskPoint `json:"invalidCommand"`
		CommandLoop               []DailyRiskPoint `json:"commandLoop"`
		SensitiveCommandTokenRisk []DailyRiskPoint `json:"sensitiveCommandTokenRisk"`
	} `json:"command"`
}

type RiskOverviewTrend struct {
	Timestamp int64  `json:"timestamp"`
	Date      string `json:"date"`
	P0        int64  `json:"p0"`
	P1        int64  `json:"p1"`
	P2        int64  `json:"p2"`
	P3        int64  `json:"p3"`
	Command   int64  `json:"command"`
	Resource  int64  `json:"resource"`
	Policy    int64  `json:"policy"`
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

type RiskOverviewTrendQuery struct {
	SinceMs       *int64
	UntilMs       *int64
	WorkspaceName *string
}

func QueryRiskOverviewTrend(db *sql.DB, q RiskOverviewTrendQuery) ([]RiskOverviewTrend, error) {
	if db == nil {
		return []RiskOverviewTrend{}, nil
	}

	// Default to last 7 days if no time range specified
	if q.SinceMs == nil || q.UntilMs == nil {
		now := time.Now().UnixMilli()
		if q.UntilMs == nil {
			q.UntilMs = &now
		}
		if q.SinceMs == nil && q.UntilMs != nil {
			sevenDaysMs := int64(7 * 24 * 60 * 60 * 1000)
			since := *q.UntilMs - sevenDaysMs
			q.SinceMs = &since
		}
	}

	dayExprRes := "strftime('%Y-%m-%d', datetime(CAST(COALESCE(ra.start_time_ms, 0) AS REAL) / 1000, 'unixepoch'))"
	dayExprCmd := "strftime('%Y-%m-%d', datetime(CAST(COALESCE(e.start_time_ms, 0) AS REAL) / 1000, 'unixepoch'))"
	dayExprPol := "strftime('%Y-%m-%d', datetime(CAST(COALESCE(sa.created_at_ms, 0) AS REAL) / 1000, 'unixepoch'))"
	if !sqlutil.IsSQLite(db) {
		dayExprRes = "TO_CHAR(TO_TIMESTAMP(COALESCE(ra.start_time_ms, 0) / 1000.0), 'YYYY-MM-DD')"
		dayExprCmd = "TO_CHAR(TO_TIMESTAMP(COALESCE(e.start_time_ms, 0) / 1000.0), 'YYYY-MM-DD')"
		dayExprPol = "TO_CHAR(TO_TIMESTAMP(COALESCE(sa.created_at_ms, 0) / 1000.0), 'YYYY-MM-DD')"
	}

	where := []string{"1=1"}
	var args []any

	if q.SinceMs != nil && *q.SinceMs > 0 {
		where = append(where, "COALESCE(ra.start_time_ms, 0) >= ?")
		args = append(args, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		where = append(where, "COALESCE(ra.start_time_ms, 0) <= ?")
		args = append(args, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		where = append(where, "lower(COALESCE(NULLIF(TRIM(ra.workspace_name), ''), 'OpenClaw')) = lower(?)")
		ws := strings.TrimSpace(*q.WorkspaceName)
		args = append(args, ws)
	}

	// SQL to aggregate resource data with severity distribution
	resourceSQL := fmt.Sprintf(`
SELECT %s AS day,
       SUM(CASE WHEN ra.risk_flags LIKE '%%sensitive_path%%' THEN 1 ELSE 0 END) AS p0,
       SUM(CASE WHEN (ra.risk_flags LIKE '%%pii_hint%%' OR ra.risk_flags LIKE '%%credential_hint%%') THEN 1 ELSE 0 END) AS p1,
       SUM(CASE WHEN (ra.risk_flags LIKE '%%large_read%%' OR ra.risk_flags LIKE '%%redundant_read%%') THEN 1 ELSE 0 END) AS p2,
       SUM(CASE WHEN ra.risk_flags NOT LIKE '%%sensitive_path%%' 
                AND ra.risk_flags NOT LIKE '%%pii_hint%%' 
                AND ra.risk_flags NOT LIKE '%%credential_hint%%' 
                AND ra.risk_flags NOT LIKE '%%large_read%%' 
                AND ra.risk_flags NOT LIKE '%%redundant_read%%' THEN 1 ELSE 0 END) AS p3,
       COUNT(*) AS resource_count
FROM %s ra
WHERE %s
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
`, dayExprRes, CT.AgentResourceAccess, strings.Join(where, " AND "))

	resRows, err := db.Query(sqlutil.RebindIfPostgres(db, resourceSQL), args...)
	if err != nil {
		return []RiskOverviewTrend{}, err
	}
	defer resRows.Close()

	type resDay struct {
		Day           string
		P0            int64
		P1            int64
		P2            int64
		P3            int64
		ResourceCount int64
	}
	resMap := map[string]resDay{}
	for resRows.Next() {
		var day sql.NullString
		var p0, p1, p2, p3, rc sql.NullInt64
		if err := resRows.Scan(&day, &p0, &p1, &p2, &p3, &rc); err != nil {
			return []RiskOverviewTrend{}, err
		}
		d := strings.TrimSpace(day.String)
		if d == "" {
			continue
		}
		resMap[d] = resDay{
			Day:           d,
			P0:            p0.Int64,
			P1:            p1.Int64,
			P2:            p2.Int64,
			P3:            p3.Int64,
			ResourceCount: rc.Int64,
		}
	}
	if err := resRows.Err(); err != nil {
		return []RiskOverviewTrend{}, err
	}

	// SQL to aggregate command data
	cmdWhere := []string{"1=1"}
	var cmdArgs []any
	if q.SinceMs != nil && *q.SinceMs > 0 {
		cmdWhere = append(cmdWhere, "COALESCE(e.start_time_ms, 0) >= ?")
		cmdArgs = append(cmdArgs, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		cmdWhere = append(cmdWhere, "COALESCE(e.start_time_ms, 0) <= ?")
		cmdArgs = append(cmdArgs, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		cmdWhere = append(cmdWhere, "lower(COALESCE(NULLIF(TRIM(e.workspace_name), ''), 'OpenClaw')) = lower(?)")
		ws := strings.TrimSpace(*q.WorkspaceName)
		cmdArgs = append(cmdArgs, ws)
	}

	commandSQL := fmt.Sprintf(`
SELECT %s AS day, COUNT(*) AS command_count
FROM %s e
WHERE %s
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
`, dayExprCmd, CT.ExecCommands, strings.Join(cmdWhere, " AND "))

	cmdRows, err := db.Query(sqlutil.RebindIfPostgres(db, commandSQL), cmdArgs...)
	if err != nil {
		return []RiskOverviewTrend{}, err
	}
	defer cmdRows.Close()

	type cmdDay struct {
		Day          string
		CommandCount int64
	}
	cmdMap := map[string]cmdDay{}
	for cmdRows.Next() {
		var day sql.NullString
		var cc sql.NullInt64
		if err := cmdRows.Scan(&day, &cc); err != nil {
			return []RiskOverviewTrend{}, err
		}
		d := strings.TrimSpace(day.String)
		if d == "" {
			continue
		}
		cmdMap[d] = cmdDay{
			Day:          d,
			CommandCount: cc.Int64,
		}
	}
	if err := cmdRows.Err(); err != nil {
		return []RiskOverviewTrend{}, err
	}

	// SQL to aggregate policy data (security audit)
	polWhere := []string{"1=1"}
	var polArgs []any
	if q.SinceMs != nil && *q.SinceMs > 0 {
		polWhere = append(polWhere, "COALESCE(sa.created_at_ms, 0) >= ?")
		polArgs = append(polArgs, *q.SinceMs)
	}
	if q.UntilMs != nil && *q.UntilMs > 0 {
		polWhere = append(polWhere, "COALESCE(sa.created_at_ms, 0) <= ?")
		polArgs = append(polArgs, *q.UntilMs)
	}
	if q.WorkspaceName != nil && strings.TrimSpace(*q.WorkspaceName) != "" {
		polWhere = append(polWhere, "lower(COALESCE(NULLIF(TRIM(sa.workspace_name), ''), 'OpenClaw')) = lower(?)")
		ws := strings.TrimSpace(*q.WorkspaceName)
		polArgs = append(polArgs, ws)
	}

	policySQL := fmt.Sprintf(`
SELECT %s AS day, COUNT(*) AS policy_count
FROM %s sa
WHERE %s
GROUP BY day
HAVING day IS NOT NULL AND day <> ''
ORDER BY day ASC
`, dayExprPol, CT.SecurityPolicyHits, strings.Join(polWhere, " AND "))

	polRows, err := db.Query(sqlutil.RebindIfPostgres(db, policySQL), polArgs...)
	if err != nil {
		return []RiskOverviewTrend{}, err
	}
	defer polRows.Close()

	type polDay struct {
		Day         string
		PolicyCount int64
	}
	polMap := map[string]polDay{}
	for polRows.Next() {
		var day sql.NullString
		var pc sql.NullInt64
		if err := polRows.Scan(&day, &pc); err != nil {
			return []RiskOverviewTrend{}, err
		}
		d := strings.TrimSpace(day.String)
		if d == "" {
			continue
		}
		polMap[d] = polDay{
			Day:         d,
			PolicyCount: pc.Int64,
		}
	}
	if err := polRows.Err(); err != nil {
		return []RiskOverviewTrend{}, err
	}

	// Merge all data by day
	var dayKeys []string
	seen := map[string]struct{}{}
	for k := range resMap {
		seen[k] = struct{}{}
	}
	for k := range cmdMap {
		seen[k] = struct{}{}
	}
	for k := range polMap {
		seen[k] = struct{}{}
	}
	for k := range seen {
		dayKeys = append(dayKeys, k)
	}
	// Sort day keys
	for i := 0; i < len(dayKeys); i++ {
		for j := i + 1; j < len(dayKeys); j++ {
			if dayKeys[j] < dayKeys[i] {
				dayKeys[i], dayKeys[j] = dayKeys[j], dayKeys[i]
			}
		}
	}

	var result []RiskOverviewTrend
	for _, day := range dayKeys {
		r := resMap[day]
		c := cmdMap[day]
		p := polMap[day]

		// Parse day to timestamp (start of day)
		timestamp := int64(0)
		if len(day) == 10 {
			// Parse YYYY-MM-DD to timestamp
			t, err := time.Parse("2006-01-02", day)
			if err == nil {
				timestamp = t.UnixMilli()
			}
		}

		result = append(result, RiskOverviewTrend{
			Timestamp: timestamp,
			Date:      day,
			P0:        r.P0,
			P1:        r.P1,
			P2:        r.P2,
			P3:        r.P3,
			Command:   c.CommandCount,
			Resource:  r.ResourceCount,
			Policy:    p.PolicyCount,
		})
	}

	return result, nil
}
