/**
 * Thread turn model — one row per logical turn node (external or follow-up).
 * Metadata on traces uses the same field names for ingest (`turn_id`, `parent_turn_id`, `run_kind`).
 */

export const THREAD_RUN_KINDS = ["external", "async_followup", "subagent", "system"] as const;
export type ThreadRunKind = (typeof THREAD_RUN_KINDS)[number];

export function parseThreadRunKind(raw: unknown): ThreadRunKind | null {
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim().toLowerCase();
  return THREAD_RUN_KINDS.includes(t as ThreadRunKind) ? (t as ThreadRunKind) : null;
}

/** One skill used in a trace (deduped). */
export type SkillUsedEntry = {
  label: string;
  skill_id?: string;
};

/** 历史：`opik_thread_turns` 行形状；新实现已弃用该表，保留类型供文档/兼容引用。 */
export type ThreadTurnRow = {
  turn_id: string;
  thread_id: string;
  workspace_name: string;
  project_name: string;
  parent_turn_id: string | null;
  run_kind: ThreadRunKind;
  primary_trace_id: string;
  sort_key: number;
  preview_text: string | null;
  skills_used_json: string | null;
  /** Subagent: parent session thread_id for cross-thread graft (see `queryThreadTurnsTree`). */
  anchor_parent_thread_id?: string | null;
  anchor_parent_turn_id?: string | null;
  created_at_ms: number;
  updated_at_ms: number | null;
};

/** API node for tree UI + GET /conversation/:threadId/turns. */
export type ThreadTurnTreeNode = {
  turn_id: string;
  run_kind: ThreadRunKind;
  primary_trace_id: string;
  preview: string | null;
  /** Epoch ms for display */
  created_at_ms: number;
  skills_used: SkillUsedEntry[];
  children: ThreadTurnTreeNode[];
};
