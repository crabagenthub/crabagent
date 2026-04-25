package ingest

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	textparser "iseeagentc/internal/parser"
	"iseeagentc/internal/shellexec"
	"iseeagentc/internal/sqltables"
	"iseeagentc/internal/sqlutil"

	"github.com/google/uuid"
)

const threadTouchSep = "\x1f"
const defaultWorkspace = "OpenClaw"
const defaultProject = "openclaw"

// OpikBatchResult 与 Node POST /v1/opik/batch 响应一致。
type OpikBatchResult struct {
	Accepted struct {
		Threads     int `json:"threads"`
		Traces      int `json:"traces"`
		Spans       int `json:"spans"`
		Attachments int `json:"attachments"`
		Feedback    int `json:"feedback"`
		Raw         int `json:"raw"`
	} `json:"accepted"`
	Skipped []map[string]string `json:"skipped"`
}

func isObj(v interface{}) bool {
	_, ok := v.(map[string]interface{})
	return ok
}

func jString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok {
			if t := strings.TrimSpace(s); t != "" {
				return t
			}
		}
	}
	return ""
}

func jFloat(m map[string]interface{}, keys ...string) *float64 {
	for _, k := range keys {
		switch v := m[k].(type) {
		case float64:
			if v == v && v+1 != v {
				return &v
			}
		case int:
			f := float64(v)
			return &f
		case int64:
			f := float64(v)
			return &f
		case string:
			var f float64
			if _, err := fmt.Sscan(strings.TrimSpace(v), &f); err == nil {
				return &f
			}
		}
	}
	return nil
}

func pickInt(m map[string]interface{}, def int64, keys ...string) int64 {
	for _, k := range keys {
		if f := jFloat(m, k); f != nil {
			return int64(*f)
		}
	}
	return def
}

func pickIntOrNull(m map[string]interface{}, keys ...string) *int64 {
	for _, k := range keys {
		if f := jFloat(m, k); f != nil {
			v := int64(*f)
			return &v
		}
	}
	return nil
}

func derefInt64(p *int64, def int64) int64 {
	if p == nil {
		return def
	}
	return *p
}

func jBool01(m map[string]interface{}, keys ...string) interface{} {
	for _, k := range keys {
		switch v := m[k].(type) {
		case bool:
			if v {
				return 1
			}
			return 0
		case float64:
			if int(v) != 0 {
				return 1
			}
			return 0
		case int:
			if v != 0 {
				return 1
			}
			return 0
		}
	}
	return nil
}

func jsonStr(v interface{}) *string {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}

func jsonStrPick(m map[string]interface{}, keys ...string) *string {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return jsonStr(v)
		}
	}
	return nil
}

