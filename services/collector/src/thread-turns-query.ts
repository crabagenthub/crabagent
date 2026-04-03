import type Database from "better-sqlite3";
import { normalizeOpikTraceInputForStorage } from "./strip-leading-bracket-date.js";
import type { SkillUsedEntry, ThreadRunKind, ThreadTurnTreeNode } from "./thread-turn-types.js";

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Dedupe skills for one trace (aligns with web `collectSkillsUsedFromSemanticSpans`). */
export function collectSkillsUsedForTrace(db: Database.Database, traceId: string): SkillUsedEntry[] {
  const tid = traceId.trim();
  if (!tid) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT span_type, name, metadata_json FROM opik_spans WHERE trace_id = ? ORDER BY COALESCE(sort_index, 0) ASC`,
    )
    .all(tid) as { span_type: string; name: string; metadata_json: string | null }[];

  const byKey = new Map<string, SkillUsedEntry>();
  for (const r of rows) {
    const meta = parseJsonObject(r.metadata_json);
    if (String(r.span_type) !== "tool" || meta.semantic_kind !== "skill") {
      continue;
    }
    const id = typeof meta.skill_id === "string" ? meta.skill_id.trim() : "";
    const nm = typeof meta.skill_name === "string" ? meta.skill_name.trim() : "";
    const label = (nm || id || String(r.name ?? "").trim()).trim();
    if (!label) {
      continue;
    }
    const key = (id || label).toLowerCase();
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, id ? { label: nm || id, skill_id: id } : { label });
  }
  return [...byKey.values()];
}

type TurnRowJoined = {
  turn_id: string;
  thread_id: string;
  parent_turn_id: string | null;
  run_kind: string;
  primary_trace_id: string;
  sort_key: number;
  preview_text: string | null;
  trace_name: string | null;
  trace_input_json: string | null;
  created_at_ms: number;
  anchor_parent_thread_id: string | null;
  anchor_parent_turn_id: string | null;
};

const TURN_JOIN_SQL = `
       SELECT t.turn_id,
              t.thread_id,
              t.parent_turn_id,
              t.run_kind,
              t.primary_trace_id,
              t.sort_key,
              t.preview_text,
              t.created_at_ms,
              t.anchor_parent_thread_id,
              t.anchor_parent_turn_id,
              ot.name AS trace_name,
              ot.input_json AS trace_input_json
       FROM opik_thread_turns t
       JOIN opik_traces ot ON ot.trace_id = t.primary_trace_id`;

function isRunKind(s: string): s is ThreadRunKind {
  return s === "external" || s === "async_followup" || s === "subagent" || s === "system";
}

function computeTurnPreview(r: TurnRowJoined): string | null {
  const inputObj = parseJsonObject(r.trace_input_json);
  const inputNorm = normalizeOpikTraceInputForStorage(inputObj) as Record<string, unknown>;
  const listPreview =
    asStr(inputNorm.list_input_preview) ?? asStr((inputNorm as Record<string, unknown>).listInputPreview);
  const promptPreview = asStr(inputNorm.prompt);
  let computedPreview = listPreview ?? promptPreview ?? null;
  if (!computedPreview) {
    const ut = inputNorm.user_turn;
    if (ut && typeof ut === "object" && !Array.isArray(ut)) {
      const mr = (ut as Record<string, unknown>).message_received;
      if (mr && typeof mr === "object" && !Array.isArray(mr)) {
        computedPreview = asStr((mr as Record<string, unknown>).content) ?? null;
      }
    }
  }
  if (!computedPreview) {
    computedPreview = r.preview_text ?? r.trace_name ?? null;
  }
  return computedPreview;
}

function turnRowToTreeNode(db: Database.Database, r: TurnRowJoined): ThreadTurnTreeNode {
  const sk = String(r.run_kind ?? "");
  const rk: ThreadRunKind = isRunKind(sk) ? sk : "external";
  const skills = collectSkillsUsedForTrace(db, r.primary_trace_id);
  return {
    turn_id: r.turn_id,
    run_kind: rk,
    primary_trace_id: r.primary_trace_id,
    preview: computeTurnPreview(r),
    created_at_ms: r.created_at_ms,
    skills_used: skills,
    children: [],
  };
}

function fetchTurnRowById(db: Database.Database, turnId: string): TurnRowJoined | null {
  const tid = turnId.trim();
  if (!tid) {
    return null;
  }
  const r = db.prepare(`${TURN_JOIN_SQL} WHERE t.turn_id = ?`).get(tid) as TurnRowJoined | undefined;
  return r ?? null;
}

function sortChildrenRecursive(n: ThreadTurnTreeNode): void {
  n.children.sort((a, b) => a.created_at_ms - b.created_at_ms || a.turn_id.localeCompare(b.turn_id));
  for (const c of n.children) {
    sortChildrenRecursive(c);
  }
}

/**
 * Build a forest of turn nodes for one thread (only nodes present in `opik_thread_turns`).
 * Roots: `parent_turn_id` IS NULL. Children nested by `parent_turn_id`.
 *
 * Subagent-only threads: when there is no `external` root but traces carry
 * `anchor_parent_thread_id` / `anchor_parent_turn_id`, graft under the parent thread's anchor turn
 * so the left nav shows the main user turn + subagent work.
 */
export function queryThreadTurnsTree(db: Database.Database, threadKey: string): {
  thread_id: string;
  items: ThreadTurnTreeNode[];
} {
  const key = threadKey.trim();
  if (!key) {
    return { thread_id: key, items: [] };
  }

  let rows: TurnRowJoined[];
  try {
    rows = db.prepare(`${TURN_JOIN_SQL} WHERE t.thread_id = ? ORDER BY t.sort_key ASC, t.turn_id ASC`).all(key) as TurnRowJoined[];
  } catch {
    // Pre-migration DB without anchor columns — fall back without graft metadata.
    rows = db
      .prepare(
        `SELECT t.turn_id,
                t.thread_id,
                t.parent_turn_id,
                t.run_kind,
                t.primary_trace_id,
                t.sort_key,
                t.preview_text,
                t.created_at_ms,
                NULL AS anchor_parent_thread_id,
                NULL AS anchor_parent_turn_id,
                ot.name AS trace_name,
                ot.input_json AS trace_input_json
         FROM opik_thread_turns t
         JOIN opik_traces ot ON ot.trace_id = t.primary_trace_id
         WHERE t.thread_id = ?
         ORDER BY t.sort_key ASC, t.turn_id ASC`,
      )
      .all(key) as TurnRowJoined[];
  }

  if (rows.length === 0) {
    return { thread_id: key, items: [] };
  }

  let anchorTurnId: string | null = null;
  for (const r of rows) {
    const aid = r.anchor_parent_turn_id?.trim() || null;
    if (aid) {
      anchorTurnId = aid;
      break;
    }
  }

  const nodes = new Map<string, ThreadTurnTreeNode>();
  for (const r of rows) {
    nodes.set(r.turn_id, turnRowToTreeNode(db, r));
  }

  const externalRoots: ThreadTurnTreeNode[] = [];
  const hiddenRoots: ThreadTurnTreeNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.turn_id)!;
    const pid = r.parent_turn_id?.trim() || null;
    if (pid && nodes.has(pid)) {
      nodes.get(pid)!.children.push(node);
    } else if (node.run_kind === "external") {
      externalRoots.push(node);
    } else {
      hiddenRoots.push(node);
    }
  }

  let roots: ThreadTurnTreeNode[];
  if (externalRoots.length > 0) {
    roots = externalRoots;
  } else if (anchorTurnId) {
    const anchorRow = fetchTurnRowById(db, anchorTurnId);
    if (anchorRow) {
      const anchorNode = turnRowToTreeNode(db, anchorRow);
      anchorNode.children = [...hiddenRoots];
      roots = [anchorNode];
    } else {
      roots = hiddenRoots;
    }
  } else {
    roots = [];
  }

  for (const root of roots) {
    sortChildrenRecursive(root);
  }

  return { thread_id: key, items: roots };
}
