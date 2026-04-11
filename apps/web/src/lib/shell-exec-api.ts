import { collectorAuthHeaders } from "@/lib/collector";
import { COLLECTOR_API } from "@/lib/collector-api-paths";

export type ShellCommandCategory = "file" | "network" | "system" | "process" | "package" | "other";

export type ShellParsedLite = {
  command: string;
  category: ShellCommandCategory;
  exitCode: number | null;
  success: boolean | null;
  stdoutLen: number;
  stderrLen: number;
  estTokens: number;
  estUsd: number;
  tokenRisk: boolean;
  commandNotFound: boolean;
  permissionDenied: boolean;
  cwd: string | null;
  userId: string | null;
  host: string | null;
};

export type ShellExecDbSnapshot = {
  tool_spans: number;
  shell_like_spans: number;
  top_tool_names: { name: string; count: number }[];
  /** 新版 Collector 返回，便于核对是否连上预期库文件 */
  db_basename?: string;
};

export type ShellExecSummary = {
  scanned: number;
  capped: boolean;
  totals: {
    commands: number;
    distinct_traces: number;
    success: number;
    failed: number;
    unknown: number;
  };
  category_breakdown: Record<ShellCommandCategory, number>;
  duration_buckets: { lt100ms: number; ms100to1s: number; gt1s: number };
  success_trend: { day: string; total: number; failed: number }[];
  top_commands: { command: string; count: number }[];
  slowest: { span_id: string; trace_id: string; command: string; duration_ms: number | null }[];
  loop_alerts: { trace_id: string; thread_key: string | null; command: string; repeat_count: number }[];
  token_risks: {
    span_id: string;
    trace_id: string;
    command: string;
    stdout_chars: number;
    est_tokens: number;
    est_usd: number;
  }[];
  diagnostics: {
    command_not_found: number;
    permission_denied: number;
    illegal_arg_hint: number;
  };
  idempotency_samples: { command_key: string; traces: number; outcomes: number }[];
  chain_preview: { trace_id: string; steps: { kind: string; name: string }[] } | null;
  redundant_read_hints: { trace_id: string; command: string; repeats: number }[];
  /** 全库统计（不受当前时间窗影响），用于排查错库 / 时间窗 / 规则 */
  db_snapshot?: ShellExecDbSnapshot;
};

export type ShellExecListRow = Record<string, unknown> & {
  span_id?: string;
  trace_id?: string;
  parsed?: ShellParsedLite;
};

export type ShellExecDetail = Record<string, unknown> & {
  parsed?: Record<string, unknown>;
};

export type ShellExecQueryParams = {
  sinceMs?: number;
  untilMs?: number;
  traceId?: string;
  channel?: string;
  agent?: string;
  commandContains?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
};

function appendShellParams(sp: URLSearchParams, q: ShellExecQueryParams): void {
  if (q.sinceMs != null) {
    sp.set("since_ms", String(q.sinceMs));
  }
  if (q.untilMs != null) {
    sp.set("until_ms", String(q.untilMs));
  }
  if (q.traceId?.trim()) {
    sp.set("trace_id", q.traceId.trim());
  }
  if (q.channel?.trim()) {
    sp.set("channel", q.channel.trim());
  }
  if (q.agent?.trim()) {
    sp.set("agent", q.agent.trim());
  }
  if (q.commandContains?.trim()) {
    sp.set("command_contains", q.commandContains.trim());
  }
  if (q.minDurationMs != null && q.minDurationMs >= 0) {
    sp.set("min_duration_ms", String(q.minDurationMs));
  }
  if (q.maxDurationMs != null && q.maxDurationMs >= 0) {
    sp.set("max_duration_ms", String(q.maxDurationMs));
  }
}

export async function loadShellExecSummary(
  baseUrl: string,
  apiKey: string,
  q: ShellExecQueryParams,
): Promise<ShellExecSummary> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  appendShellParams(sp, q);
  const res = await fetch(`${b}${COLLECTOR_API.shellExecSummary}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as ShellExecSummary;
}

export async function loadShellExecList(
  baseUrl: string,
  apiKey: string,
  q: ShellExecQueryParams & { limit: number; offset: number; order: "asc" | "desc" },
): Promise<{ items: ShellExecListRow[]; total: number }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  appendShellParams(sp, q);
  sp.set("limit", String(q.limit));
  sp.set("offset", String(q.offset));
  sp.set("order", q.order);
  const res = await fetch(`${b}${COLLECTOR_API.shellExecList}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const raw = (await res.json()) as { items?: ShellExecListRow[]; total?: number };
  return { items: raw.items ?? [], total: raw.total ?? 0 };
}

export async function loadShellExecDetail(
  baseUrl: string,
  apiKey: string,
  spanId: string,
): Promise<ShellExecDetail> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("span_id", spanId.trim());
  const res = await fetch(`${b}${COLLECTOR_API.shellExecDetail}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as ShellExecDetail;
}
