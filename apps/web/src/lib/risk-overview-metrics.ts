import { collectorAuthHeaders, loadApiKey, loadCollectorUrl, loadWorkspaceName } from "@/lib/collector";
import { readCollectorFetchResult } from "@/lib/collector-json";
import { COLLECTOR_API } from "@/lib/collector-api-paths";
import {
  loadResourceAuditEvents,
  loadResourceAuditStats,
  type ResourceAuditEventRow,
} from "@/lib/resource-audit-records";
import { resolveCommandAnalysisShellTimeQueryForDateRange } from "@/lib/command-analysis-date-range";
import type { ObserveDateRange } from "@/lib/observe-date-range";
import { loadShellExecSummary, type ShellExecSummary } from "@/lib/shell-exec-api";
import {
  loadSecurityAuditEvents,
  type SecurityAuditEventRow,
} from "@/lib/security-audit-records";

/**
 * 与「命令执行」页共用同一次 `loadShellExecSummary` 结果。
 * 展示数字取 max( totals 全量字段, loop_alerts 条数 )：旧 Collector 可能缺字段或误为 0，同响应里列表仍与页面区块一致。
 */
function loopAlertKpiCount(s: ShellExecSummary | undefined): number {
  if (!s) {
    return 0;
  }
  const n = s.totals as { loop_alert_total?: number } | undefined;
  const fromTotal = n?.loop_alert_total;
  const totalN =
    fromTotal != null && Number.isFinite(Number(fromTotal)) ? Math.max(0, Math.floor(Number(fromTotal))) : 0;
  const raw = s as unknown as { loop_alerts?: unknown; loopAlerts?: unknown };
  const fromList = Math.max(
    Array.isArray(s.loop_alerts) ? s.loop_alerts.length : 0,
    Array.isArray(raw.loopAlerts) ? raw.loopAlerts.length : 0,
  );
  return Math.max(totalN, fromList);
}

function redundantReadHintKpiCount(s: ShellExecSummary | undefined): number {
  if (!s) {
    return 0;
  }
  const n = s.totals as { redundant_read_hint_total?: number } | undefined;
  const fromTotal = n?.redundant_read_hint_total;
  const totalN =
    fromTotal != null && Number.isFinite(Number(fromTotal)) ? Math.max(0, Math.floor(Number(fromTotal))) : 0;
  const raw = s as unknown as { redundant_read_hints?: unknown; redundantReadHints?: unknown };
  const fromList = Math.max(
    Array.isArray(s.redundant_read_hints) ? s.redundant_read_hints.length : 0,
    Array.isArray(raw.redundantReadHints) ? raw.redundantReadHints.length : 0,
  );
  return Math.max(totalN, fromList);
}

export type RiskOverviewKPI = {
  totalEvents: number;
  highRiskEvents: number;
  /** 命令摘要中的死循环告警条数（同 trace 同命令重复 ≥ 阈值）。 */
  commandLoopAlerts: number;
  /** 命令摘要中的重复读类命令提示条数（同 trace 读类命令 ≥3 次）。 */
  commandRedundantReads: number;
  policyHits: number;
  sensitiveCommands: number;
  sensitivePathAccesses: number;
  commandFailureRate: number | null;
  largeFileReads: number;
  redundantReads: number;
  policyCoverage: number | null;
};

export type RiskOverviewTrendData = {
  timestamp: number;
  date: string;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  command: number;
  resource: number;
  policy: number;
};

type DailyCountPoint = {
  day: string;
  count: number;
};

export type RiskOverviewDailyRiskTrends = {
  resource: {
    sensitivePath: DailyCountPoint[];
    redundantRead: DailyCountPoint[];
    credentialAndSecret: DailyCountPoint[];
    largeRead: DailyCountPoint[];
  };
  command: {
    permissionDenied: DailyCountPoint[];
    invalidCommand: DailyCountPoint[];
    commandLoop: DailyCountPoint[];
    sensitiveCommandTokenRisk: DailyCountPoint[];
  };
};

export type RiskOverviewDistribution = {
  severity: { P0: number; P1: number; P2: number; P3: number };
  eventType: { command: number; resource: number; policy: number };
  workspace: { name: string; count: number }[];
  commandType: { system: number; network: number; file: number; database: number };
  resourceType: { file: number; database: number; api: number; memory: number };
};

