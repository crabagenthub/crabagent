package alerts

import (
	"database/sql"
	"strings"
	"sync"
	"time"
)

const ingestDebounce = 45 * time.Second

var (
	ingestMu      sync.Mutex
	ingestLastRun = map[string]int64{} // workspace -> unix ms
)

// OnIngestWorkspaces is called after successful collector writes (e.g. Opik batch commit).
// Per workspace, enforces at most one full evaluation per ingestDebounce window to limit load under bursty ingest.
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
			eng.RunAllEnabledForWorkspaceWithKind(wcopy, "ingest")
		}()
	}
}
