/**
 * 与 Collector `policy-query` 对齐：多策略同时命中时执行顺序为
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

export function compareRedactionRulesByPolicyPriority(
  a: { id: string; policyAction?: string; redactType?: string },
  b: { id: string; policyAction?: string; redactType?: string },
): number {
  const ra = policyActionPriorityRank(effectivePolicyActionForPriority(a.policyAction, a.redactType));
  const rb = policyActionPriorityRank(effectivePolicyActionForPriority(b.policyAction, b.redactType));
  if (rb !== ra) {
    return rb - ra;
  }
  return a.id.localeCompare(b.id);
}

export function sortRulesByPolicyPriority<T extends { id: string; policyAction?: string; redactType?: string }>(
  rules: readonly T[],
): T[] {
  return rules.slice().sort(compareRedactionRulesByPolicyPriority);
}