export type RiskOverviewTopList = {
  highRiskEvents: {
    summary: string;
    count: number;
    severity: string;
    lastSeen: number;
  }[];
  highRiskWorkspaces: {
    name: string;
    count: number;
    highRiskRatio: number;
  }[];
  sensitiveCommands: {
    command: string;
    count: number;
    user: string;
    severity: string;
  }[];
  sensitivePaths: {
    path: string;
    count: number;
    user: string;
    severity: string;
  }[];
};

export type RiskOverviewRankings = {
  resourceTopResources: { name: string; count: number }[];
  resourceTopDuration: { spanId: string; traceId: string; name: string; durationMs: number }[];
  commandTopCommands: { name: string; count: number }[];
  commandSlowest: { spanId: string; traceId: string; name: string; durationMs: number }[];
};

const EMPTY_KPI: RiskOverviewKPI = {
  totalEvents: 0,
  highRiskEvents: 0,
  commandLoopAlerts: 0,
  commandRedundantReads: 0,
  policyHits: 0,
  sensitiveCommands: 0,
  sensitivePathAccesses: 0,
  commandFailureRate: null,
  largeFileReads: 0,
  redundantReads: 0,
  policyCoverage: null,
};

const EMPTY_DISTRIBUTION: RiskOverviewDistribution = {
  severity: { P0: 0, P1: 0, P2: 0, P3: 0 },
  eventType: { command: 0, resource: 0, policy: 0 },
  workspace: [],
  commandType: { system: 0, network: 0, file: 0, database: 0 },
  resourceType: { file: 0, database: 0, api: 0, memory: 0 },
};

const EMPTY_TOP_LIST: RiskOverviewTopList = {
  highRiskEvents: [],
  highRiskWorkspaces: [],
  sensitiveCommands: [],
  sensitivePaths: [],
};

const EMPTY_RANKINGS: RiskOverviewRankings = {
  resourceTopResources: [],
  resourceTopDuration: [],
  commandTopCommands: [],
  commandSlowest: [],
};

function calculateSeverity(row: ResourceAuditEventRow | SecurityAuditEventRow): "P0" | "P1" | "P2" | "P3" {
  const flags = (row as ResourceAuditEventRow).risk_flags ?? [];
  if (flags.includes("sensitive_path")) {
    return "P0";
  }
  if (flags.includes("pii_hint") || flags.includes("credential_hint")) {
    return "P1";
  }
  if (flags.includes("large_read") || flags.includes("redundant_read")) {
    return "P2";
  }
  return "P3";
}

function calculateCommandSeverity(parsed: any): "P0" | "P1" | "P2" | "P3" {
  if (!parsed) return "P3";
  const success = parsed.success;
  const category = parsed.category;
  if (success === false && (category === "system" || category === "network")) {
    return "P0";
  }
  if (parsed.tokenRisk === true) {
    return "P1";
  }
  if (success === false) {
    return "P2";
  }
  return "P3";
}

