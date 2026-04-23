package ingest

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"iseeagentc/internal/sqltables"
	"iseeagentc/internal/sqlutil"
)

func parseResourceAccessParams(inputJSON *string) map[string]interface{} {
	if inputJSON == nil || strings.TrimSpace(*inputJSON) == "" {
		return nil
	}

	var root map[string]interface{}
	if err := json.Unmarshal([]byte(*inputJSON), &root); err != nil {
		return nil
	}
	if p, ok := root["params"].(map[string]interface{}); ok && p != nil {
		return p
	}
	return root
}

// ResourceAccessRow represents a parsed resource access record from span metadata
type ResourceAccessRow struct {
	ResourceURI     string
	AccessMode      string
	SemanticKind    string
	Chars           int64
	Snippet         string
	URIRepeatCount  int
	RiskFlags       *string
	PolicyHintFlags *string
}

// ParseResourceAccessRow extracts resource access information from span metadata
// Note: Risk flag calculation is done at query time in model package to avoid import cycles
func ParseResourceAccessRow(metadataJSON *string) (*ResourceAccessRow, error) {
	if metadataJSON == nil || strings.TrimSpace(*metadataJSON) == "" {
		return nil, nil
	}

	var metadata map[string]interface{}
	if err := json.Unmarshal([]byte(*metadataJSON), &metadata); err != nil {
		return nil, err
	}

	resObj, ok := metadata["resource"].(map[string]interface{})
	if !ok {
		return nil, nil
	}

	row := &ResourceAccessRow{
		ResourceURI:    strFromMap(resObj, "uri"),
		AccessMode:     strFromMap(resObj, "access_mode"),
		SemanticKind:   strFromMap(resObj, "semantic_kind"),
		Chars:          int64FromMap(resObj, "chars"),
		Snippet:        strFromMap(resObj, "snippet"),
		URIRepeatCount: intFromMap(resObj, "uri_repeat_count"),
	}

	// Extract policy hint flags from metadata
	if policyHints, ok := metadata["policy_hint_flags"].(string); ok {
		row.PolicyHintFlags = &policyHints
	}

	return row, nil
}

func strFromMap(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func int64FromMap(m map[string]interface{}, key string) int64 {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case float64:
			return int64(val)
		case int:
			return int64(val)
		case int64:
			return val
		}
	}
	return 0
}

func intFromMap(m map[string]interface{}, key string) int {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case float64:
			return int(val)
		case int:
			return val
		case int64:
			return int(val)
		}
	}
	return 0
}

// SyncAgentResourceAccessRow upserts or deletes agent_resource_access for one span (ingest or backfill).
// Now infers resource access information from raw span data instead of relying on Plugin metadata.
// Risk flags are calculated and updated separately by the query layer to avoid import cycles.
func SyncAgentResourceAccessRow(tx *sql.Tx, db *sql.DB, nowMs int64,
	spanID, traceID string,
	spanName, _ string, startMs, endMs, durMs int64, spanWorkspace string,
	inputJSON, outputJSON, errorInfoJSON, metadataJSON *string,
	workspaceNameAug, projectNameAug, threadKey, agentName, channelName *string,
) error {
	tbl := sqltables.TableAgentResourceAccess

	// Parse params from input JSON
	params := parseResourceAccessParams(inputJSON)

	// Classify resource access using the new classifier
	resourceInfo := ClassifyResourceAccess(spanName, params, nil)

	// resource_uri must be a real resource identifier; otherwise remove stale row and skip.
	if !IsValidResourceURI(resourceInfo.URI) {
		_, err := tx.Exec(sqlutil.RebindIfPostgres(db, fmt.Sprintf(`DELETE FROM %s WHERE span_id = ?`, tbl)), spanID)
		return err
	}

	// Calculate character count from output
	var output interface{}
	if outputJSON != nil && strings.TrimSpace(*outputJSON) != "" {
		if err := json.Unmarshal([]byte(*outputJSON), &output); err == nil {
			// Try to extract result from output
			if outMap, ok := output.(map[string]interface{}); ok {
				if result, ok := outMap["result"]; ok {
					output = result
				}
			}
		}
	}
	chars := CalculateChars(output)

	// Extract snippet from output
	primaryText := extractPrimaryTextFromToolResult(output)
	snippet := TruncateSnippet(primaryText, 200)

	// Extract policy hint flags from metadata (still written by security policy matching in Plugin)
	policyHintFlags := ""
	if metadataJSON != nil && strings.TrimSpace(*metadataJSON) != "" {
		var metadata map[string]interface{}
		if err := json.Unmarshal([]byte(*metadataJSON), &metadata); err == nil {
			if phf, ok := metadata["policy_hint_flags"].(string); ok {
				policyHintFlags = phf
			}
		}
	}

	wsOut := strings.TrimSpace(spanWorkspace)
	if workspaceNameAug != nil && strings.TrimSpace(*workspaceNameAug) != "" {
		wsOut = strings.TrimSpace(*workspaceNameAug)
	}

	accessMode := resourceInfo.Mode
	if accessMode == "" {
		accessMode = "read"
	}

	semanticKind := resourceInfo.Kind
	if semanticKind == "" {
		semanticKind = "other"
	}

	q := fmt.Sprintf(`INSERT INTO %[1]s (
  span_id, trace_id, workspace_name, project_name, thread_key, agent_name, channel_name,
  span_name, start_time_ms, end_time_ms, duration_ms,
  resource_uri, access_mode, semantic_kind, chars, snippet, uri_repeat_count,
  risk_flags, policy_hint_flags, created_at_ms, updated_at_ms
 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
  resource_uri = excluded.resource_uri,
  access_mode = excluded.access_mode,
  semantic_kind = excluded.semantic_kind,
  chars = excluded.chars,
  snippet = excluded.snippet,
  uri_repeat_count = excluded.uri_repeat_count,
  risk_flags = excluded.risk_flags,
  policy_hint_flags = excluded.policy_hint_flags,
  created_at_ms = COALESCE(%[1]s.created_at_ms, excluded.created_at_ms),
  updated_at_ms = excluded.updated_at_ms`, tbl)

	args := []interface{}{
		spanID, traceID,
		wsOut, nullablePtrStr(projectNameAug), nullablePtrStr(threadKey), nullablePtrStr(agentName), nullablePtrStr(channelName),
		strings.TrimSpace(spanName),
		optPositiveMs(startMs), optPositiveMs(endMs), optPositiveMs(durMs),
		resourceInfo.URI, accessMode, semanticKind, chars, snippet, 0, // uri_repeat_count calculated at query time
		"", policyHintFlags, nowMs, nowMs, // risk_flags calculated at query time
	}
	_, err := tx.Exec(sqlutil.RebindIfPostgres(db, q), args...)
	return err
}
