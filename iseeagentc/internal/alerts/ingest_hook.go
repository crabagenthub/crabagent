package alerts

import (
	"database/sql"
	"strings"
	"sync"
	"time"

	"iseeagentc/model"
)

const ingestDebounce = 45 * time.Second

const immediateIngestDebounce = 0 * time.Second

var (
	ingestMu      sync.Mutex
	ingestLastRun = map[string]int64{} // workspace -> unix ms (windowed rules batch)
	immediateMu   sync.Mutex
	immediateLast = map[string]int64{} // "workspace|ruleID" -> unix ms
)

// OnIngestWorkspaces is called after successful collector writes (e.g. Opik batch commit).
// - immediate rules: short debounce per rule+workspace, kind=ingest_immediate
// - windowed rules: debounce per workspace (ingestDebounce), kind=ingest, RunWindowedIngestForWorkspace
func OnIngestWorkspaces(db *sql.DB, workspaces []string) {
	if db == nil {
		return
	}
	now := time.Now().UnixMilli()
	seen := make(map[string]struct{})
	for _, w := range workspaces {
		ws := strings.TrimSpace(w)
		if ws == "" {
			continue
		}
		if _, ok := seen[ws]; ok {
			continue
		}
		seen[ws] = struct{}{}

		rules, err := model.ListAlertRulesDB(db, ws)
		if err != nil {
			continue
		}
		for i := range rules {
			rr := &rules[i]
			if !rr.Enabled {
				continue
			}
			if RuleFrequencyMode(rr) != "immediate" {
				continue
			}
			key := ws + "|" + rr.ID
			immediateMu.Lock()
			last, ok := immediateLast[key]
			if ok && now-last < immediateIngestDebounce.Milliseconds() {
				immediateMu.Unlock()
				continue
			}
			immediateLast[key] = now
			immediateMu.Unlock()
			wcopy := ws
			rid := rr.ID
			go func() {
				eng := &Engine{DB: db}
				eng.StartEvaluateAsync(wcopy, rid, "ingest_immediate", false)
			}()
		}

		ingestMu.Lock()
		last, ok := ingestLastRun[ws]
		if ok && now-last < ingestDebounce.Milliseconds() {
			ingestMu.Unlock()
			continue
		}
		ingestLastRun[ws] = now
		ingestMu.Unlock()

		wcopy := ws
		go func() {
			eng := &Engine{DB: db}
			eng.RunWindowedIngestForWorkspace(wcopy)
		}()
	}
}
