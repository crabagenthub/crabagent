import { collectorAuthHeaders, loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { readCollectorFetchResult } from "@/lib/collector-json";
import { COLLECTOR_API } from "@/lib/collector-api-paths";
import {
  loadResourceAuditEvents,
  loadResourceAuditStats,
} from "@/lib/resource-audit-records";
import {
  loadShellExecSummary,
  type ShellExecSummary,
} from "@/lib/shell-exec-api";
import {
  loadSecurityAuditEvents,
  type SecurityAuditEventRow,
} from "@/lib/security-audit-records";

export type RiskOverviewKPI = {
  totalEvents: number;
  highRiskEvents: number;
  commandExecutions: number;
  resourceAccesses: number;
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
  commandExecutions: 0,
  resourceAccesses: 0,
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

export async function loadRiskOverviewKPI(
  sinceMs: number | null,
  untilMs: number | null,
): Promise<RiskOverviewKPI> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl || !apiKey) {
      return { ...EMPTY_KPI };
    }

    const params: Record<string, string | number> = {};
    if (sinceMs != null && sinceMs > 0) {
      params.since_ms = Math.floor(sinceMs);
    }
    if (untilMs != null && untilMs > 0) {
      params.until_ms = Math.floor(untilMs);
    }

    // Load resource audit stats
    const resourceStats = await loadResourceAuditStats(baseUrl, apiKey, params);
    
    // Load shell exec summary
    const shellSummary = await loadShellExecSummary(baseUrl, apiKey, params);

    // Load security audit events for policy hits
    const securityEventsResult = await loadSecurityAuditEvents(baseUrl, apiKey, { ...params, limit: 500 });
    const policyHits = securityEventsResult?.items?.length ?? 0;

    const commandExecutions = shellSummary?.totals?.commands ?? 0;
    const resourceAccesses = resourceStats?.summary?.total_events ?? 0;

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
      commandExecutions,
      resourceAccesses,
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

export async function loadRiskOverviewTrend(
  sinceMs: number | null,
  untilMs: number | null,
): Promise<RiskOverviewTrendData[]> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl || !apiKey) {
      return [];
    }

    // For now, return empty array
    // TODO: Implement trend data aggregation from collector
    return [];
  } catch (error) {
    console.error("Failed to load risk overview trend:", error);
    return [];
  }
}

export async function loadRiskOverviewDailyRiskTrends(
  sinceMs: number | null,
  untilMs: number | null,
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
    if (!baseUrl || !apiKey) {
      return empty;
    }
    const b = baseUrl.replace(/\/+$/, "");
    const sp = new URLSearchParams();
    if (sinceMs != null && sinceMs > 0) {
      sp.set("since_ms", String(Math.floor(sinceMs)));
    }
    if (untilMs != null && untilMs > 0) {
      sp.set("until_ms", String(Math.floor(untilMs)));
    }
    const res = await fetch(`${b}${COLLECTOR_API.riskOverviewDailyRiskTrends}?${sp.toString()}`, {
      headers: collectorAuthHeaders(apiKey),
      cache: "no-store",
    });
    return await readCollectorFetchResult<RiskOverviewDailyRiskTrends>(
      res,
      `risk overview daily trends HTTP ${res.status}`,
    );
  } catch (error) {
    console.error("Failed to load risk overview daily risk trends:", error);
    return empty;
  }
}

export async function loadRiskOverviewDistribution(
  sinceMs: number | null,
  untilMs: number | null,
): Promise<RiskOverviewDistribution> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl || !apiKey) {
      return { ...EMPTY_DISTRIBUTION };
    }

    const params: Record<string, string | number> = {};
    if (sinceMs != null && sinceMs > 0) {
      params.since_ms = Math.floor(sinceMs);
    }
    if (untilMs != null && untilMs > 0) {
      params.until_ms = Math.floor(untilMs);
    }

    const resourceStats = await loadResourceAuditStats(baseUrl, apiKey, params);
    const shellSummary = await loadShellExecSummary(baseUrl, apiKey, params);

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
  sinceMs: number | null,
  untilMs: number | null,
): Promise<RiskOverviewTopList> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl || !apiKey) {
      return { ...EMPTY_TOP_LIST };
    }

    const params: Record<string, string | number> = {};
    if (sinceMs != null && sinceMs > 0) {
      params.since_ms = Math.floor(sinceMs);
    }
    if (untilMs != null && untilMs > 0) {
      params.until_ms = Math.floor(untilMs);
    }

    const resourceStats = await loadResourceAuditStats(baseUrl, apiKey, params);
    const shellSummary = await loadShellExecSummary(baseUrl, apiKey, params);

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
  sinceMs: number | null,
  untilMs: number | null,
): Promise<RiskOverviewRankings> {
  try {
    const baseUrl = loadCollectorUrl();
    const apiKey = loadApiKey();
    if (!baseUrl || !apiKey) {
      return { ...EMPTY_RANKINGS };
    }

    const params: Record<string, string | number> = {};
    if (sinceMs != null && sinceMs > 0) {
      params.since_ms = Math.floor(sinceMs);
    }
    if (untilMs != null && untilMs > 0) {
      params.until_ms = Math.floor(untilMs);
    }

    const [resourceStats, resourceEvents, shellSummary] = await Promise.all([
      loadResourceAuditStats(baseUrl, apiKey, params),
      loadResourceAuditEvents(baseUrl, apiKey, {
        limit: 200,
        offset: 0,
        order: "desc",
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
      }),
      loadShellExecSummary(baseUrl, apiKey, {
        sinceMs: sinceMs ?? undefined,
        untilMs: untilMs ?? undefined,
      }),
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
