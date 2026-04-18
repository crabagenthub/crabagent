import { appendWorkspaceNameParam, collectorAuthHeaders } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
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
  platform: "unix" | "windows_cmd" | "powershell";
};

export type ShellExecDbSnapshot = {
  tool_spans: number;
  shell_like_spans: number;
  /** agent_exec_commands 行数（统计/明细数据源） */
  exec_command_rows?: number;
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
  daily_risk_series?: {
    day: string;
    commands: number;
    failed: number;
    token_risk_count: number;
    diagnostic_count: number;
    network_system_count: number;
  }[];
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
  chain_preview: { trace_id: string; steps: { kind: string; name: string }[] } | null;
  redundant_read_hints: { trace_id: string; command: string; repeats: number }[];
  /** 死循环告警按重复次数分桶（柱状图） */
  loop_repeat_buckets?: { label: string; value: number }[];
  /** Token 风险按 stdout 体量分桶 */
  token_risk_stdout_buckets?: { label: string; value: number }[];
  /** 重复读取类命令 Top（条形图） */
  redundant_read_top?: { trace_id: string; command: string; repeats: number }[];
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

export type ShellExecReplayItem = {
  span_id: string;
  trace_id: string;
  start_time_ms: number | null;
  duration_ms: number | null;
  command: string;
  command_key: string;
  category: ShellCommandCategory | string;
  platform: string;
  exit_code: number | null;
  success: boolean | null;
  token_risk: boolean;
  span_name: string;
  workspace_name: string | null;
  project_name: string | null;
  thread_key: string | null;
  agent_name: string | null;
  channel_name: string | null;
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
  appendWorkspaceNameParam(sp);
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
    cache: "no-store",
  });
  return readCollectorFetchResult<ShellExecSummary>(res, `shell summary HTTP ${res.status}`);
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
    cache: "no-store",
  });
  const raw = await readCollectorFetchResult<{ items?: ShellExecListRow[]; total?: number }>(
    res,
    `shell list HTTP ${res.status}`,
  );
  return { items: collectorItemsArray<ShellExecListRow>(raw.items), total: raw.total ?? 0 };
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
    cache: "no-store",
  });
  return readCollectorFetchResult<ShellExecDetail>(res, `shell detail HTTP ${res.status}`);
}

export async function loadShellExecReplay(
  baseUrl: string,
  apiKey: string,
  traceId: string,
): Promise<{ trace_id: string; items: ShellExecReplayItem[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const sp = new URLSearchParams();
  sp.set("trace_id", traceId.trim());
  const res = await fetch(`${b}${COLLECTOR_API.shellExecReplay}?${sp.toString()}`, {
    headers: collectorAuthHeaders(apiKey),
    cache: "no-store",
  });
  const raw = await readCollectorFetchResult<{ trace_id?: string; items?: ShellExecReplayItem[] }>(
    res,
    `shell replay HTTP ${res.status}`,
  );
  return { trace_id: raw.trace_id ?? traceId, items: collectorItemsArray<ShellExecReplayItem>(raw.items) };
}
