import { randomUUID } from "node:crypto";
import type { CrabagentDb } from "./db.js";
import type { RedactionType } from "./redactor.js";

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
  /** v1 仅 `regex` 生效；`model` 为预留。 */
  detection_kind?: string | null;
  /** 首次写入策略的时间（Web 或 API 创建/更新时由服务端写入）。 */
  created_at_ms?: number | null;
  /** OpenClaw 插件定时从 Collector `GET /v1/policies` 拉取成功后的时间（见 `POST /v1/policies/pull-report`）。 */
  pulled_at_ms?: number | null;
  updated_at_ms: number;
}

/** 由 `policy_action` 派生 Collector `Redactor` 使用的 `redact_type`（单一真源为处置方式）。 */
export function deriveRedactTypeFromPolicyAction(action: string | null | undefined): RedactionType {
  const a = String(action ?? "data_mask")
    .trim()
    .toLowerCase();
  if (a === "abort_run") {
    return "block";
  }
  if (a === "input_guard") {
    return "block";
  }
  if (a === "audit_only") {
    return "mask";
  }
  return "mask";
}

/**
 * 多策略同时命中时的执行优先级（数值越大越先处理）：
 * 中止运行 > 输入防护 > 数据脱敏 > 审计。
 */
export function effectivePolicyActionForPriority(
  policyAction: string | null | undefined,
  redactType: string | null | undefined,
): string {
  const pa = String(policyAction ?? "")
    .trim()
    .toLowerCase();
  if (pa) {
    return pa;
  }
  const rt = String(redactType ?? "")
    .trim()
    .toLowerCase();
  return rt === "block" ? "abort_run" : "data_mask";
}

export function policyActionPriorityRank(action: string | null | undefined): number {
  const a = String(action ?? "data_mask")
    .trim()
    .toLowerCase();
  if (a === "abort_run") {
    return 4;
  }
  if (a === "input_guard") {
    return 3;
  }
  if (a === "audit_only") {
    return 1;
  }
  return 2;
}

export function compareInterceptionPoliciesByRedactionOrder(
  a: Pick<InterceptionPolicy, "policy_action" | "redact_type" | "updated_at_ms" | "id">,
  b: Pick<InterceptionPolicy, "policy_action" | "redact_type" | "updated_at_ms" | "id">,
): number {
  const ra = policyActionPriorityRank(effectivePolicyActionForPriority(a.policy_action, a.redact_type));
  const rb = policyActionPriorityRank(effectivePolicyActionForPriority(b.policy_action, b.redact_type));
  if (rb !== ra) {
    return rb - ra;
  }
  const ua = Number(a.updated_at_ms) || 0;
  const ub = Number(b.updated_at_ms) || 0;
  if (ub !== ua) {
    return ub - ua;
  }
  return String(a.id).localeCompare(String(b.id));
}

function normalizeDetectionKind(raw: string | null | undefined): "regex" | "model" {
  const s = String(raw ?? "regex")
    .trim()
    .toLowerCase();
  return s === "model" ? "model" : "regex";
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

  const policyAction = policy.policy_action ?? "data_mask";
  const redactType = deriveRedactTypeFromPolicyAction(policyAction);
  const detectionKind = normalizeDetectionKind(policy.detection_kind ?? undefined);
  const pattern = String(policy.pattern ?? "").trim();

  db.prepare(
    `
    INSERT INTO interception_policies (
      id, name, description, pattern, redact_type, targets_json, enabled,
      severity, policy_action, intercept_mode, detection_kind,
      created_at_ms, updated_at_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      pattern = excluded.pattern,
      redact_type = excluded.redact_type,
      targets_json = excluded.targets_json,
      enabled = excluded.enabled,
      severity = COALESCE(excluded.severity, interception_policies.severity),
      policy_action = COALESCE(excluded.policy_action, interception_policies.policy_action),
      intercept_mode = interception_policies.intercept_mode,
      detection_kind = COALESCE(excluded.detection_kind, interception_policies.detection_kind),
      updated_at_ms = excluded.updated_at_ms
  `,
  ).run(
    id,
    policy.name || "Unnamed Policy",
    policy.description || "",
    pattern,
    redactType,
    policy.targets_json || "[]",
    policy.enabled ?? 1,
    policy.severity ?? "high",
    policyAction,
    null,
    detectionKind,
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
