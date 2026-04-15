import type Database from "better-sqlite3";

const FACET_LIMIT = 500;

export type ObserveFacetsResult = {
  agents: string[];
  channels: string[];
};

/** Distinct non-empty `agent_name` / `channel_name` from `opik_threads` (for filter dropdowns). */
export function queryObserveFacets(db: Database.Database, workspaceName?: string): ObserveFacetsResult {
  const hasWorkspace = !!workspaceName?.trim();
  const whereWorkspace = hasWorkspace ? `AND workspace_name = ?` : "";
  const wsParams = hasWorkspace ? [workspaceName!.trim()] : [];
  const agents = (
    db
      .prepare(
        `SELECT DISTINCT TRIM(agent_name) AS v
         FROM opik_threads
         WHERE agent_name IS NOT NULL AND TRIM(agent_name) != ''
         ${whereWorkspace}
         ORDER BY v COLLATE NOCASE
         LIMIT ?`,
      )
      .all(...wsParams, FACET_LIMIT) as { v: string }[]
  ).map((r) => r.v);

  const channels = (
    db
      .prepare(
        `SELECT DISTINCT TRIM(channel_name) AS v
         FROM opik_threads
         WHERE channel_name IS NOT NULL AND TRIM(channel_name) != ''
         ${whereWorkspace}
         ORDER BY v COLLATE NOCASE
         LIMIT ?`,
      )
      .all(...wsParams, FACET_LIMIT) as { v: string }[]
  ).map((r) => r.v);

  return { agents, channels };
}
