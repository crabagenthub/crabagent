import type Database from "better-sqlite3";
import { parseThreadRunKind, type ThreadRunKind } from "./thread-turn-types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * After a trace row is upserted, upsert `opik_thread_turns` when `metadata.turn_id` is set.
 * Plugin is responsible for emitting `turn_id`, `run_kind`, `parent_turn_id`.
 */
export function upsertThreadTurnFromTraceMetadata(
  db: Database.Database,
  opts: {
    traceId: string;
    threadId: string | null | undefined;
    workspaceName: string;
    projectName: string;
    metadata: unknown;
    createdAtMs: number;
    previewText: string | null;
  },
): void {
  const threadId = str(opts.threadId);
  if (!threadId) {
    return;
  }
  const meta = isRecord(opts.metadata) ? opts.metadata : {};
  const turnId = str(meta.turn_id);
  if (!turnId) {
    return;
  }
  const rk = parseThreadRunKind(meta.run_kind);
  const runKind: ThreadRunKind = rk ?? "external";
  const parentTurnId = str(meta.parent_turn_id);
  const sortKey = Number.isFinite(opts.createdAtMs) ? Math.floor(opts.createdAtMs) : Date.now();

  const stmt = db.prepare(`
    INSERT INTO opik_thread_turns (
      turn_id, thread_id, workspace_name, project_name,
      parent_turn_id, run_kind, primary_trace_id,
      sort_key, preview_text, skills_used_json,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(turn_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      workspace_name = excluded.workspace_name,
      project_name = excluded.project_name,
      parent_turn_id = COALESCE(excluded.parent_turn_id, opik_thread_turns.parent_turn_id),
      run_kind = excluded.run_kind,
      primary_trace_id = excluded.primary_trace_id,
      sort_key = excluded.sort_key,
      preview_text = COALESCE(excluded.preview_text, opik_thread_turns.preview_text),
      updated_at_ms = excluded.updated_at_ms
  `);
  const now = Date.now();
  stmt.run(
    turnId,
    threadId,
    opts.workspaceName,
    opts.projectName,
    parentTurnId,
    runKind,
    opts.traceId,
    sortKey,
    opts.previewText,
    sortKey,
    now,
  );
}
