package ingest

import "database/sql"

// afterOpikCommitIngestWorkspaces is set by the application (see router) to run alert evaluation
// after a successful Opik batch commit, without an import cycle to internal/alerts.
var afterOpikCommitIngestWorkspaces func(*sql.DB, []string)

// RegisterAfterOpikCommitIngest wires alert evaluation after collector database commits.
func RegisterAfterOpikCommitIngest(fn func(*sql.DB, []string)) {
	afterOpikCommitIngestWorkspaces = fn
}

func triggerAfterOpikCommitIngest(db *sql.DB, workspaces []string) {
	if afterOpikCommitIngestWorkspaces == nil {
		return
	}
	afterOpikCommitIngestWorkspaces(db, workspaces)
}
