package alerts

import (
	"database/sql"
	"time"

	"iseeagentc/model"
)

// StartScheduler runs RunAllEnabledForWorkspace for each distinct workspace on a ticker.
// Primary evaluation runs after collector ingest (OnIngestWorkspaces); this is a low-frequency
// backstop for window-based rules when no new data arrives. Pass every <= 0 to disable.
func StartScheduler(db *sql.DB, every time.Duration) {
	if db == nil || every <= 0 {
		return
	}
	if every < time.Minute {
		every = time.Minute
	}
	eng := &Engine{DB: db}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for range t.C {
			rules, err := model.ListAlertRulesDB(db, "")
			if err != nil {
				continue
			}
			seen := make(map[string]struct{})
			for i := range rules {
				if !rules[i].Enabled {
					continue
				}
				ws := rules[i].WorkspaceName
				if _, ok := seen[ws]; ok {
					continue
				}
				seen[ws] = struct{}{}
				eng.RunAllEnabledForWorkspace(ws)
			}
		}
	}()
}