export async function loadRiskOverviewKPI(dateRange: ObserveDateRange): Promise<RiskOverviewKPI> {
  console.log("[DEBUG] loadRiskOverviewKPI called with dateRange:", dateRange);
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    console.log("[DEBUG] loadRiskOverviewKPI baseUrl:", baseUrl, "apiKey:", apiKey ? "exists" : "missing");
    // 仅检查 baseUrl，apiKey 可选
    if (!baseUrl) {
      console.warn("[DEBUG] loadRiskOverviewKPI: missing baseUrl");
      return { ...EMPTY_KPI };
    }

    const time = resolveCommandAnalysisShellTimeQueryForDateRange(dateRange);
    console.log("[DEBUG] loadRiskOverviewKPI time:", time);
    const params: Record<string, string | number> = {};
    if (time.sinceMs != null) {
      params.since_ms = time.sinceMs;
    }
    if (time.untilMs != null) {
      params.until_ms = time.untilMs;
    }

    // Load resource audit stats
    console.log("[DEBUG] loadRiskOverviewKPI loading resourceStats...");
    const resourceStats = await loadResourceAuditStats(baseUrl, apiKey, params);
    console.log("[DEBUG] loadRiskOverviewKPI resourceStats:", resourceStats);

    // 与执行指令页 {@link toShellTimeQuery} + appendShellParams 完全同一套时间参数
    console.log("[DEBUG] loadRiskOverviewKPI loading shellSummary...");
    const shellSummary = await loadShellExecSummary(baseUrl, apiKey, time);
    console.log("[DEBUG] loadRiskOverviewKPI shellSummary:", shellSummary);

    let policyHits = 0;
    try {
      const securityEventsResult = await loadSecurityAuditEvents(baseUrl, apiKey, { ...params, limit: 500 });
      policyHits = securityEventsResult?.items?.length ?? 0;
    } catch (e) {
      console.error("Failed to load security audit events for risk KPI (policy count):", e);
    }

    const commandExecutions = shellSummary?.totals?.commands ?? 0;
    const resourceAccesses = resourceStats?.summary?.total_events ?? 0;
    const commandLoopAlerts = loopAlertKpiCount(shellSummary);
    const commandRedundantReads = redundantReadHintKpiCount(shellSummary);

    const highRiskEvents = 
      (resourceStats?.summary?.risk_sensitive_path ?? 0) +
      (resourceStats?.summary?.risk_pii_hint ?? 0) +
      (resourceStats?.summary?.risk_credential_hint ?? 0) +
      (shellSummary?.totals?.token_risk_total ?? 0);

    const sensitiveCommands = shellSummary?.totals?.token_risk_total ?? 0;
    const sensitivePathAccesses = resourceStats?.summary?.risk_sensitive_path ?? 0;
    const largeFileReads = resourceStats?.summary?.risk_large_read ?? 0;
    const redundantReads = resourceStats?.summary?.risk_redundant_read ?? 0;

    const commandFailureRate = commandExecutions > 0
      ? ((shellSummary?.totals?.failed ?? 0) / commandExecutions) * 100
      : null;

    const totalEvents = commandExecutions + resourceAccesses + policyHits;
    const policyCoverage = totalEvents > 0 ? (policyHits / totalEvents) * 100 : null;

    return {
      totalEvents,
      highRiskEvents,
      commandLoopAlerts,
      commandRedundantReads,
      policyHits,
      sensitiveCommands,
      sensitivePathAccesses,
      commandFailureRate,
      largeFileReads,
      redundantReads,
      policyCoverage,
    };
  } catch (error) {
    console.error("Failed to load risk overview KPI:", error);
    return { ...EMPTY_KPI };
  }
}

export async function loadRiskOverviewTrend(dateRange?: ObserveDateRange): Promise<RiskOverviewTrendData[]> {
  console.log("[DEBUG] loadRiskOverviewTrend called with dateRange:", dateRange);
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    console.log("[DEBUG] loadRiskOverviewTrend baseUrl:", baseUrl, "apiKey:", apiKey ? "exists" : "missing");
    if (!baseUrl) {
      return [];
    }

    const b = baseUrl.replace(/\/+$/, "");
    const sp = new URLSearchParams();
    
    if (dateRange) {
      const time = resolveCommandAnalysisShellTimeQueryForDateRange(dateRange);
      if (time.sinceMs != null) {
        sp.set("since_ms", String(time.sinceMs));
      }
      if (time.untilMs != null) {
        sp.set("until_ms", String(time.untilMs));
      }
    }
    sp.set("workspace_name", loadWorkspaceName());
    const qs = sp.toString();
    const url = `${b}${COLLECTOR_API.riskOverviewTrend}${qs ? `?${qs}` : ''}`;
    console.log("[DEBUG] loadRiskOverviewTrend fetching:", url);
    
    const res = await fetch(url, {
      headers: collectorAuthHeaders(apiKey),
      cache: "no-store",
    });
    console.log("[DEBUG] loadRiskOverviewTrend response status:", res.status);
    const data = await readCollectorFetchResult<RiskOverviewTrendData[]>(
      res,
      `risk overview trend HTTP ${res.status}`,
    );
    console.log("[DEBUG] loadRiskOverviewTrend data:", data);
    return data ?? [];
  } catch (error) {
    console.error("Failed to load risk overview trend:", error);
    return [];
  }
}

