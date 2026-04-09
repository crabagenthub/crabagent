import type { CrabagentDb } from "./db.js";
import { Redactor, type RedactionRule } from "./redactor.js";
import { queryAllPolicies } from "./policy-query.js";

export function buildRedactorFromPolicies(db: CrabagentDb): Redactor {
  const policies = queryAllPolicies(db);
  const rules: RedactionRule[] = [];
  for (const p of policies) {
    let targets: string[] = [];
    try {
      const raw = p.targets_json;
      targets =
        typeof raw === "string" && raw.trim()
          ? (JSON.parse(raw) as string[])
          : Array.isArray(raw)
            ? (raw as string[])
            : [];
    } catch {
      targets = [];
    }
    const pattern = p.pattern ?? "";
    if (!pattern) {
      continue;
    }
    const rt = p.redact_type;
    const redactType = rt === "mask" || rt === "hash" || rt === "block" ? rt : "mask";
    rules.push({
      id: p.id,
      name: p.name ?? p.id,
      pattern,
      redactType,
      targets,
      enabled: p.enabled === 1,
      severity: p.severity ?? undefined,
      policyAction: p.policy_action ?? undefined,
      interceptMode: p.intercept_mode ?? undefined,
    });
  }
  return new Redactor(rules);
}
