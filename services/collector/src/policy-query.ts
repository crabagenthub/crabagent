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
  severity?: string | null;
  policy_action?: string | null;
  intercept_mode?: string | null;
  /** 首次写入策略的时间（Web 或 API 创建/更新时由服务端写入）。 */
  created_at_ms?: number | null;
  /** OpenClaw 插件定时从 Collector `GET /v1/policies` 拉取成功后的时间（见 `POST /v1/policies/pull-report`）。 */
  pulled_at_ms?: number | null;
  updated_at_ms: number;
}

export function countPolicies(db: CrabagentDb): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM interception_policies`).get() as { n: number };
  return row?.n ?? 0;
}

function maxPolicyRowsForEnv(): number {
  const pro =
    process.env.CRABAGENT_PLAN?.trim().toLowerCase() === "pro" ||
    process.env.CRABAGENT_PRODUCT_TIER?.trim().toLowerCase() === "pro";
  const raw = process.env.CRABAGENT_POLICY_MAX?.trim();
  if (raw && Number.isFinite(Number(raw))) {
    return Math.max(0, Math.floor(Number(raw)));
  }
  return pro ? 100 : 10;
}

export function queryAllPolicies(db: CrabagentDb): InterceptionPolicy[] {
  return db
    .prepare(`SELECT * FROM interception_policies ORDER BY updated_at_ms DESC`)
    .all() as InterceptionPolicy[];
}

export function upsertPolicy(db: CrabagentDb, policy: Partial<InterceptionPolicy>): InterceptionPolicy {
  const id = policy.id || randomUUID();
  const now = Date.now();

  const existing = db.prepare(`SELECT id FROM interception_policies WHERE id = ?`).get(id) as
    | { id: string }
    | undefined;
  if (!existing && countPolicies(db) >= maxPolicyRowsForEnv()) {
    throw new Error(
      `policy_limit_exceeded: max ${maxPolicyRowsForEnv()} policies for current plan (set CRABAGENT_PLAN=pro or CRABAGENT_POLICY_MAX)`,
    );
  }

  db.prepare(
    `
    INSERT INTO interception_policies (
      id, name, description, pattern, redact_type, targets_json, enabled,
      severity, policy_action, intercept_mode,
      created_at_ms, updated_at_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      pattern = excluded.pattern,
      redact_type = excluded.redact_type,
      targets_json = excluded.targets_json,
      enabled = excluded.enabled,
      severity = COALESCE(excluded.severity, interception_policies.severity),
      policy_action = COALESCE(excluded.policy_action, interception_policies.policy_action),
      intercept_mode = COALESCE(excluded.intercept_mode, interception_policies.intercept_mode),
      updated_at_ms = excluded.updated_at_ms
  `,
  ).run(
    id,
    policy.name || "Unnamed Policy",
    policy.description || "",
    policy.pattern || "",
    policy.redact_type || "mask",
    policy.targets_json || "[]",
    policy.enabled ?? 1,
    policy.severity ?? "high",
    policy.policy_action ?? "mask",
    policy.intercept_mode ?? "enforce",
    now,
    now,
  );

  return db.prepare(`SELECT * FROM interception_policies WHERE id = ?`).get(id) as InterceptionPolicy;
}

/**
 * 插件在成功执行一次「拉取策略列表」后调用，将所有行的 `pulled_at_ms` 更新为本次拉取时间。
 */
export function reportPoliciesPulled(db: CrabagentDb, pulledAtMs: number): { updated: number } {
  const ms = Math.floor(Number(pulledAtMs));
  if (!Number.isFinite(ms) || ms <= 0) {
    return { updated: 0 };
  }
  const info = db.prepare(`UPDATE interception_policies SET pulled_at_ms = ?`).run(ms);
  return { updated: info.changes };
}

export function deletePolicy(db: CrabagentDb, id: string): void {
  db.prepare(`DELETE FROM interception_policies WHERE id = ?`).run(id);
}
