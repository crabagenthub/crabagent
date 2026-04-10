/**
 * 入库侧安全审计扫描（正则）。`findings_json` 仅含策略 id/名/计数与模式字段，**不含** vault 明文或匹配子串。
 * P4：`detection_kind === 'model'` 时跳过扫描；异步模型路径可将来读取 `CRABAGENT_MODEL_DETECT_TIMEOUT_MS`（预留）。
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CrabagentDb } from "./db.js";
import { queryAllPolicies, type InterceptionPolicy } from "./policy-query.js";

/**
 * 与 `PRAGMA table_info` 对齐：旧库可能含 `timestamp_ms` 等额外 NOT NULL 列，须按实际列集 INSERT。
 * 不再维护 `source_kind`（若库中仍有该列且无默认值，请 `ALTER TABLE … DROP COLUMN source_kind` 或改为可空）。
 */
const SECURITY_AUDIT_INSERT_COLUMN_ORDER = [
  "id",
  "created_at_ms",
  "timestamp_ms",
  "trace_id",
  "span_id",
  "workspace_name",
  "project_name",
  /** 仅当表里仍有该列时参与 INSERT（启动时尝试 DROP 后一般不再有）。 */
  "source_kind",
  "findings_json",
  "total_findings",
  "hit_count",
  "intercepted",
  "observe_only",
] as const;

const LEGACY_SOURCE_KIND_PLACEHOLDER = "opik_batch";