export async function loadRiskOverviewDailyRiskTrends(
  dateRange: ObserveDateRange,
): Promise<RiskOverviewDailyRiskTrends> {
  const empty: RiskOverviewDailyRiskTrends = {
    resource: {
      sensitivePath: [],
      redundantRead: [],
      credentialAndSecret: [],
      largeRead: [],
    },
    command: {
      permissionDenied: [],
      invalidCommand: [],
      commandLoop: [],
      sensitiveCommandTokenRisk: [],
    },
  };
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl) {
      return empty;
    }
    const b = baseUrl.replace(/\/+$/, "");
    const sp = new URLSearchParams();
    const t = resolveCommandAnalysisShellTimeQueryForDateRange(dateRange);
    if (t.sinceMs != null) {
      sp.set("since_ms", String(t.sinceMs));
    }
    if (t.untilMs != null) {
      sp.set("until_ms", String(t.untilMs));
    }
    sp.set("workspace_name", loadWorkspaceName());
    const url = `${b}${COLLECTOR_API.riskOverviewDailyRiskTrends}?${sp.toString()}`;
    console.log("[DEBUG] loadRiskOverviewDailyRiskTrends fetching:", url);
    const res = await fetch(url, {
      headers: collectorAuthHeaders(apiKey),
      cache: "no-store",
    });
    console.log("[DEBUG] loadRiskOverviewDailyRiskTrends response status:", res.status);
    const data = await readCollectorFetchResult<RiskOverviewDailyRiskTrends>(
      res,
      `risk overview daily trends HTTP ${res.status}`,
    );
    console.log("[DEBUG] loadRiskOverviewDailyRiskTrends data:", data);
    return data;
  } catch (error) {
    console.error("Failed to load risk overview daily risk trends:", error);
    return empty;
  }
}

export async function loadRiskOverviewDistribution(
  dateRange: ObserveDateRange,
): Promise<RiskOverviewDistribution> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl) {
      return { ...EMPTY_DISTRIBUTION };
    }

    const time = resolveCommandAnalysisShellTimeQueryForDateRange(dateRange);
    const params: Record<string, string | number> = {};
    if (time.sinceMs != null) {
      params.since_ms = time.sinceMs;
    }
    if (time.untilMs != null) {
      params.until_ms = time.untilMs;
    }

    const resourceStats = await loadResourceAuditStats(baseUrl, apiKey, params);
    const shellSummary = await loadShellExecSummary(baseUrl, apiKey, time);

    // Calculate severity distribution from resource stats
    const severity: RiskOverviewDistribution["severity"] = {
      P0: resourceStats?.summary?.risk_sensitive_path ?? 0,
      P1: (resourceStats?.summary?.risk_pii_hint ?? 0) + (resourceStats?.summary?.risk_credential_hint ?? 0),
      P2: (resourceStats?.summary?.risk_large_read ?? 0) + (resourceStats?.summary?.risk_redundant_read ?? 0),
      P3: (resourceStats?.summary?.total_events ?? 0) - 
           (resourceStats?.summary?.risk_any ?? 0),
    };

    // Calculate event type distribution
    const commandExecutions = shellSummary?.totals?.commands ?? 0;
    const resourceAccesses = resourceStats?.summary?.total_events ?? 0;
    const policyHits = 0; // TODO: Load from security audit

    const eventType: RiskOverviewDistribution["eventType"] = {
      command: commandExecutions,
      resource: resourceAccesses,
      policy: policyHits,
    };

    // Workspace distribution from resource stats
    const workspace = (resourceStats?.by_workspace ?? []).map((w) => ({
      name: w.workspace_name,
      count: w.count,
    }));

    // Command type distribution from shell summary
    const categoryBreakdown = shellSummary?.category_breakdown ?? {};
    const commandType: RiskOverviewDistribution["commandType"] = {
      system: categoryBreakdown.system ?? 0,
      network: categoryBreakdown.network ?? 0,
      file: categoryBreakdown.file ?? 0,
      database: categoryBreakdown.process ?? 0, // Use process as proxy for database
    };

    // Resource type distribution from resource stats
    const classDistribution = resourceStats?.class_distribution ?? [];
    const resourceType: RiskOverviewDistribution["resourceType"] = {
      file: classDistribution.find((c) => c.semantic_class === "file")?.count ?? 0,
      database: classDistribution.find((c) => c.semantic_class === "tool_io")?.count ?? 0,
      api: 0,
      memory: classDistribution.find((c) => c.semantic_class === "memory")?.count ?? 0,
    };

    return {
      severity,
      eventType,
      workspace,
      commandType,
      resourceType,
    };
  } catch (error) {
    console.error("Failed to load risk overview distribution:", error);
    return { ...EMPTY_DISTRIBUTION };
  }
}

