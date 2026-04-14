import type { SecurityAuditEventRow, SecurityAuditFinding } from "@/lib/security-audit-records";
import { parseSecurityAuditFindings } from "@/lib/security-audit-records";
import { format } from "date-fns";

export type SecurityHitCategory = "pii" | "secret" | "injection";

/** 基于策略名 / 处置 / 脱敏类型的启发式分类（无单独 taxonomy 字段时的产品近似）。 */
export function classifySecurityFindingCategory(f: SecurityAuditFinding): SecurityHitCategory {
  const haystack = `${f.policy_name} ${f.policy_id}`.toLowerCase();
  const action = (f.policy_action ?? "").toLowerCase();
  const redact = (f.redact_type ?? "").toLowerCase();

  if (
    /injection|inject|jailbreak|prompt[\s_-]*(?:injection|attack)|sql[\s_-]*inject|command[\s_-]*inject|ssrf|path[\s_-]*traversal/i.test(
      haystack,
    )
  ) {
    return "injection";
  }
  if (
    redact === "block" ||
    action === "vault_token" ||
    /key|secret|token|password|credential|api[\s_-]?key|ssh|private[\s_-]?key|bearer|oauth|jwt/i.test(haystack)
  ) {
    return "secret";
  }
  return "pii";
}

export type SecurityAuditTrendRow = {
  date: string;
  actionHits: number;
  auditHits: number;
};

export type SecurityAuditHitTypeSlice = {
  category: SecurityHitCategory;
  value: number;
};

export type SecurityAuditSourceRow = {
  key: string;
  label: string;
  count: number;
};

function dayKeyLocal(ms: number): string {
  return format(ms, "yyyy-MM-dd");
}

/** 将事件按本地日历日聚合，按命中数累计「强制执行 / 观察」趋势（代理风险态势）。 */
export function buildSecurityAuditRiskTrend(rows: SecurityAuditEventRow[]): SecurityAuditTrendRow[] {
  const map = new Map<string, { actionHits: number; auditHits: number }>();
  for (const row of rows) {
    const day = dayKeyLocal(row.created_at_ms);
    const cur = map.get(day) ?? { actionHits: 0, auditHits: 0 };
    const hits = Math.max(0, row.hit_count || 0);
    if (row.intercepted === 1) {
      cur.actionHits += hits;
    } else {
      cur.auditHits += hits;
    }
    map.set(day, cur);
  }
  return [...map.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 按 findings 的 match_count 汇总 PII / Secret / Injection。 */
export function buildSecurityAuditHitTypeDistribution(rows: SecurityAuditEventRow[]): SecurityAuditHitTypeSlice[] {
  let pii = 0;
  let secret = 0;
  let injection = 0;
  for (const row of rows) {
    const findings = parseSecurityAuditFindings(row.findings_json);
    for (const f of findings) {
      const n = Math.max(0, f.match_count || 0);
      if (n <= 0) {
        continue;
      }
      const cat = classifySecurityFindingCategory(f);
      if (cat === "injection") {
        injection += n;
      } else if (cat === "secret") {
        secret += n;
      } else {
        pii += n;
      }
    }
  }
  const slices: SecurityAuditHitTypeSlice[] = [
    { category: "pii", value: pii },
    { category: "secret", value: secret },
    { category: "injection", value: injection },
  ];
  return slices.filter((s) => s.value > 0);
}

/** 按项目 + 工作区聚合事件条数（插件/工具名需在 Trace Span 中查看）。 */
export function buildSecurityAuditTopSources(rows: SecurityAuditEventRow[], topN: number): SecurityAuditSourceRow[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const proj = row.project_name?.trim() || "—";
    const ws = row.workspace_name?.trim() || "—";
    const key = `${proj}\t${ws}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => {
      const [proj, ws] = key.split("\t");
      return { key, label: `${proj} · ${ws}`, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export function buildTracesInspectQuery(row: SecurityAuditEventRow): string {
  if (row.span_id?.trim()) {
    return `trace=${encodeURIComponent(row.trace_id)}&span=${encodeURIComponent(row.span_id.trim())}`;
  }
  return `trace=${encodeURIComponent(row.trace_id)}`;
}