function securityAuditTableColumns(db: Database.Database): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(security_audit_logs)`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function prepareSecurityAuditInsert(db: Database.Database): {
  columns: readonly string[];
  run: (args: unknown[]) => void;
} {
  const names = securityAuditTableColumns(db);
  const columns = SECURITY_AUDIT_INSERT_COLUMN_ORDER.filter((c) => names.has(c));
  if (!columns.includes("id") || !columns.includes("trace_id")) {
    throw new Error("security_audit_logs: missing required columns (id, trace_id)");
  }
  const ph = columns.map(() => "?").join(", ");
  const stmt = db.prepare(
    `INSERT INTO security_audit_logs (${columns.join(", ")}) VALUES (${ph})`,
  );
  return {
    columns,
    run: (args: unknown[]) => {
      stmt.run(...args);
    },
  };
}

function securityAuditInsertRowArgs(
  columns: readonly string[],
  row: {
    id: string;
    nowMs: number;
    traceId: string;
    spanId: string | null;
    ws: string;
    proj: string;
    findingsJson: string;
    /** 命中的策略条数（`findings_json` 数组长度），与部分旧 DDL 的 `total_findings` 对齐。 */
    totalFindings: number;
    hitCount: number;
    intercepted: number;
    observeOnly: number;
  },
): unknown[] {
  const r = row;
  return columns.map((c) => {
    switch (c) {
      case "id":
        return r.id;
      case "created_at_ms":
      case "timestamp_ms":
        return r.nowMs;
      case "trace_id":
        return r.traceId;
      case "span_id":
        return r.spanId;
      case "workspace_name":
        return r.ws;
      case "project_name":
        return r.proj;
      case "source_kind":
        return LEGACY_SOURCE_KIND_PLACEHOLDER;
      case "findings_json":
        return r.findingsJson;
      case "total_findings":
        return r.totalFindings;
      case "hit_count":
        return r.hitCount;
      case "intercepted":
        return r.intercepted;
      case "observe_only":
        return r.observeOnly;
      default:
        throw new Error(`security_audit_logs: unknown column ${c}`);
    }
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseJsonRecord(v: unknown): Record<string, unknown> | null {
  if (isRecord(v)) {
    return v;
  }
  if (typeof v !== "string" || !v.trim()) {
    return null;
  }
  try {
    const p = JSON.parse(v) as unknown;
    return isRecord(p) ? p : null;
  } catch {
    return null;
  }
}

export type SecurityAuditFinding = {
  policy_id: string;
  policy_name: string;
  match_count: number;
  policy_action: string;
  intercept_mode: string;
  redact_type: string;
};

export type CrabagentInterceptionMeta = {
  version: number;
  intercepted: boolean;
  mode: "enforce" | "observe";
  hit_count: number;
  tags: string[];
  policy_ids: string[];
};

export type SpanSecurityScan = {
  trace_id: string;
  findings: SecurityAuditFinding[];
  hit_count: number;
  intercepted: number;
  observe_only: number;
  interception: CrabagentInterceptionMeta | null;
};

type CompiledRule = {
  policy: InterceptionPolicy;
  regex: RegExp;
};

function compilePolicies(policies: InterceptionPolicy[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  const _modelTimeoutMs = Number(process.env.CRABAGENT_MODEL_DETECT_TIMEOUT_MS?.trim() ?? "");
  void _modelTimeoutMs; // P4：模型检测 worker 硬超时（毫秒），当前未接线路径
  for (const p of policies) {
    /** SQLite / 历史行可能为 null；仅显式 0 视为关闭 */
    if (Number(p.enabled) === 0) {
      continue;
    }
    const dk = (p.detection_kind ?? "regex").trim().toLowerCase();
    if (dk === "model") {
      continue;
    }
    const pat = (p.pattern ?? "").trim();
    if (!pat) {
      continue;
    }
    try {
      out.push({ policy: p, regex: new RegExp(pat, "g") });
    } catch {
      console.error(`[ingest-security-audit] invalid policy pattern id=${p.id}`);
    }
  }
  return out;
}

function countMatches(regex: RegExp, text: string): number {
  regex.lastIndex = 0;
  let n = 0;
  for (;;) {
    const m = regex.exec(text);
    if (!m) {
      break;
    }
    n += 1;
    if (m[0] === "") {
      regex.lastIndex++;
    }
    if (n > 10_000) {
      break;
    }
  }
  return n;
}

function spanScanText(row: Record<string, unknown>): string {
  const chunks: string[] = [];
  try {
    chunks.push(JSON.stringify(row.input ?? null));
    chunks.push(JSON.stringify(row.output ?? null));
    chunks.push(JSON.stringify(row.metadata ?? null));
  } catch {
    chunks.push("");
  }
  return chunks.join("\n");
}

function traceScanText(row: Record<string, unknown>): string {
  const chunks: string[] = [];
  try {
    chunks.push(JSON.stringify(row.input ?? null));
    chunks.push(JSON.stringify(row.output ?? null));
    chunks.push(JSON.stringify(row.metadata ?? null));
  } catch {
    chunks.push("");
  }
  return chunks.join("\n");
}

function scanText(rules: CompiledRule[], text: string): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  for (const { policy, regex } of rules) {
    const n = countMatches(regex, text);
    if (n <= 0) {
      continue;
    }
    findings.push({
      policy_id: policy.id,
      policy_name: policy.name ?? policy.id,
      match_count: n,
      policy_action: policy.policy_action ?? "mask",
      intercept_mode: policy.intercept_mode ?? "enforce",
      redact_type: policy.redact_type,
    });
  }
  return findings;
}

function summarizeFindings(findings: SecurityAuditFinding[]): {
  hit_count: number;
  intercepted: number;
  observe_only: number;
  interception: CrabagentInterceptionMeta | null;
} {
  if (findings.length === 0) {
    return { hit_count: 0, intercepted: 0, observe_only: 0, interception: null };
  }
  const hit_count = findings.reduce((s, f) => s + f.match_count, 0);
  let enforceHit = false;
  let observeHit = false;
  for (const f of findings) {
    const mode = (f.intercept_mode ?? "enforce").toLowerCase();
    const alertOnly = (f.policy_action ?? "").toLowerCase() === "alert_only";
    if (mode === "observe") {
      observeHit = true;
      continue;
    }
    if (!alertOnly) {
      enforceHit = true;
    } else {
      observeHit = true;
    }
  }
  const intercepted = enforceHit ? 1 : 0;
  const observe_only = observeHit && !enforceHit ? 1 : 0;
  const tags = [...new Set(findings.map((f) => f.policy_name))];
  const policy_ids = [...new Set(findings.map((f) => f.policy_id))];
  const interception: CrabagentInterceptionMeta = {
    version: 1,
    intercepted: enforceHit,
    mode: enforceHit ? "enforce" : "observe",
    hit_count,
    tags,
    policy_ids,
  };
  return { hit_count, intercepted, observe_only, interception };
}

function readForwardedFindingsFromMetadata(
  metadata: unknown,
): {
  findings: SecurityAuditFinding[];
  hit_count: number;
  intercepted: number;
  observe_only: number;
  interception: CrabagentInterceptionMeta | null;
} | null {
  const rec = parseJsonRecord(metadata);
  if (!rec) {
    return null;
  }
  const raw = rec.crabagent_interception_findings;
  if (!Array.isArray(raw)) {
    return null;
  }
  const findings: SecurityAuditFinding[] = raw
    .map((x) => (isRecord(x) ? x : null))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((o) => {
      const redactRaw = String(o.redact_type ?? "mask").toLowerCase();
      const redactType =
        redactRaw === "hash" || redactRaw === "block" || redactRaw === "mask"
          ? redactRaw
          : "mask";
      const matchCount = Number(o.match_count ?? 0) || 0;
      return {
        policy_id: String(o.policy_id ?? ""),
        policy_name: String(o.policy_name ?? ""),
        match_count: matchCount > 0 ? Math.floor(matchCount) : 0,
        policy_action: String(o.policy_action ?? "mask"),
        intercept_mode: String(o.intercept_mode ?? "enforce"),
        redact_type: redactType,
      } satisfies SecurityAuditFinding;
    })
    .filter((f) => f.match_count > 0 && f.policy_id.trim().length > 0);
  if (findings.length === 0) {
    return null;
  }
  return summarizeFindings(findings);
}

export type IngestSecurityScanMaps = {
  spanScans: Map<string, SpanSecurityScan>;
  traceScans: Map<string, SpanSecurityScan>;
};

const DEFAULT_WORKSPACE = "default";
const DEFAULT_PROJECT = "openclaw";

export function buildWorkspaceMapsFromEnvelope(envelope: {
  traces?: unknown[];
  spans?: unknown[];
}): {
  traceWsProj: Map<string, { ws: string; proj: string }>;
  spanWsProj: Map<string, { ws: string; proj: string }>;
} {
  const traceWsProj = new Map<string, { ws: string; proj: string }>();
  for (const raw of envelope.traces ?? []) {
    if (!isRecord(raw)) {
      continue;
    }
    const tid = asStr(raw.trace_id ?? raw.id);
    if (!tid) {
      continue;
    }
    traceWsProj.set(tid, {
      ws: asStr(raw.workspace_name) ?? DEFAULT_WORKSPACE,
      proj: asStr(raw.project_name) ?? DEFAULT_PROJECT,
    });
  }
  const spanWsProj = new Map<string, { ws: string; proj: string }>();
  for (const raw of envelope.spans ?? []) {
    if (!isRecord(raw)) {
      continue;
    }
    const sid = asStr(raw.span_id ?? raw.id);
    const tid = asStr(raw.trace_id);
    if (!sid || !tid) {
      continue;
    }
    const tw = traceWsProj.get(tid);
    spanWsProj.set(sid, tw ?? { ws: DEFAULT_WORKSPACE, proj: DEFAULT_PROJECT });
  }
  return { traceWsProj, spanWsProj };
}

/**
 * 在入库脱敏之前对 batch 做正则扫描；不写明文，仅计数与策略元数据。
 */
export function scanOpikBatchForSecurityAudit(
  db: CrabagentDb,
  envelope: {
    traces?: unknown[];
    spans?: unknown[];
  },
): IngestSecurityScanMaps {
  const rules = compilePolicies(queryAllPolicies(db));
  const spanScans = new Map<string, SpanSecurityScan>();
  const traceScans = new Map<string, SpanSecurityScan>();

  if (rules.length === 0) {
    return { spanScans, traceScans };
  }

  for (const raw of envelope.traces ?? []) {
    if (!isRecord(raw)) {
      continue;
    }
    const traceId = asStr(raw.trace_id ?? raw.id);
    if (!traceId) {
      continue;
    }
    const text = traceScanText(raw);
    const findings = scanText(rules, text);
    let sum = summarizeFindings(findings);
    if (sum.hit_count <= 0) {
      const forwarded = readForwardedFindingsFromMetadata(raw.metadata);
      if (forwarded) {
        sum = forwarded;
      }
    }
    if (sum.hit_count <= 0) {
      continue;
    }
    traceScans.set(traceId, {
      trace_id: traceId,
      findings,
      hit_count: sum.hit_count,
      intercepted: sum.intercepted,
      observe_only: sum.observe_only,
      interception: sum.interception,
    });
  }

  for (const raw of envelope.spans ?? []) {
    if (!isRecord(raw)) {
      continue;
    }
    const spanId = asStr(raw.span_id ?? raw.id);
    const traceId = asStr(raw.trace_id);
    if (!spanId || !traceId) {
      continue;
    }
    const text = spanScanText(raw);
    const findings = scanText(rules, text);
    let sum = summarizeFindings(findings);
    if (sum.hit_count <= 0) {
      const forwarded = readForwardedFindingsFromMetadata(raw.metadata);
      if (forwarded) {
        sum = forwarded;
      }
    }
    if (sum.hit_count <= 0) {
      continue;
    }
    spanScans.set(spanId, {
      trace_id: traceId,
      findings,
      hit_count: sum.hit_count,
      intercepted: sum.intercepted,
      observe_only: sum.observe_only,
      interception: sum.interception,
    });
  }

  return { spanScans, traceScans };
}

export function mergeCrabagentInterceptionIntoMetadata(
  metadata: unknown,
  interception: CrabagentInterceptionMeta | null,
): Record<string, unknown> {
  let base: Record<string, unknown> = {};
  if (typeof metadata === "string") {
    try {
      const p = JSON.parse(metadata) as unknown;
      if (isRecord(p)) {
        base = { ...p };
      }
    } catch {
      base = {};
    }
  } else if (isRecord(metadata)) {
    base = { ...metadata };
  }
  if (interception != null) {
    base.crabagent_interception = interception;
  }
  return base;
}

export function insertSecurityAuditRows(
  db: Database.Database,
  nowMs: number,
  spanScans: Map<string, SpanSecurityScan>,
  traceScans: Map<string, SpanSecurityScan>,
  spanWorkspaceProject: Map<string, { ws: string; proj: string }>,
  traceWorkspaceProject: Map<string, { ws: string; proj: string }>,
): void {
  const insert = prepareSecurityAuditInsert(db);

  for (const [spanId, scan] of spanScans) {
    const wp = spanWorkspaceProject.get(spanId) ?? traceWorkspaceProject.get(scan.trace_id);
    const ws = wp?.ws ?? DEFAULT_WORKSPACE;
    const proj = wp?.proj ?? DEFAULT_PROJECT;
    insert.run(
      securityAuditInsertRowArgs(insert.columns, {
        id: randomUUID(),
        nowMs,
        traceId: scan.trace_id,
        spanId,
        ws,
        proj,
        findingsJson: JSON.stringify(scan.findings),
        totalFindings: scan.findings.length,
        hitCount: scan.hit_count,
        intercepted: scan.intercepted,
        observeOnly: scan.observe_only,
      }),
    );
  }

  for (const [traceId, scan] of traceScans) {
    const hasSpanForTrace = [...spanScans.values()].some((s) => s.trace_id === traceId);
    if (hasSpanForTrace) {
      continue;
    }
    const wp = traceWorkspaceProject.get(traceId);
    const ws = wp?.ws ?? DEFAULT_WORKSPACE;
    const proj = wp?.proj ?? DEFAULT_PROJECT;
    insert.run(
      securityAuditInsertRowArgs(insert.columns, {
        id: randomUUID(),
        nowMs,
        traceId,
        spanId: null,
        ws,
        proj,
        findingsJson: JSON.stringify(scan.findings),
        totalFindings: scan.findings.length,
        hitCount: scan.hit_count,
        intercepted: scan.intercepted,
        observeOnly: scan.observe_only,
      }),
    );
  }
}
