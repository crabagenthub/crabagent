import { randomUUID } from "node:crypto";
import type { CrabagentDb } from "./db.js";

export interface InterceptionPolicy {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  redact_type: "mask" | "hash" | "block";
  targets_json: string;
  enabled: number;
  updated_at_ms: number;
}

export function queryAllPolicies(db: CrabagentDb): InterceptionPolicy[] {
  return db.prepare(`SELECT * FROM interception_policies ORDER BY updated_at_ms DESC`).all() as InterceptionPolicy[];
}

export function upsertPolicy(db: CrabagentDb, policy: Partial<InterceptionPolicy>): InterceptionPolicy {
  const id = policy.id || randomUUID();
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO interception_policies (id, name, description, pattern, redact_type, targets_json, enabled, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      pattern = excluded.pattern,
      redact_type = excluded.redact_type,
      targets_json = excluded.targets_json,
      enabled = excluded.enabled,
      updated_at_ms = excluded.updated_at_ms
  `).run(
    id,
    policy.name || "Unnamed Policy",
    policy.description || "",
    policy.pattern || "",
    policy.redact_type || "mask",
    policy.targets_json || "[]",
    policy.enabled ?? 1,
    now
  );

  return db.prepare(`SELECT * FROM interception_policies WHERE id = ?`).get(id) as InterceptionPolicy;
}

export function deletePolicy(db: CrabagentDb, id: string): void {
  db.prepare(`DELETE FROM interception_policies WHERE id = ?`).run(id);
}
