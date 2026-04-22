import type Database from "better-sqlite3";
import { normalizeOpikTraceInputForStorage } from "./strip-leading-bracket-date.js";
import { queryTracesInConversationScope, type TraceRowScoped } from "./thread-scope-query.js";
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

function traceTypeToRunKind(tt: string): ThreadRunKind {
  const t = tt.trim().toLowerCase();
  if (t === "async_command") {
    return "async_followup";
  }
  if (t === "external" || t === "subagent" || t === "system") {
    return t;
  }
  return "external";
}

function isRunKind(s: string): s is ThreadRunKind {
  return s === "external" || s === "async_followup" || s === "subagent" || s === "system";
}

function computeTurnPreview(r: TraceRowScoped): string | null {
  const inputObj = parseJsonObject(r.input_json);
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
    computedPreview = r.name ?? null;
  }
  return computedPreview;
}

function traceRowToTreeNode(db: Database.Database, r: TraceRowScoped): ThreadTurnTreeNode {
  const rkRaw = traceTypeToRunKind(String(r.trace_type ?? "external"));
  const rk: ThreadRunKind = isRunKind(rkRaw) ? rkRaw : "external";
  const tid = String(r.trace_id);
  const skills = collectSkillsUsedForTrace(db, tid);
  const created =
    typeof r.created_at_ms === "number" && Number.isFinite(r.created_at_ms) ? r.created_at_ms : Date.now();
  return {
    turn_id: tid,
    run_kind: rk,
    primary_trace_id: tid,
    preview: computeTurnPreview(r),
    created_at_ms: created,
    skills_used: skills,
    children: [],
  };
}

function sortChildrenRecursive(n: ThreadTurnTreeNode): void {
  n.children.sort((a, b) => a.created_at_ms - b.created_at_ms || a.turn_id.localeCompare(b.turn_id));
  for (const c of n.children) {
    sortChildrenRecursive(c);
  }
}

/**
 * Build a forest of turn nodes for one conversation key (main thread + subagent threads in scope).
 * Backed by `metadata_json.parent_turn_id`（`parent_turn_ref`）+ `trace_type`；排序 `created_at_ms`, `trace_id`。
 */
export function queryThreadTurnsTree(db: Database.Database, threadKey: string): {
  thread_id: string;
  items: ThreadTurnTreeNode[];
} {
  const key = threadKey.trim();
  if (!key) {
    return { thread_id: key, items: [] };
  }

  const rows = queryTracesInConversationScope(db, key, true);
  if (rows.length === 0) {
    return { thread_id: key, items: [] };
  }

  const idSet = new Set(rows.map((r) => r.trace_id));
  const nodes = new Map<string, ThreadTurnTreeNode>();
  for (const r of rows) {
    nodes.set(r.trace_id, traceRowToTreeNode(db, r));
  }

  const externalRoots: ThreadTurnTreeNode[] = [];
  const otherRoots: ThreadTurnTreeNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.trace_id)!;
    const pid = r.parent_turn_ref?.trim() || null;
    if (pid && idSet.has(pid)) {
      nodes.get(pid)!.children.push(node);
    } else if (node.run_kind === "external") {
      externalRoots.push(node);
    } else {
      otherRoots.push(node);
    }
  }

  const roots = externalRoots.length > 0 ? externalRoots : otherRoots;
  for (const root of roots) {
    sortChildrenRecursive(root);
  }

  return { thread_id: key, items: roots };
}