export async function loadRiskOverviewTopList(
  dateRange: ObserveDateRange,
): Promise<RiskOverviewTopList> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl) {
      return { ...EMPTY_TOP_LIST };
    }

    const time = resolveCommandAnalysisShellTimeQueryForDateRange(dateRange);
    const params: Record<string, string | number> = {};
    if (time.sinceMs != null) {
      params.since_ms = time.sinceMs;
    }
    if (time.untilMs != null) {
      params.until_ms = time.untilMs;
    }

    const resourceStats = await loadResourceAuditStats(baseUrl, apiKey, params);
    const shellSummary = await loadShellExecSummary(baseUrl, apiKey, time);

    // High risk events from top resources
    const highRiskEvents = (resourceStats?.top_resources ?? []).slice(0, 10).map((r) => ({
      summary: r.uri,
      count: r.count,
      severity: "P1", // Simplified
      lastSeen: Date.now(),
    }));

    // High risk workspaces
    const workspaceStats = resourceStats?.by_workspace ?? [];
    const highRiskWorkspaces = workspaceStats
      .map((w) => ({
        name: w.workspace_name,
        count: w.count,
        highRiskRatio: 0, // TODO: Calculate actual ratio
      }))
      .slice(0, 10);

    // Sensitive commands from shell summary
    const sensitiveCommands = (shellSummary?.top_commands ?? [])
      .slice(0, 10)
      .map((c) => ({
        command: c.command,
        count: c.count,
        user: "unknown",
        severity: "P1",
      }));

    // Sensitive paths from resource stats
    const sensitivePaths = (resourceStats?.top_resources ?? [])
      .filter((r) => r.uri.includes("/etc") || r.uri.includes("secret"))
      .slice(0, 10)
      .map((r) => ({
        path: r.uri,
        count: r.count,
        user: "unknown",
        severity: "P0",
      }));

    return {
      highRiskEvents,
      highRiskWorkspaces,
      sensitiveCommands,
      sensitivePaths,
    };
  } catch (error) {
    console.error("Failed to load risk overview top list:", error);
    return { ...EMPTY_TOP_LIST };
  }
}

export async function loadRiskOverviewRankings(
  dateRange: ObserveDateRange,
): Promise<RiskOverviewRankings> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl) {
      return { ...EMPTY_RANKINGS };
    }

    const time = resolveCommandAnalysisShellTimeQueryForDateRange(dateRange);
    const params: Record<string, string | number> = {};
    if (time.sinceMs != null) {
      params.since_ms = time.sinceMs;
    }
    if (time.untilMs != null) {
      params.until_ms = time.untilMs;
    }

    const [resourceStats, resourceEvents, shellSummary] = await Promise.all([
      loadResourceAuditStats(baseUrl, apiKey, params),
      loadResourceAuditEvents(baseUrl, apiKey, {
        limit: 200,
        offset: 0,
        order: "desc",
        sinceMs: time.sinceMs,
        untilMs: time.untilMs,
      }),
      loadShellExecSummary(baseUrl, apiKey, time),
    ]);

    const resourceTopResources = (resourceStats?.top_resources ?? []).slice(0, 10).map((x) => ({
      name: x.uri,
      count: Number(x.count ?? 0),
    }));

    const resourceTopDuration = (resourceEvents?.items ?? [])
      .filter((x) => x.duration_ms != null && Number.isFinite(Number(x.duration_ms)))
      .sort((a, b) => Number(b.duration_ms ?? 0) - Number(a.duration_ms ?? 0))
      .slice(0, 10)
      .map((x) => ({
        spanId: String(x.span_id ?? ""),
        traceId: String(x.trace_id ?? ""),
        name: String(x.resource_uri ?? ""),
        durationMs: Math.round(Number(x.duration_ms ?? 0)),
      }));

    const commandTopCommands = (shellSummary?.top_commands ?? []).slice(0, 10).map((x) => ({
      name: String(x.command ?? ""),
      count: Number(x.count ?? 0),
    }));

    const commandSlowest = (shellSummary?.slowest ?? []).slice(0, 10).map((x) => ({
      spanId: String(x.span_id ?? ""),
      traceId: String(x.trace_id ?? ""),
      name: String(x.command ?? ""),
      durationMs: Math.round(Number(x.duration_ms ?? 0)),
    }));

    return {
      resourceTopResources,
      resourceTopDuration,
      commandTopCommands,
      commandSlowest,
    };
  } catch (error) {
    console.error("Failed to load risk overview rankings:", error);
    return { ...EMPTY_RANKINGS };
  }
}