func sliceMap(key string, env map[string]interface{}) []map[string]interface{} {
	raw, ok := env[key].([]interface{})
	if !ok {
		return nil
	}
	var out []map[string]interface{}
	for _, it := range raw {
		if m, ok := it.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

func subagentThreadID(threadID string) bool {
	p := strings.Split(threadID, ":")
	return len(p) >= 4 && strings.EqualFold(p[0], "agent") && strings.EqualFold(p[2], "subagent")
}

func backfillSubagentParentsSQLiteSQL() string {
	th, tr := sqltables.TableAgentThreads, sqltables.TableAgentTraces
	return fmt.Sprintf(`
UPDATE %s SET parent_thread_id = (
  SELECT p.thread_id FROM %s AS t
  INNER JOIN %s AS p ON COALESCE(
    NULLIF(TRIM(json_extract(t.metadata_json, '$.parent_turn_id')), ''),
    NULLIF(TRIM(json_extract(t.metadata_json, '$.parentTurnId')), '')
  ) = p.trace_id
  WHERE t.thread_id = ? AND t.workspace_name = ? AND t.project_name = ?
    AND p.thread_id IS NOT NULL AND TRIM(p.thread_id) != '' AND p.thread_id != t.thread_id
  ORDER BY t.created_at_ms ASC LIMIT 1
) WHERE thread_id = ? AND workspace_name = ? AND project_name = ?
  AND thread_type = 'subagent' AND (parent_thread_id IS NULL OR TRIM(parent_thread_id) = '')`, th, tr, tr)
}

func backfillSubagentParentsPostgresSQL() string {
	th, tr := sqltables.TableAgentThreads, sqltables.TableAgentTraces
	return fmt.Sprintf(`
UPDATE %s SET parent_thread_id = (
  SELECT p.thread_id FROM %s AS t
  INNER JOIN %s AS p ON COALESCE(
    NULLIF(TRIM(COALESCE((COALESCE(NULLIF(TRIM(COALESCE(t.metadata_json, '')), ''), '{}'))::jsonb #>> '{parent_turn_id}', '')), ''),
    NULLIF(TRIM(COALESCE((COALESCE(NULLIF(TRIM(COALESCE(t.metadata_json, '')), ''), '{}'))::jsonb #>> '{parentTurnId}', '')), '')
  ) = p.trace_id
  WHERE t.thread_id = ? AND t.workspace_name = ? AND t.project_name = ?
    AND p.thread_id IS NOT NULL AND TRIM(p.thread_id) != '' AND p.thread_id != t.thread_id
  ORDER BY t.created_at_ms ASC LIMIT 1
) WHERE thread_id = ? AND workspace_name = ? AND project_name = ?
  AND thread_type = 'subagent' AND (parent_thread_id IS NULL OR TRIM(parent_thread_id) = '')`, th, tr, tr)
}

func backfillSubagentParents(tx *sql.Tx, touched map[string]struct{}, db *sql.DB) {
	q1 := backfillSubagentParentsPostgresSQL()
	if sqlutil.IsSQLite(db) {
		q1 = backfillSubagentParentsSQLiteSQL()
	}
	q1 = sqlutil.RebindIfPostgres(db, q1)
	for k := range touched {
		parts := strings.Split(k, threadTouchSep)
		if len(parts) != 3 {
			continue
		}
		ws, proj, tid := parts[0], parts[1], parts[2]
		_, _ = tx.Exec(q1, tid, ws, proj, tid, ws, proj)
	}
}

type securityAuditFinding struct {
	PolicyID     string  `json:"policy_id"`
	PolicyName   string  `json:"policy_name"`
	MatchCount   int     `json:"match_count"`
	PolicyAction string  `json:"policy_action"`
	RedactType   string  `json:"redact_type"`
	HintType     *string `json:"hint_type,omitempty"`
}

type scanSummary struct {
	HitCount    int
	Intercepted int
	ObserveOnly int
}

type spanSecurityScan struct {
	TraceID     string
	Findings    []securityAuditFinding
	HitCount    int
	Intercepted int
	ObserveOnly int
}

type compiledPolicy struct {
	Policy ingestInterceptionPolicy
	Regex  *regexp.Regexp
}

type ingestInterceptionPolicy struct {
	ID            string
	Name          string
	Pattern       string
	RedactType    string
	Enabled       int
	PolicyAction  *string
	HintType      *string
	DetectionKind *string
}

func compareIngestPoliciesByRedactionOrder(a, b *ingestInterceptionPolicy) int {
	priority := func(p *ingestInterceptionPolicy) int {
		if p == nil {
			return 99
		}
		switch strings.ToLower(strings.TrimSpace(p.RedactType)) {
		case "block":
			return 0
		case "mask":
			return 1
		case "hash":
			return 2
		default:
			return 3
		}
	}
	ap, bp := priority(a), priority(b)
	if ap != bp {
		if ap < bp {
			return -1
		}
		return 1
	}
	an := strings.ToLower(strings.TrimSpace(a.Name))
	bn := strings.ToLower(strings.TrimSpace(b.Name))
	if an < bn {
		return -1
	}
	if an > bn {
		return 1
	}
	return 0
}

func loadPoliciesForIngest(db *sql.DB, workspaceName string) ([]ingestInterceptionPolicy, error) {
	ws := strings.TrimSpace(workspaceName)
	if ws == "" {
		ws = defaultWorkspace
	}
	rows, err := db.Query(fmt.Sprintf(`
SELECT id, name, pattern, redact_type, enabled, policy_action, hint_type, detection_kind
FROM %s
WHERE lower(workspace_name) = lower(?)
ORDER BY updated_at_ms DESC`, sqltables.TableAgentSecurityPolicies), ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ingestInterceptionPolicy, 0)
	for rows.Next() {
		var it ingestInterceptionPolicy
		var pa, ht, dk sql.NullString
		if err := rows.Scan(&it.ID, &it.Name, &it.Pattern, &it.RedactType, &it.Enabled, &pa, &ht, &dk); err != nil {
			return nil, err
		}
		if pa.Valid {
			s := pa.String
			it.PolicyAction = &s
		}
		if ht.Valid {
			s := ht.String
			it.HintType = &s
		}
		if dk.Valid {
			s := dk.String
			it.DetectionKind = &s
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func compilePolicies(policies []ingestInterceptionPolicy) []compiledPolicy {
	sorted := append([]ingestInterceptionPolicy{}, policies...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return compareIngestPoliciesByRedactionOrder(&sorted[i], &sorted[j]) < 0
	})
	out := make([]compiledPolicy, 0, len(sorted))
	for _, p := range sorted {
		if p.Enabled == 0 {
			continue
		}
		if p.DetectionKind != nil && strings.EqualFold(strings.TrimSpace(*p.DetectionKind), "model") {
			continue
		}
		pat := strings.TrimSpace(p.Pattern)
		if pat == "" {
			continue
		}
		re, err := regexp.Compile(pat)
		if err != nil {
			continue
		}
		out = append(out, compiledPolicy{Policy: p, Regex: re})
	}
	return out
}

func scanTextByPolicies(policies []compiledPolicy, text string) []securityAuditFinding {
	out := make([]securityAuditFinding, 0)
	for _, cp := range policies {
		n := len(cp.Regex.FindAllStringIndex(text, -1))
		if n <= 0 {
			continue
		}
		action := "data_mask"
		if cp.Policy.PolicyAction != nil && strings.TrimSpace(*cp.Policy.PolicyAction) != "" {
			action = strings.TrimSpace(*cp.Policy.PolicyAction)
		}
		redactType := strings.TrimSpace(cp.Policy.RedactType)
		if redactType == "" {
			redactType = "mask"
		}
		out = append(out, securityAuditFinding{
			PolicyID:     cp.Policy.ID,
			PolicyName:   cp.Policy.Name,
			MatchCount:   n,
			PolicyAction: action,
			RedactType:   redactType,
			HintType:     cp.Policy.HintType,
		})
	}
	return out
}

func summarizeFindings(findings []securityAuditFinding) scanSummary {
	out := scanSummary{}
	enforceHit := false
	observeHit := false
	for _, f := range findings {
		out.HitCount += f.MatchCount
		if strings.EqualFold(strings.TrimSpace(f.PolicyAction), "audit_only") {
			observeHit = true
		} else {
			enforceHit = true
		}
	}
	if enforceHit {
		out.Intercepted = 1
	}
	if observeHit && !enforceHit {
		out.ObserveOnly = 1
	}
	return out
}

func mergeCrabagentInterception(metadata interface{}, summary scanSummary, findings []securityAuditFinding) interface{} {
	if summary.HitCount <= 0 {
		return metadata
	}
	base := map[string]interface{}{}
	if m, ok := metadata.(map[string]interface{}); ok && m != nil {
		for k, v := range m {
			base[k] = v
		}
	} else if s, ok := metadata.(string); ok && strings.TrimSpace(s) != "" {
		_ = json.Unmarshal([]byte(s), &base)
	}
	mode := "observe"
	if summary.Intercepted == 1 {
		mode = "enforce"
	}
	seenTags := map[string]struct{}{}
	seenIDs := map[string]struct{}{}
	var tags []string
	var ids []string
	for _, f := range findings {
		if pn := strings.TrimSpace(f.PolicyName); pn != "" {
			if _, ok := seenTags[pn]; !ok {
				seenTags[pn] = struct{}{}
				tags = append(tags, pn)
			}
		}
		if pid := strings.TrimSpace(f.PolicyID); pid != "" {
			if _, ok := seenIDs[pid]; !ok {
				seenIDs[pid] = struct{}{}
				ids = append(ids, pid)
			}
		}
	}
	base["crabagent_interception"] = map[string]interface{}{
		"version":     1,
		"intercepted": summary.Intercepted == 1,
		"mode":        mode,
		"hit_count":   summary.HitCount,
		"tags":        tags,
		"policy_ids":  ids,
	}
	return base
}

func metadataObject(metadata interface{}) map[string]interface{} {
	if m, ok := metadata.(map[string]interface{}); ok && m != nil {
		return m
	}
	if s, ok := metadata.(string); ok && strings.TrimSpace(s) != "" {
		out := map[string]interface{}{}
		if json.Unmarshal([]byte(s), &out) == nil {
			return out
		}
	}
	return nil
}

func boolish01(v interface{}) int {
	switch x := v.(type) {
	case bool:
		if x {
			return 1
		}
	case float64:
		if int(x) != 0 {
			return 1
		}
	case int:
		if x != 0 {
			return 1
		}
	case int64:
		if x != 0 {
			return 1
		}
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		if s == "1" || s == "true" || s == "yes" {
			return 1
		}
	}
	return 0
}

func stringSliceFromAny(v interface{}) []string {
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func fallbackPolicyAction(summary map[string]interface{}, intercepted int) string {
	if mode, ok := summary["mode"].(string); ok {
		switch strings.ToLower(strings.TrimSpace(mode)) {
		case "observe":
			return "audit_only"
		case "enforce":
			return "abort_run"
		}
	}
	if intercepted == 1 {
		return "abort_run"
	}
	return "audit_only"
}

func extractSecurityScanFromMetadata(metadata interface{}) (spanSecurityScan, bool) {
	meta := metadataObject(metadata)
	if len(meta) == 0 {
		return spanSecurityScan{}, false
	}

	var findings []securityAuditFinding
	if raw, ok := meta["crabagent_interception_findings"].([]interface{}); ok {
		findings = make([]securityAuditFinding, 0, len(raw))
		for _, item := range raw {
			obj, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			matchCount := int(pickInt(obj, 0, "match_count"))
			policyID := jString(obj, "policy_id")
			policyName := jString(obj, "policy_name")
			policyAction := jString(obj, "policy_action")
			if policyAction == "" {
				policyAction = "audit_only"
			}
			redactType := jString(obj, "redact_type")
			if redactType == "" {
				redactType = "mask"
			}
			var hintType *string
			if ht := jString(obj, "hint_type"); ht != "" {
				hintType = &ht
			}
			findings = append(findings, securityAuditFinding{
				PolicyID:     policyID,
				PolicyName:   policyName,
				MatchCount:   matchCount,
				PolicyAction: policyAction,
				RedactType:   redactType,
				HintType:     hintType,
			})
		}
	}

	summaryObj, _ := meta["crabagent_interception"].(map[string]interface{})
	summary := scanSummary{}
	if len(findings) > 0 {
		summary = summarizeFindings(findings)
	}
	if len(summaryObj) > 0 {
		if hits := int(pickInt(summaryObj, 0, "hit_count")); hits > 0 {
			summary.HitCount = hits
		}
		if inter := boolish01(summaryObj["intercepted"]); inter == 1 {
			summary.Intercepted = 1
			summary.ObserveOnly = 0
		} else if strings.EqualFold(strings.TrimSpace(jString(summaryObj, "mode")), "observe") {
			summary.ObserveOnly = 1
			summary.Intercepted = 0
		}
	}

	if len(findings) == 0 && len(summaryObj) > 0 {
		policyIDs := stringSliceFromAny(summaryObj["policy_ids"])
		tags := stringSliceFromAny(summaryObj["tags"])
		n := len(policyIDs)
		if len(tags) > n {
			n = len(tags)
		}
		if n == 0 && summary.HitCount > 0 {
			n = 1
		}
		action := fallbackPolicyAction(summaryObj, summary.Intercepted)
		for i := 0; i < n; i++ {
			pid := ""
			if i < len(policyIDs) {
				pid = policyIDs[i]
			}
			name := ""
			if i < len(tags) {
				name = tags[i]
			}
			if name == "" {
				name = pid
			}
			matchCount := 0
			if n > 0 && summary.HitCount > 0 {
				matchCount = summary.HitCount / n
				if i < summary.HitCount%n {
					matchCount++
				}
			}
			findings = append(findings, securityAuditFinding{
				PolicyID:     pid,
				PolicyName:   name,
				MatchCount:   matchCount,
				PolicyAction: action,
				RedactType:   "mask",
			})
		}
	}

	if summary.HitCount <= 0 && (summary.Intercepted == 1 || summary.ObserveOnly == 1) && len(findings) > 0 {
		for _, f := range findings {
			summary.HitCount += f.MatchCount
		}
		if summary.HitCount <= 0 {
			summary.HitCount = len(findings)
		}
	}

	if summary.HitCount <= 0 && summary.Intercepted == 0 && summary.ObserveOnly == 0 && len(findings) == 0 {
		return spanSecurityScan{}, false
	}

	return spanSecurityScan{
		Findings:    findings,
		HitCount:    summary.HitCount,
		Intercepted: summary.Intercepted,
		ObserveOnly: summary.ObserveOnly,
	}, true
}

func redactStringByPolicies(in string, policies []compiledPolicy) string {
	out := in
	for _, cp := range policies {
		redactType := strings.ToLower(strings.TrimSpace(cp.Policy.RedactType))
		out = cp.Regex.ReplaceAllStringFunc(out, func(m string) string {
			switch redactType {
			case "hash":
				sum := sha256.Sum256([]byte(m))
				return "[REDACTED_HASH:" + fmt.Sprintf("%x", sum[:6]) + "]"
			case "block":
				return "[REDACTED_BLOCK]"
			case "mask":
				// 保留前后部分，中间遮蔽
				if len(m) <= 4 {
					return "****"
				}
				prefixLen := len(m) / 4
				suffixLen := len(m) / 4
				maskLen := len(m) - prefixLen - suffixLen
				return m[:prefixLen] + strings.Repeat("*", maskLen) + m[len(m)-suffixLen:]
			default:
				return "[REDACTED]"
			}
		})
	}
	return out
}

func redactObjectByPolicies(v interface{}, policies []compiledPolicy) interface{} {
	switch t := v.(type) {
	case map[string]interface{}:
		for k, vv := range t {
			t[k] = redactObjectByPolicies(vv, policies)
		}
		return t
	case []interface{}:
		for i := range t {
			t[i] = redactObjectByPolicies(t[i], policies)
		}
		return t
	case string:
		return redactStringByPolicies(t, policies)
	default:
		return v
	}
}

func applyIngestPolicyRedaction(env map[string]interface{}, policies []compiledPolicy) {
	if strings.TrimSpace(os.Getenv("CRABAGENT_INGEST_NO_REDACT")) == "1" {
		return
	}
	for _, key := range []string{"threads", "traces", "spans", "attachments", "feedback", "envelope_json"} {
		if raw, ok := env[key]; ok && raw != nil {
			env[key] = redactObjectByPolicies(raw, policies)
		}
	}
}

func scanOpikBatchForSecurityAudit(env map[string]interface{}, policies []compiledPolicy) (map[string]spanSecurityScan, map[string]spanSecurityScan) {
	traceScans := map[string]spanSecurityScan{}
	spanScans := map[string]spanSecurityScan{}
	if len(policies) > 0 {
		for _, row := range sliceMap("traces", env) {
			traceID := jString(row, "trace_id", "id")
			if traceID == "" {
				continue
			}
			text := fmt.Sprintf("%s\n%s\n%s", derefStr(jsonStr(row["input"])), derefStr(jsonStr(row["output"])), derefStr(jsonStr(row["metadata"])))
			findings := scanTextByPolicies(policies, text)
			sum := summarizeFindings(findings)
			if sum.HitCount <= 0 {
				continue
			}
			traceScans[traceID] = spanSecurityScan{
				TraceID:     traceID,
				Findings:    findings,
				HitCount:    sum.HitCount,
				Intercepted: sum.Intercepted,
				ObserveOnly: sum.ObserveOnly,
			}
		}
		for _, row := range sliceMap("spans", env) {
			spanID := jString(row, "span_id", "id")
			traceID := jString(row, "trace_id")
			if spanID == "" || traceID == "" {
				continue
			}
			text := fmt.Sprintf("%s\n%s\n%s", derefStr(jsonStr(row["input"])), derefStr(jsonStr(row["output"])), derefStr(jsonStr(row["metadata"])))
			findings := scanTextByPolicies(policies, text)
			sum := summarizeFindings(findings)
			if sum.HitCount <= 0 {
				continue
			}
			spanScans[spanID] = spanSecurityScan{
				TraceID:     traceID,
				Findings:    findings,
				HitCount:    sum.HitCount,
				Intercepted: sum.Intercepted,
				ObserveOnly: sum.ObserveOnly,
			}
		}
	}
	for _, row := range sliceMap("traces", env) {
		traceID := jString(row, "trace_id", "id")
		if traceID == "" {
			continue
		}
		if _, ok := traceScans[traceID]; ok {
			continue
		}
		if scan, ok := extractSecurityScanFromMetadata(row["metadata"]); ok {
			scan.TraceID = traceID
			traceScans[traceID] = scan
		}
	}
	for _, row := range sliceMap("spans", env) {
		spanID := jString(row, "span_id", "id")
		traceID := jString(row, "trace_id")
		if spanID == "" || traceID == "" {
			continue
		}
		if _, ok := spanScans[spanID]; ok {
			continue
		}
		if scan, ok := extractSecurityScanFromMetadata(row["metadata"]); ok {
			scan.TraceID = traceID
			spanScans[spanID] = scan
		}
	}
	return traceScans, spanScans
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func prepareSecurityAuditInsert(tx *sql.Tx, db *sql.DB) ([]string, string) {
	cols := map[string]struct{}{}
	if sqlutil.IsSQLite(db) {
		rows, err := tx.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, sqltables.TableAgentSecurityAuditLogs))
		if err != nil {
			return nil, ""
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dflt interface{}
			if rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk) == nil {
				cols[name] = struct{}{}
			}
		}
	} else {
		rows, err := tx.Query(`
SELECT column_name
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = $1`, sqltables.TableAgentSecurityAuditLogs)
		if err != nil {
			return nil, ""
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if rows.Scan(&name) == nil && name != "" {
				cols[name] = struct{}{}
			}
		}
	}
	order := []string{
		"id", "created_at_ms", "timestamp_ms", "trace_id", "span_id", "workspace_name", "project_name",
		"findings_json", "total_findings", "hit_count", "intercepted", "observe_only",
	}
	var picked []string
	for _, c := range order {
		if _, ok := cols[c]; ok {
			picked = append(picked, c)
		}
	}
	if len(picked) == 0 {
		return nil, ""
	}
	placeholders := make([]string, len(picked))
	if sqlutil.IsSQLite(db) {
		for i := range placeholders {
			placeholders[i] = "?"
		}
	} else {
		for i := range placeholders {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
		}
	}
	return picked, `INSERT INTO ` + sqltables.TableAgentSecurityAuditLogs + ` (` + strings.Join(picked, ", ") + `) VALUES (` + strings.Join(placeholders, ", ") + `)`
}

func securityAuditArgs(columns []string, now int64, traceID string, spanID interface{}, ws, proj, findingsJSON string, totalFindings, hitCount, intercepted, observeOnly int) []interface{} {
	args := make([]interface{}, 0, len(columns))
	for _, c := range columns {
		switch c {
		case "id":
			args = append(args, uuid.NewString())
		case "created_at_ms":
			args = append(args, now)
		case "timestamp_ms":
			args = append(args, now)
		case "trace_id":
			args = append(args, traceID)
		case "span_id":
			args = append(args, spanID)
		case "workspace_name":
			args = append(args, ws)
		case "project_name":
			args = append(args, proj)
		case "findings_json":
			args = append(args, findingsJSON)
		case "total_findings":
			args = append(args, totalFindings)
		case "hit_count":
			args = append(args, hitCount)
		case "intercepted":
			args = append(args, intercepted)
		case "observe_only":
			args = append(args, observeOnly)
		}
	}
	return args
}

// ApplyOpikBatch 写入 threads/traces/spans/attachments/feedback（与 Node 核心路径对齐；不含 ingest 脱敏与安全审计扫描）。
func ApplyOpikBatch(db *sql.DB, body interface{}) (*OpikBatchResult, error) {

	out := &OpikBatchResult{}
	if !isObj(body) {
		out.Skipped = []map[string]string{{"reason": "expected_object", "at": "body"}}
		return out, nil
	}
	env := body.(map[string]interface{})

	// 打印 json 格式
	jsonBytes, _ := json.Marshal(env)
	println("-------------------------------------------------------")
	println(string(jsonBytes))

	policies, _ := loadPoliciesForIngest(db, defaultWorkspace)
	compiledPolicies := compilePolicies(policies)
	traceScans, spanScans := scanOpikBatchForSecurityAudit(env, compiledPolicies)
	applyIngestPolicyRedaction(env, compiledPolicies)

	for _, row := range sliceMap("traces", env) {
		traceID := jString(row, "trace_id", "id")
		if traceID == "" {
			continue
		}
		if scan, ok := traceScans[traceID]; ok {
			row["metadata"] = mergeCrabagentInterception(row["metadata"], scanSummary{
				HitCount:    scan.HitCount,
				Intercepted: scan.Intercepted,
				ObserveOnly: scan.ObserveOnly,
			}, scan.Findings)
		}
	}
	for _, row := range sliceMap("spans", env) {
		spanID := jString(row, "span_id", "id")
		if spanID == "" {
			continue
		}
		if scan, ok := spanScans[spanID]; ok {
			row["metadata"] = mergeCrabagentInterception(row["metadata"], scanSummary{
				HitCount:    scan.HitCount,
				Intercepted: scan.Intercepted,
				ObserveOnly: scan.ObserveOnly,
			}, scan.Findings)
		}
	}

	now := time.Now().UnixMilli()
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if env["envelope_json"] != nil {
		if js := jsonStr(env["envelope_json"]); js != nil {
			if _, err := tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`INSERT INTO %s (received_at_ms, route, trace_id, span_id, body_json) VALUES (?, 'batch', NULL, NULL, ?)`, sqltables.TableAgentRawIngest)), now, *js); err == nil {
				out.Accepted.Raw++
			}
		}
	}

	touched := map[string]struct{}{}

	for i, row := range sliceMap("threads", env) {
		tid := jString(row, "thread_id")
		if tid == "" {
			out.Skipped = append(out.Skipped, map[string]string{"reason": "missing_thread_id", "at": fmt.Sprintf("threads[%d]", i)})
			continue
		}
		ws := jString(row, "workspace_name")
		if ws == "" {
			ws = defaultWorkspace
		}
		proj := jString(row, "project_name")
		if proj == "" {
			proj = defaultProject
		}
		tt := jString(row, "thread_type", "threadType")
		if tt == "" {
			tt = "main"
		}
		if subagentThreadID(tid) || strings.EqualFold(tt, "subagent") {
			tt = "subagent"
		} else {
			tt = "main"
		}
		parent := jString(row, "parent_thread_id", "parentThreadId")
		var p interface{}
		if parent != "" {
			p = parent
		}
		tblTh := sqltables.TableAgentThreads
		_, err := tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`
INSERT INTO %[1]s (thread_id, workspace_name, project_name, thread_type, parent_thread_id, first_seen_ms, last_seen_ms, metadata_json, agent_name, channel_name)
VALUES (?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(thread_id, workspace_name, project_name) DO UPDATE SET
 last_seen_ms = MAX(%[1]s.last_seen_ms, excluded.last_seen_ms),
 first_seen_ms = MIN(%[1]s.first_seen_ms, excluded.first_seen_ms),
 metadata_json = COALESCE(excluded.metadata_json, %[1]s.metadata_json),
 agent_name = COALESCE(NULLIF(TRIM(excluded.agent_name),''), %[1]s.agent_name),
 channel_name = COALESCE(NULLIF(TRIM(excluded.channel_name),''), %[1]s.channel_name),
 thread_type = CASE WHEN NULLIF(TRIM(excluded.thread_type),'') = 'main' AND %[1]s.thread_type = 'subagent' THEN %[1]s.thread_type
  ELSE COALESCE(NULLIF(TRIM(excluded.thread_type),''), %[1]s.thread_type) END,
 parent_thread_id = COALESCE(NULLIF(TRIM(excluded.parent_thread_id),''), %[1]s.parent_thread_id)`, tblTh)),
			tid, ws, proj, tt, p, pickInt(row, now, "first_seen_ms"), pickInt(row, now, "last_seen_ms"), jsonStr(row["metadata"]),
			nullable(jString(row, "agent_name", "agentName")), nullable(jString(row, "channel_name", "channelName")))
		if err != nil {
			out.Skipped = append(out.Skipped, map[string]string{"reason": err.Error(), "at": fmt.Sprintf("threads[%d]", i)})
			continue
		}
		out.Accepted.Threads++
	}

	for i, row := range sliceMap("traces", env) {
		traceID := jString(row, "trace_id", "id")
		if traceID == "" {
			out.Skipped = append(out.Skipped, map[string]string{"reason": "missing_trace_id", "at": fmt.Sprintf("traces[%d]", i)})
			continue
		}
		ws := jString(row, "workspace_name")
		if ws == "" {
			ws = defaultWorkspace
		}
		proj := jString(row, "project_name")
		if proj == "" {
			proj = defaultProject
		}
		th := jString(row, "thread_id")
		created := pickInt(row, now, "created_at_ms")
		if th != "" {
			touched[ws+threadTouchSep+proj+threadTouchSep+th] = struct{}{}
			tt := "main"
			if subagentThreadID(th) {
				tt = "subagent"
			}
			meta := map[string]interface{}{}
			if m, ok := row["metadata"].(map[string]interface{}); ok {
				meta = m
			}
			anchor := jString(meta, "anchor_parent_thread_id", "anchorParentThreadId")
			var ap interface{}
			if anchor != "" {
				ap = anchor
			}
			// Extract agent_name and channel_name from metadata if available
			var agentName, channelName string
			if oc, ok := meta["openclaw_context"].(map[string]interface{}); ok {
				if aid, ok := oc["agentId"].(string); ok {
					agentName = aid
				}
				if cid, ok := oc["channelId"].(string); ok && strings.TrimSpace(cid) != "" {
					channelName = cid
				} else if mp, ok := oc["messageProvider"].(string); ok && strings.TrimSpace(mp) != "" {
					channelName = mp
				}
			}
			tblTh := sqltables.TableAgentThreads
			_, _ = tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`
INSERT INTO %[1]s (thread_id, workspace_name, project_name, thread_type, parent_thread_id, first_seen_ms, last_seen_ms, metadata_json, agent_name, channel_name)
VALUES (?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(thread_id, workspace_name, project_name) DO UPDATE SET
 last_seen_ms = MAX(%[1]s.last_seen_ms, excluded.last_seen_ms),
 first_seen_ms = MIN(%[1]s.first_seen_ms, excluded.first_seen_ms),
 metadata_json = COALESCE(excluded.metadata_json, %[1]s.metadata_json),
 agent_name = COALESCE(NULLIF(TRIM(excluded.agent_name),''), %[1]s.agent_name),
 channel_name = COALESCE(NULLIF(TRIM(excluded.channel_name),''), %[1]s.channel_name)`, tblTh)), th, ws, proj, tt, ap, created, created, jsonStr(meta), nullable(agentName), nullable(channelName))
		}
		var prevMeta, prevSet sql.NullString
		_ = tx.QueryRow(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT metadata_json, setting_json FROM %s WHERE trace_id = ?`, sqltables.TableAgentTraces)), traceID).Scan(&prevMeta, &prevSet)
		meta := map[string]interface{}{}
		if m, ok := row["metadata"].(map[string]interface{}); ok {
			for k, v := range m {
				meta[k] = v
			}
		}
		if row["tags"] != nil && meta["legacy_tags"] == nil {
			meta["legacy_tags"] = row["tags"]
		}
		merged := mergeMeta(meta, &prevMeta)
		traceType := "external"
		if m, ok := merged.(map[string]interface{}); ok {
			if s := jString(m, "run_kind", "runKind"); s == "async_followup" {
				traceType = "async_command"
			} else if s == "external" || s == "subagent" || s == "system" {
				traceType = s
			}
		}
		if s := jString(row, "trace_type", "traceType"); s != "" {
			ls := strings.ToLower(s)
			if ls == "external" || ls == "subagent" || ls == "async_command" || ls == "system" {
				traceType = ls
			}
		}
		sub := jString(row, "subagent_thread_id", "subagentThreadId")
		setting := mergeOpenClawSetting(row["setting"], row["setting_json"], meta["openclaw_routing"], prevSet)
		inNorm := textparser.NormalizeOpikTraceInputForStorage(row["input"])
		cf := jString(row, "created_from")
		if cf == "" {
			cf = "openclaw-iseeu"
		}
		tblTr := sqltables.TableAgentTraces
		_, err := tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`
INSERT INTO %[1]s (trace_id, thread_id, workspace_name, project_name, trace_type, subagent_thread_id,
 name, input_json, output_json, metadata_json, setting_json, error_info_json, success, duration_ms, total_cost,
 created_at_ms, updated_at_ms, ended_at_ms, is_complete, created_from) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(trace_id) DO UPDATE SET
 thread_id = COALESCE(excluded.thread_id, %[1]s.thread_id),
 workspace_name = excluded.workspace_name, project_name = excluded.project_name,
 trace_type = COALESCE(excluded.trace_type, %[1]s.trace_type),
 subagent_thread_id = COALESCE(excluded.subagent_thread_id, %[1]s.subagent_thread_id),
 name = COALESCE(excluded.name, %[1]s.name),
 input_json = COALESCE(excluded.input_json, %[1]s.input_json),
 output_json = COALESCE(excluded.output_json, %[1]s.output_json),
 metadata_json = COALESCE(excluded.metadata_json, %[1]s.metadata_json),
 setting_json = COALESCE(excluded.setting_json, %[1]s.setting_json),
 error_info_json = COALESCE(excluded.error_info_json, %[1]s.error_info_json),
 success = COALESCE(excluded.success, %[1]s.success),
 duration_ms = COALESCE(excluded.duration_ms, %[1]s.duration_ms),
 total_cost = COALESCE(excluded.total_cost, %[1]s.total_cost),
 created_at_ms = COALESCE(excluded.created_at_ms, %[1]s.created_at_ms),
 updated_at_ms = COALESCE(excluded.updated_at_ms, %[1]s.updated_at_ms),
 ended_at_ms = COALESCE(excluded.ended_at_ms, %[1]s.ended_at_ms),
 is_complete = MAX(excluded.is_complete, %[1]s.is_complete),
 created_from = COALESCE(excluded.created_from, %[1]s.created_from)`, tblTr)),
			traceID, nullable(th), ws, proj, traceType, nullable(sub),
			nullable(jString(row, "name")), jsonStr(inNorm), jsonStr(row["output"]), jsonStr(merged), setting,
			jsonStrPick(row, "error_info", "errorInfo"), jBool01(row, "success"), pickIntOrNull(row, "duration_ms", "durationMs"), pickIntOrNull(row, "total_cost", "totalCost"),
			created, pickIntOrNull(row, "updated_at_ms", "updatedAtMs"), pickIntOrNull(row, "ended_at_ms", "end_time_ms", "endTimeMs"),
			pickInt(row, 0, "is_complete", "isComplete"), cf)
		if err != nil {
			out.Skipped = append(out.Skipped, map[string]string{"reason": err.Error(), "at": fmt.Sprintf("traces[%d]", i)})
			continue
		}
		if _, ok := traceScans[traceID]; !ok {
			if scan, ok := extractSecurityScanFromMetadata(merged); ok {
				scan.TraceID = traceID
				traceScans[traceID] = scan
			}
		}
		out.Accepted.Traces++
	}
	backfillSubagentParents(tx, touched, db)

	shellCfg := shellexec.LoadResourceAuditConfig()
	type traceEnv struct {
		WS, Proj, ThreadID string
	}
	traceEnvByID := make(map[string]traceEnv)
	for _, row := range sliceMap("traces", env) {
		traceID := jString(row, "trace_id", "id")
		if traceID == "" {
			continue
		}
		ws := jString(row, "workspace_name")
		if ws == "" {
			ws = defaultWorkspace
		}
		proj := jString(row, "project_name")
		if proj == "" {
			proj = defaultProject
		}
		traceEnvByID[traceID] = traceEnv{WS: ws, Proj: proj, ThreadID: jString(row, "thread_id")}
	}
	threadAgentChannel := make(map[string]struct{ A, C string })
	for _, row := range sliceMap("threads", env) {
		tid := jString(row, "thread_id")
		if tid == "" {
			continue
		}
		ws := jString(row, "workspace_name")
		if ws == "" {
			ws = defaultWorkspace
		}
		proj := jString(row, "project_name")
		if proj == "" {
			proj = defaultProject
		}
		key := tid + threadTouchSep + ws + threadTouchSep + proj
		threadAgentChannel[key] = struct{ A, C string }{
			A: jString(row, "agent_name", "agentName"),
			C: jString(row, "channel_name", "channelName"),
		}
	}

	for i, row := range sliceMap("spans", env) {
		sid := jString(row, "span_id", "id")
		tid := jString(row, "trace_id")
		if sid == "" || tid == "" {
			out.Skipped = append(out.Skipped, map[string]string{"reason": "missing_span_or_trace_id", "at": fmt.Sprintf("spans[%d]", i)})
			continue
		}
		st := strings.ToLower(jString(row, "type", "span_type"))
		if st != "general" && st != "tool" && st != "llm" && st != "guardrail" {
			st = "general"
		}
		ws := jString(row, "workspace_name")
		if ws == "" {
			ws = defaultWorkspace
		}
		var prevM, prevS, prevU sql.NullString
		_ = tx.QueryRow(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`SELECT metadata_json, setting_json, usage_preview FROM %s WHERE span_id = ?`, sqltables.TableAgentSpans)), sid).Scan(&prevM, &prevS, &prevU)
		meta := map[string]interface{}{}
		if m, ok := row["metadata"].(map[string]interface{}); ok {
			for k, v := range m {
				meta[k] = v
			}
		}
		merged := mergeMeta(meta, &prevM)
		setting := mergeOpenClawSetting(row["setting"], row["setting_json"], meta["openclaw_routing"], prevS)
		prevUP := (*string)(nil)
		if prevU.Valid {
			s := prevU.String
			prevUP = &s
		}
		uprev := usagePreview(row, prevUP)
		inSpan := textparser.NormalizeOpikSpanInputForStorage(row["input"])
		nm := jString(row, "name")
		if nm == "" {
			nm = "(unnamed)"
		}
		tblSp := sqltables.TableAgentSpans
		_, err := tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`
INSERT INTO %[1]s (span_id, trace_id, parent_span_id, name, span_type, start_time_ms, end_time_ms, duration_ms, workspace_name,
 metadata_json, input_json, output_json, setting_json, usage_json, usage_preview, model, provider, error_info_json, status, total_cost, sort_index, is_complete)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(span_id) DO UPDATE SET
 trace_id = excluded.trace_id,
 parent_span_id = COALESCE(excluded.parent_span_id, %[1]s.parent_span_id),
 name = COALESCE(excluded.name, %[1]s.name),
 span_type = COALESCE(excluded.span_type, %[1]s.span_type),
 start_time_ms = COALESCE(excluded.start_time_ms, %[1]s.start_time_ms),
 end_time_ms = COALESCE(excluded.end_time_ms, %[1]s.end_time_ms),
 duration_ms = COALESCE(excluded.duration_ms, %[1]s.duration_ms),
 workspace_name = COALESCE(excluded.workspace_name, %[1]s.workspace_name),
 metadata_json = COALESCE(excluded.metadata_json, %[1]s.metadata_json),
 input_json = COALESCE(excluded.input_json, %[1]s.input_json),
 output_json = COALESCE(excluded.output_json, %[1]s.output_json),
 setting_json = COALESCE(excluded.setting_json, %[1]s.setting_json),
 usage_json = COALESCE(excluded.usage_json, %[1]s.usage_json),
 usage_preview = COALESCE(excluded.usage_preview, %[1]s.usage_preview),
 model = COALESCE(excluded.model, %[1]s.model),
 provider = COALESCE(excluded.provider, %[1]s.provider),
 error_info_json = COALESCE(excluded.error_info_json, %[1]s.error_info_json),
 status = COALESCE(excluded.status, %[1]s.status),
 total_cost = COALESCE(excluded.total_cost, %[1]s.total_cost),
 sort_index = COALESCE(excluded.sort_index, %[1]s.sort_index),
 is_complete = MAX(excluded.is_complete, %[1]s.is_complete)`, tblSp)),
			sid, tid, nullable(jString(row, "parent_span_id", "parentSpanId")), nm, st,
			pickIntOrNull(row, "start_time_ms", "startTimeMs"), pickIntOrNull(row, "end_time_ms", "endTimeMs"), pickIntOrNull(row, "duration_ms", "durationMs"), ws,
			jsonStr(merged), jsonStr(inSpan), jsonStr(row["output"]), setting, jsonStr(row["usage"]), uprev,
			nullable(jString(row, "model")), nullable(jString(row, "provider")), jsonStrPick(row, "error_info", "errorInfo"),
			nullable(jString(row, "status")), pickIntOrNull(row, "total_cost", "totalCost"), pickInt(row, 0, "sort_index", "sortIndex"), pickInt(row, 0, "is_complete", "isComplete"))
		if err != nil {
			out.Skipped = append(out.Skipped, map[string]string{"reason": err.Error(), "at": fmt.Sprintf("spans[%d]", i)})
			continue
		}
		if _, ok := spanScans[sid]; !ok {
			if scan, ok := extractSecurityScanFromMetadata(merged); ok {
				scan.TraceID = tid
				spanScans[sid] = scan
			}
		}
		out.Accepted.Spans++

		inStr := jsonStr(inSpan)
		outStr := jsonStr(row["output"])
		errJ := jsonStrPick(row, "error_info", "errorInfo")
		metaStr := jsonStr(merged)
		var wsAug, projAug, tkAug, agAug, chAug *string
		if te, ok := traceEnvByID[tid]; ok {
			w := te.WS
			wsAug = &w
			p := te.Proj
			projAug = &p
			tk := te.ThreadID
			if strings.TrimSpace(tk) == "" {
				tk = tid
			}
			tkAug = &tk
			key := te.ThreadID + threadTouchSep + te.WS + threadTouchSep + te.Proj
			if fac, ok2 := threadAgentChannel[key]; ok2 {
				if strings.TrimSpace(fac.A) != "" {
					a := fac.A
					agAug = &a
				}
				if strings.TrimSpace(fac.C) != "" {
					c := fac.C
					chAug = &c
				}
			}
		}
		if err := SyncAgentExecCommandRow(tx, db, now, shellCfg, sid, tid, nm, st,
			pickInt(row, 0, "start_time_ms", "startTimeMs"), pickInt(row, 0, "end_time_ms", "endTimeMs"), pickInt(row, 0, "duration_ms", "durationMs"),
			ws, inStr, outStr, errJ, metaStr, wsAug, projAug, tkAug, agAug, chAug, false); err != nil {
			return nil, fmt.Errorf("agent_exec_commands span %s: %w", sid, err)
		}
		if err := SyncAgentResourceAccessRow(tx, db, now, sid, tid, nm, st,
			pickInt(row, 0, "start_time_ms", "startTimeMs"), pickInt(row, 0, "end_time_ms", "endTimeMs"), pickInt(row, 0, "duration_ms", "durationMs"),
			ws, inStr, outStr, errJ, metaStr, wsAug, projAug, tkAug, agAug, chAug); err != nil {
			return nil, fmt.Errorf("agent_resource_access span %s: %w", sid, err)
		}
	}

	traceWorkspaceProject := map[string]struct {
		WS   string
		Proj string
	}{}
	spanWorkspaceProject := map[string]struct {
		WS   string
		Proj string
	}{}
	for _, row := range sliceMap("traces", env) {
		traceID := jString(row, "trace_id", "id")
		if traceID == "" {
			continue
		}
		ws := jString(row, "workspace_name")
		if ws == "" {
			ws = defaultWorkspace
		}
		proj := jString(row, "project_name")
		if proj == "" {
			proj = defaultProject
		}
		traceWorkspaceProject[traceID] = struct {
			WS   string
			Proj string
		}{WS: ws, Proj: proj}
	}
	for _, row := range sliceMap("spans", env) {
		spanID := jString(row, "span_id", "id")
		traceID := jString(row, "trace_id")
		if spanID == "" || traceID == "" {
			continue
		}
		wp, ok := traceWorkspaceProject[traceID]
		if !ok {
			wp = struct {
				WS   string
				Proj string
			}{WS: defaultWorkspace, Proj: defaultProject}
		}
		spanWorkspaceProject[spanID] = wp
	}

	auditColumns, auditInsertSQL := prepareSecurityAuditInsert(tx, db)
	insertAudit := func(traceID string, spanID interface{}, scan spanSecurityScan, ws, proj string) error {
		if len(auditColumns) == 0 || auditInsertSQL == "" {
			return nil
		}
		findingsJSON := "[]"
		if b, err := json.Marshal(scan.Findings); err == nil {
			findingsJSON = string(b)
		}
		args := securityAuditArgs(
			auditColumns,
			now,
			traceID,
			spanID,
			ws,
			proj,
			findingsJSON,
			len(scan.Findings),
			scan.HitCount,
			scan.Intercepted,
			scan.ObserveOnly,
		)
		_, err := tx.Exec(auditInsertSQL, args...)
		if err != nil {
			return err
		}
		return nil
	}

	traceHasSpanAudit := map[string]struct{}{}
	for spanID, scan := range spanScans {
		wp, ok := spanWorkspaceProject[spanID]
		if !ok {
			wp, ok = traceWorkspaceProject[scan.TraceID]
			if !ok {
				wp = struct {
					WS   string
					Proj string
				}{WS: defaultWorkspace, Proj: defaultProject}
			}
		}
		_ = insertAudit(scan.TraceID, spanID, scan, wp.WS, wp.Proj)
		traceHasSpanAudit[scan.TraceID] = struct{}{}
	}
	for traceID, scan := range traceScans {
		if _, ok := traceHasSpanAudit[traceID]; ok {
			continue
		}
		wp, ok := traceWorkspaceProject[traceID]
		if !ok {
			wp = struct {
				WS   string
				Proj string
			}{WS: defaultWorkspace, Proj: defaultProject}
		}
		_ = insertAudit(traceID, nil, scan, wp.WS, wp.Proj)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if wss := collectOpikBatchWorkspaces(env); len(wss) > 0 {
		triggerAfterOpikCommitIngest(db, wss)
	}
	return out, nil
}

// collectOpikBatchWorkspaces returns deduplicated workspace names touched by this batch (empty workspace → default).
func collectOpikBatchWorkspaces(env map[string]interface{}) []string {
	seen := make(map[string]struct{})
	var out []string
	add := func(ws string) {
		w := strings.TrimSpace(ws)
		if w == "" {
			w = defaultWorkspace
		}
		if _, ok := seen[w]; !ok {
			seen[w] = struct{}{}
			out = append(out, w)
		}
	}
	for _, row := range sliceMap("threads", env) {
		add(jString(row, "workspace_name"))
	}
	for _, row := range sliceMap("traces", env) {
		add(jString(row, "workspace_name"))
	}
	for _, row := range sliceMap("spans", env) {
		add(jString(row, "workspace_name"))
	}
	return out
}

func nullable(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func mergeMeta(incoming map[string]interface{}, prev *sql.NullString) interface{} {
	prevMap := map[string]interface{}{}
	if prev != nil && prev.Valid && strings.TrimSpace(prev.String) != "" {
		_ = json.Unmarshal([]byte(prev.String), &prevMap)
	}
	out := make(map[string]interface{})
	for k, v := range prevMap {
		out[k] = v
	}
	for k, v := range incoming {
		out[k] = v
	}
	if usageHas(prevMap["usage"]) && !usageHas(out["usage"]) {
		out["usage"] = prevMap["usage"]
	}
	if prevMap["total_tokens"] != nil && out["total_tokens"] == nil {
		out["total_tokens"] = prevMap["total_tokens"]
	}
	if prevMap["crabagent_interception"] != nil {
		if _, ok := incoming["crabagent_interception"]; !ok {
			out["crabagent_interception"] = prevMap["crabagent_interception"]
		}
	}
	if prevMap["crabagent_interception_findings"] != nil {
		if _, ok := incoming["crabagent_interception_findings"]; !ok {
			out["crabagent_interception_findings"] = prevMap["crabagent_interception_findings"]
		}
	}
	return out
}

func usageHas(u interface{}) bool {
	m, ok := u.(map[string]interface{})
	if !ok {
		return false
	}
	for _, k := range []string{"total_tokens", "totalTokens", "prompt_tokens", "completion_tokens"} {
		if jFloat(m, k) != nil {
			return true
		}
	}
	return false
}

func mergeOpenClawSetting(setting, settingJSON, routing interface{}, prevSet sql.NullString) *string {
	prev := map[string]interface{}{}
	if prevSet.Valid && strings.TrimSpace(prevSet.String) != "" {
		_ = json.Unmarshal([]byte(prevSet.String), &prev)
	}
	out := make(map[string]interface{})
	for k, v := range prev {
		out[k] = v
	}
	absorb := func(obj map[string]interface{}) {
		for _, k := range []string{"kind", "thinking", "verbose", "reasoning", "fast"} {
			if v, ok := obj[k]; ok && v != nil {
				out[k] = v
			}
		}
	}
	if m, ok := setting.(map[string]interface{}); ok {
		absorb(m)
	}
	if s, ok := settingJSON.(string); ok && strings.TrimSpace(s) != "" {
		var nested map[string]interface{}
		if json.Unmarshal([]byte(s), &nested) == nil {
			absorb(nested)
		}
	}
	if m, ok := routing.(map[string]interface{}); ok {
		absorb(m)
	}
	if len(out) == 0 {
		return nil
	}
	b, _ := json.Marshal(out)
	ss := string(b)
	return &ss
}

func usagePreview(row map[string]interface{}, prev *string) *string {
	if s, ok := row["usage_preview"].(string); ok && strings.TrimSpace(s) != "" {
		t := strings.TrimSpace(s)
		return &t
	}
	if row["usage"] != nil {
		if j := compactUsageJSON(row["usage"]); j != "" {
			return &j
		}
	}
	return prev
}

func compactUsageJSON(u interface{}) string {
	m, ok := u.(map[string]interface{})
	if !ok {
		return ""
	}
	pt := int(deref0(jFloat(m, "prompt_tokens", "promptTokens", "input_tokens")))
	ct := int(deref0(jFloat(m, "completion_tokens", "completionTokens", "output_tokens")))
	cr := int(deref0(jFloat(m, "cache_read_tokens", "cacheReadTokens")))
	tt := jFloat(m, "total_tokens", "totalTokens", "totalTokenCount")
	total := pt + ct + cr
	if tt != nil {
		total = int(*tt)
	}
	if total <= 0 {
		return ""
	}
	b, _ := json.Marshal(map[string]int{"input": pt, "output": ct, "cacheRead": cr, "total": total})
	return string(b)
}

func deref0(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}
