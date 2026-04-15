import type Database from "better-sqlite3";
import {
  normalizeCommandKeyForLoop,
  parseShellSpanRow,
  toParsedShellSpanLite,
  type ParsedShellSpan,
  type ShellCommandCategory,
} from "./shell-exec-analytics.js";
import { clampFacetFilter } from "./observe-list-filters.js";

/** 与 `SHELL_TOOL_WHERE_SQL` 中 tool 分支内层条件相同（供 general 降级匹配复用）。 */
const SHELL_HINT_INNER_SQL = `(
    lower(trim(COALESCE(s.name, ''))) = 'exec'
    OR instr(lower(COALESCE(s.name, '')), 'bash') > 0
    OR instr(lower(COALESCE(s.name, '')), 'shell') > 0
    OR instr(lower(COALESCE(s.name, '')), 'terminal') > 0
    OR instr(lower(COALESCE(s.name, '')), 'pwsh') > 0
    OR instr(lower(COALESCE(s.name, '')), 'powershell') > 0
    OR instr(lower(COALESCE(s.name, '')), 'zsh') > 0
    OR instr(lower(COALESCE(s.name, '')), 'fish') > 0
    OR lower(trim(COALESCE(s.name, ''))) IN ('sh','ash','dash')
    OR instr(lower(COALESCE(s.name, '')), 'run_terminal') > 0
    OR instr(lower(COALESCE(s.name, '')), 'run_cmd') > 0
    OR instr(lower(COALESCE(s.name, '')), 'runcmd') > 0
    OR instr(lower(COALESCE(s.name, '')), 'subprocess') > 0
    OR instr(lower(COALESCE(s.name, '')), 'sandbox') > 0
    OR instr(lower(COALESCE(s.name, '')), 'local_shell') > 0
    OR instr(lower(COALESCE(s.name, '')), 'exec_command') > 0
    OR instr(lower(COALESCE(s.name, '')), 'execute_command') > 0
    OR instr(lower(COALESCE(s.name, '')), 'process_command') > 0
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.command')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.cmd')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.shell_command')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.command')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.line')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.executable')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.script')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.cwd')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.working_directory')), '') IS NOT NULL
    OR NULLIF(TRIM(json_extract(s.input_json, '$.params.workingDirectory')), '') IS NOT NULL
    OR (
      instr(lower(COALESCE(s.input_json, '')), '"cwd"') > 0
      AND instr(lower(COALESCE(s.input_json, '')), '"command"') > 0
    )
    OR (
      (
        instr(lower(COALESCE(s.output_json, '')), 'exit_code') > 0
        OR instr(lower(COALESCE(s.output_json, '')), 'exitcode') > 0
      )
      AND (
        instr(lower(COALESCE(s.output_json, '')), 'stdout') > 0
        OR instr(lower(COALESCE(s.output_json, '')), 'stderr') > 0
      )
    )
  )`;

/**
 * 疑似 Shell / 终端执行：`span_type=tool` 为主；`general` 仅在含明确 command 或典型 shell 输出时纳入（ingest 缺省 type 时）。
 */
export const SHELL_TOOL_WHERE_SQL = `(
  (s.span_type = 'tool' AND ${SHELL_HINT_INNER_SQL})
  OR (
    s.span_type = 'general'
    AND (
      NULLIF(TRIM(json_extract(s.input_json, '$.params.command')), '') IS NOT NULL
      OR NULLIF(TRIM(json_extract(s.input_json, '$.params.cmd')), '') IS NOT NULL
      OR NULLIF(TRIM(json_extract(s.input_json, '$.command')), '') IS NOT NULL
      OR (
        (
          instr(lower(COALESCE(s.output_json, '')), 'exit_code') > 0
          OR instr(lower(COALESCE(s.output_json, '')), 'exitcode') > 0
        )
        AND (
          instr(lower(COALESCE(s.output_json, '')), 'stdout') > 0
          OR instr(lower(COALESCE(s.output_json, '')), 'stderr') > 0
        )
      )
    )
  )
)`;

/** 用于时间窗与排序：span 无 start_time 时用对应 trace 的 created_at_ms。 */
const TRACE_CREATED_AT_MS_SUBSQL =
  "(SELECT t.created_at_ms FROM opik_traces t WHERE t.trace_id = s.trace_id LIMIT 1)";

const SHELL_THREAD_TH_JOIN_ON = `th.thread_id = t.thread_id
 AND th.workspace_name = t.workspace_name
 AND th.project_name = t.project_name`;

export type ShellExecBaseQuery = {
  sinceMs?: number;
  untilMs?: number;
  traceId?: string;
  channel?: string;
  agent?: string;
  commandContains?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  workspaceName?: string;
};

function buildShellWhere(q: ShellExecBaseQuery): { sql: string; params: unknown[] } {
  const parts: string[] = [SHELL_TOOL_WHERE_SQL];
  const params: unknown[] = [];

  if (q.sinceMs != null && Number.isFinite(q.sinceMs) && q.sinceMs > 0) {
    parts.push(`COALESCE(s.start_time_ms, ${TRACE_CREATED_AT_MS_SUBSQL}, 0) >= ?`);
    params.push(Math.floor(q.sinceMs));
  }
  if (q.untilMs != null && Number.isFinite(q.untilMs) && q.untilMs > 0) {
    parts.push(`COALESCE(s.start_time_ms, ${TRACE_CREATED_AT_MS_SUBSQL}, 0) <= ?`);
    params.push(Math.floor(q.untilMs));
  }
  if (q.traceId?.trim()) {
    parts.push(`s.trace_id = ?`);
    params.push(q.traceId.trim());
  }
  if (q.workspaceName?.trim()) {
    parts.push(
      `EXISTS (SELECT 1 FROM opik_traces t WHERE t.trace_id = s.trace_id AND t.workspace_name = ?)`,
    );
    params.push(q.workspaceName.trim());
  }
  const channel = clampFacetFilter(q.channel);
  if (channel) {
    parts.push(
      `EXISTS (SELECT 1 FROM opik_traces t
        INNER JOIN opik_threads th ON ${SHELL_THREAD_TH_JOIN_ON}
        WHERE t.trace_id = s.trace_id AND th.channel_name = ?)`,
    );
    params.push(channel);
  }
  const agent = clampFacetFilter(q.agent);
  if (agent) {
    parts.push(
      `EXISTS (SELECT 1 FROM opik_traces t
        INNER JOIN opik_threads th ON ${SHELL_THREAD_TH_JOIN_ON}
        WHERE t.trace_id = s.trace_id AND th.agent_name = ?)`,
    );
    params.push(agent);
  }
  const cc = q.commandContains?.trim();
  if (cc) {
    const sub = cc.length > 200 ? cc.slice(0, 200) : cc;
    parts.push(
      `(instr(lower(COALESCE(s.input_json, '')), lower(?)) > 0 OR instr(lower(COALESCE(s.name, '')), lower(?)) > 0)`,
    );
    params.push(sub, sub);
  }
  if (q.minDurationMs != null && Number.isFinite(q.minDurationMs) && q.minDurationMs >= 0) {
    parts.push(`COALESCE(s.duration_ms, 0) >= ?`);
    params.push(Math.floor(q.minDurationMs));
  }
  if (q.maxDurationMs != null && Number.isFinite(q.maxDurationMs) && q.maxDurationMs >= 0) {
    parts.push(`COALESCE(s.duration_ms, 0) <= ?`);
    params.push(Math.floor(q.maxDurationMs));
  }

  return { sql: parts.join(" AND "), params };
}

/**
 * 列表/摘要：仅 `opik_spans` 物理列 + NULL占位。避免 SELECT 列表里大量相关子查询在部分 SQLite 版本上导致整句结果集为空
 *（与 `COUNT(*) WHERE SHELL_TOOL_WHERE` 不一致）。渠道/智能体列在表格中可为空；详情见 {@link SHELL_SELECT_ROW_DETAIL}。
 */
const SHELL_SELECT_ROW = `
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.start_time_ms,
       s.end_time_ms,
       s.duration_ms,
       s.input_json,
       s.output_json,
       s.error_info_json,
       s.metadata_json,
       CAST(NULL AS TEXT) AS thread_metadata_json,
       s.trace_id AS thread_key,
       CAST(NULL AS TEXT) AS agent_name,
       CAST(NULL AS TEXT) AS channel_name
FROM opik_spans s
`;

/** 单条详情：行数极少，可安全使用标量子查询补 thread 元数据。 */
const SHELL_SELECT_ROW_DETAIL = `
SELECT s.span_id,
       s.trace_id,
       s.parent_span_id,
       s.name,
       s.span_type,
       s.start_time_ms,
       s.end_time_ms,
       s.duration_ms,
       s.input_json,
       s.output_json,
       s.error_info_json,
       s.metadata_json,
       (SELECT th.metadata_json FROM opik_traces t
          LEFT JOIN opik_threads th ON ${SHELL_THREAD_TH_JOIN_ON}
        WHERE t.trace_id = s.trace_id LIMIT 1) AS thread_metadata_json,
       COALESCE(
         NULLIF(TRIM((SELECT t.thread_id FROM opik_traces t WHERE t.trace_id = s.trace_id LIMIT 1)), ''),
         s.trace_id
       ) AS thread_key,
       (SELECT th.agent_name FROM opik_traces t
          LEFT JOIN opik_threads th ON ${SHELL_THREAD_TH_JOIN_ON}
        WHERE t.trace_id = s.trace_id LIMIT 1) AS agent_name,
       (SELECT th.channel_name FROM opik_traces t
          LEFT JOIN opik_threads th ON ${SHELL_THREAD_TH_JOIN_ON}
        WHERE t.trace_id = s.trace_id LIMIT 1) AS channel_name
FROM opik_spans s
`;

export type ShellExecListQuery = ShellExecBaseQuery & {
  limit: number;
  offset: number;
  order: "asc" | "desc";
};

export function buildShellExecCountSql(q: ShellExecBaseQuery): { sql: string; params: unknown[] } {
  const { sql: whereSql, params: wp } = buildShellWhere(q);
  const sql = `SELECT COUNT(*) AS c FROM opik_spans s WHERE ${whereSql}`;
  return { sql, params: wp };
}

/** 摘要扫描上限（避免全表 JSON 解析拖垮服务）。 */
const SUMMARY_SCAN_CAP = 8000;

/** 列表在内存排序的最大匹配条数；超过则退回 SQL LIMIT/OFFSET（仅 id 列）。 */
const SHELL_LIST_JS_SORT_MAX = 50_000;

type ShellIdRow = { span_id: string; start_time_ms: number | null };

function normalizeShellIdRows(
  raw: { span_id: unknown; start_time_ms: unknown }[],
): ShellIdRow[] {
  return raw
    .map((r) => ({
      span_id: String(r.span_id ?? ""),
      start_time_ms:
        r.start_time_ms != null && Number.isFinite(Number(r.start_time_ms)) ? Number(r.start_time_ms) : null,
    }))
    .filter((r) => r.span_id.length > 0);
}

/** 摘要用：在 WHERE 命中的 span 中取最多 cap 条 id（先轻量列，避免宽 SELECT+ORDER BY+LIMIT 在部分 SQLite 上返回空行）。 */
function fetchShellSpanIdRowsForSummary(
  db: Database.Database,
  whereSql: string,
  wp: unknown[],
  cap: number,
): ShellIdRow[] {
  const cntRow = db.prepare(`SELECT COUNT(*) AS c FROM opik_spans s WHERE ${whereSql}`).get(...wp) as { c: number };
  const cnt = Number(cntRow?.c ?? 0) || 0;
  if (cnt === 0) {
    return [];
  }
  if (cnt <= cap) {
    const raw = db.prepare(`SELECT s.span_id, s.start_time_ms FROM opik_spans s WHERE ${whereSql}`).all(...wp) as {
      span_id: unknown;
      start_time_ms: unknown;
    }[];
    return normalizeShellIdRows(raw);
  }
  let raw = db
    .prepare(
      `SELECT s.span_id, s.start_time_ms FROM opik_spans s WHERE ${whereSql} ORDER BY s.start_time_ms DESC, s.span_id DESC LIMIT ?`,
    )
    .all(...wp, cap) as { span_id: unknown; start_time_ms: unknown }[];
  if (raw.length === 0) {
    raw = db.prepare(`SELECT s.span_id, s.start_time_ms FROM opik_spans s WHERE ${whereSql} LIMIT ?`).all(...wp, cap) as typeof raw;
  }
  return normalizeShellIdRows(raw);
}

function sortShellIdRows(rows: ShellIdRow[], order: "asc" | "desc"): void {
  const dir = order === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const ta = a.start_time_ms ?? 0;
    const tb = b.start_time_ms ?? 0;
    if (ta !== tb) {
      return (ta - tb) * dir;
    }
    return a.span_id.localeCompare(b.span_id) * dir;
  });
}

/** 低于常见 SQLITE_MAX_VARIABLE_NUMBER（999），预留余量。 */
const SHELL_IN_CHUNK = 900;

function fetchShellRowsBySpanIds(db: Database.Database, ids: readonly string[]): Record<string, unknown>[] {
  if (ids.length === 0) {
    return [];
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += SHELL_IN_CHUNK) {
    const chunk = ids.slice(i, i + SHELL_IN_CHUNK);
    const ph = chunk.map(() => "?").join(", ");
    const fetched = db.prepare(`${SHELL_SELECT_ROW} WHERE s.span_id IN (${ph})`).all(...chunk) as Record<
      string,
      unknown
    >[];
    for (const r of fetched) {
      byId.set(String(r.span_id ?? ""), r);
    }
  }
  return ids.map((id) => byId.get(id)).filter((x): x is Record<string, unknown> => x != null);
}

/** 全库快照（不受时间窗影响），用于区分「连错库 / 时间窗过窄 / 规则不匹配」。 */
export type ShellExecDbSnapshot = {
  tool_spans: number;
  shell_like_spans: number;
  top_tool_names: { name: string; count: number }[];
  /** 仅 basename，便于对照启动日志里的 db= 路径是否指向有数据的文件 */
  db_basename: string;
};

export type ShellSummaryJson = {
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
};

export type ShellExecSummaryResponse = ShellSummaryJson & { db_snapshot: ShellExecDbSnapshot };

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeShellSummaryFromRows(
  rows: Record<string, unknown>[],
  options: { capped: boolean },
): ShellSummaryJson {
  const parsed: { row: Record<string, unknown>; p: ParsedShellSpan }[] = [];
  for (const row of rows) {
    const p = parseShellSpanRow({
      input_json: row.input_json != null ? String(row.input_json) : null,
      output_json: row.output_json != null ? String(row.output_json) : null,
      error_info_json: row.error_info_json != null ? String(row.error_info_json) : null,
      metadata_json: row.metadata_json != null ? String(row.metadata_json) : null,
      thread_metadata_json: row.thread_metadata_json != null ? String(row.thread_metadata_json) : null,
    });
    parsed.push({ row, p });
  }

  const traceIds = new Set<string>();
  let success = 0;
  let failed = 0;
  let unknown = 0;
  const category_breakdown: Record<ShellCommandCategory, number> = {
    file: 0,
    network: 0,
    system: 0,
    process: 0,
    package: 0,
    other: 0,
  };
  const duration_buckets = { lt100ms: 0, ms100to1s: 0, gt1s: 0 };
  const trendMap = new Map<string, { total: number; failed: number }>();
  const cmdCount = new Map<string, number>();
  const diag = { command_not_found: 0, permission_denied: 0, illegal_arg_hint: 0 };

  for (const { row, p } of parsed) {
    const tid = String(row.trace_id ?? "");
    if (tid) {
      traceIds.add(tid);
    }
    category_breakdown[p.category] += 1;

    const dur = row.duration_ms != null && Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : null;
    if (dur == null || dur < 0) {
      duration_buckets.ms100to1s += 1;
    } else if (dur < 100) {
      duration_buckets.lt100ms += 1;
    } else if (dur <= 1000) {
      duration_buckets.ms100to1s += 1;
    } else {
      duration_buckets.gt1s += 1;
    }

    const tms = row.start_time_ms != null && Number.isFinite(Number(row.start_time_ms)) ? Number(row.start_time_ms) : 0;
    if (tms > 0) {
      const dk = dayKey(tms);
      const cur = trendMap.get(dk) ?? { total: 0, failed: 0 };
      cur.total += 1;
      if (p.success === false) {
        cur.failed += 1;
      }
      trendMap.set(dk, cur);
    }

    const ck = p.commandKey.slice(0, 120) || "(empty)";
    cmdCount.set(ck, (cmdCount.get(ck) ?? 0) + 1);

    if (p.success === true) {
      success += 1;
    } else if (p.success === false) {
      failed += 1;
    } else {
      unknown += 1;
    }

    if (p.commandNotFound) {
      diag.command_not_found += 1;
    }
    if (p.permissionDenied) {
      diag.permission_denied += 1;
    }
    if (p.illegalArgHint) {
      diag.illegal_arg_hint += 1;
    }
  }

  const success_trend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, total: v.total, failed: v.failed }));

  const top_commands = [...cmdCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([command, count]) => ({ command, count }));

  const slowest = [...parsed]
    .map(({ row, p }) => ({
      span_id: String(row.span_id ?? ""),
      trace_id: String(row.trace_id ?? ""),
      command: p.commandKey.slice(0, 200),
      duration_ms:
        row.duration_ms != null && Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : null,
    }))
    .filter((x) => x.duration_ms != null && x.duration_ms >= 0)
    .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))
    .slice(0, 12);

  const byTraceLoops = new Map<string, Map<string, number>>();
  for (const { row, p } of parsed) {
    const tid = String(row.trace_id ?? "");
    if (!tid || !p.commandKey.trim()) {
      continue;
    }
    const key = normalizeCommandKeyForLoop(p.commandKey);
    if (!byTraceLoops.has(tid)) {
      byTraceLoops.set(tid, new Map());
    }
    const m = byTraceLoops.get(tid)!;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  const loop_alerts: ShellSummaryJson["loop_alerts"] = [];
  for (const [trace_id, m] of byTraceLoops) {
    for (const [command, repeat_count] of m) {
      if (repeat_count >= 3) {
        const thread_key = parsed.find((x) => String(x.row.trace_id) === trace_id)?.row.thread_key;
        loop_alerts.push({
          trace_id,
          thread_key: thread_key != null ? String(thread_key) : null,
          command,
          repeat_count,
        });
      }
    }
  }
  loop_alerts.sort((a, b) => b.repeat_count - a.repeat_count);
  const loopTop = loop_alerts.slice(0, 20);

  const token_risks = parsed
    .filter(({ p }) => p.tokenRisk)
    .map(({ row, p }) => ({
      span_id: String(row.span_id ?? ""),
      trace_id: String(row.trace_id ?? ""),
      command: p.commandKey.slice(0, 160),
      stdout_chars: p.stdoutLen,
      est_tokens: p.estTokens,
      est_usd: Math.round(p.estUsd * 10000) / 10000,
    }))
    .sort((a, b) => b.stdout_chars - a.stdout_chars)
    .slice(0, 15);

  const sigMap = new Map<string, { traces: Set<string>; exits: Set<string> }>();
  for (const { row, p } of parsed) {
    const sig = normalizeCommandKeyForLoop(p.commandKey).slice(0, 200);
    if (!sig) {
      continue;
    }
    const tid = String(row.trace_id ?? "");
    if (!sigMap.has(sig)) {
      sigMap.set(sig, { traces: new Set(), exits: new Set() });
    }
    const e = sigMap.get(sig)!;
    if (tid) {
      e.traces.add(tid);
    }
    e.exits.add(String(p.exitCode ?? (p.success === false ? "err" : p.success === true ? "ok" : "?")));
  }
  const idempotency_samples = [...sigMap.entries()]
    .filter(([, v]) => v.traces.size >= 2 && v.exits.size >= 2)
    .map(([command_key, v]) => ({
      command_key,
      traces: v.traces.size,
      outcomes: v.exits.size,
    }))
    .sort((a, b) => b.traces - a.traces)
    .slice(0, 10);

  const readLike = (cmd: string) => {
    const t = cmd.trim().split(/[\s;&|]+/)[0]?.toLowerCase() ?? "";
    return ["cat", "head", "tail", "less", "grep", "rg", "find"].includes(t.replace(/^\.\//, ""));
  };
  const redundantMap = new Map<string, number>();
  for (const { row, p } of parsed) {
    if (!readLike(p.commandKey)) {
      continue;
    }
    const tid = String(row.trace_id ?? "");
    const k = `${tid}::${normalizeCommandKeyForLoop(p.commandKey)}`;
    redundantMap.set(k, (redundantMap.get(k) ?? 0) + 1);
  }
  const redundant_read_hints = [...redundantMap.entries()]
    .filter(([, n]) => n >= 3)
    .map(([k, repeats]) => {
      const [trace_id, command] = k.split("::");
      return { trace_id, command, repeats };
    })
    .sort((a, b) => b.repeats - a.repeats)
    .slice(0, 12);

  let chain_preview: ShellSummaryJson["chain_preview"] = null;
  if (parsed.length > 0) {
    const sampleTid = String(parsed[0]!.row.trace_id ?? "");
    if (sampleTid) {
      chain_preview = { trace_id: sampleTid, steps: [] };
    }
  }

  return {
    scanned: rows.length,
    capped: options.capped,
    totals: {
      commands: parsed.length,
      distinct_traces: traceIds.size,
      success,
      failed,
      unknown,
    },
    category_breakdown,
    duration_buckets,
    success_trend,
    top_commands,
    slowest,
    loop_alerts: loopTop,
    token_risks,
    diagnostics: diag,
    idempotency_samples,
    chain_preview,
    redundant_read_hints,
  };
}

export function queryShellExecDbSnapshot(db: Database.Database, dbBasename: string): ShellExecDbSnapshot {
  const toolRow = db.prepare(`SELECT COUNT(*) AS c FROM opik_spans WHERE span_type = 'tool'`).get() as
    | { c: number }
    | undefined;
  const shellRow = db
    .prepare(`SELECT COUNT(*) AS c FROM opik_spans s WHERE ${SHELL_TOOL_WHERE_SQL}`)
    .get() as { c: number } | undefined;
  const topRows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(name), ''), '(unnamed)') AS nm, COUNT(*) AS c
       FROM opik_spans WHERE span_type = 'tool'
       GROUP BY nm ORDER BY c DESC LIMIT 12`,
    )
    .all() as { nm: string; c: number }[];
  return {
    tool_spans: Number(toolRow?.c ?? 0) || 0,
    shell_like_spans: Number(shellRow?.c ?? 0) || 0,
    top_tool_names: topRows.map((r) => ({ name: String(r.nm), count: Number(r.c) || 0 })),
    db_basename: dbBasename || "(unknown)",
  };
}

export function queryShellExecSummary(
  db: Database.Database,
  q: ShellExecBaseQuery,
  dbBasename: string,
): ShellExecSummaryResponse {
  const db_snapshot = queryShellExecDbSnapshot(db, dbBasename);
  const { sql: whereSql, params: wp } = buildShellWhere(q);
  const cap = SUMMARY_SCAN_CAP + 1;
  let idRows: ShellIdRow[] = [];
  try {
    idRows = fetchShellSpanIdRowsForSummary(db, whereSql, wp, cap);
  } catch {
    idRows = [];
  }
  sortShellIdRows(idRows, "desc");
  const capped = idRows.length > SUMMARY_SCAN_CAP;
  const fetchIds = idRows.slice(0, SUMMARY_SCAN_CAP).map((r) => r.span_id);
  let rows: Record<string, unknown>[] = [];
  try {
    rows = fetchShellRowsBySpanIds(db, fetchIds);
  } catch {
    rows = [];
  }
  const slice = rows;
  const summary = computeShellSummaryFromRows(slice, { capped });

  if (summary.chain_preview?.trace_id) {
    const tid = summary.chain_preview.trace_id;
    const steps = db
      .prepare(
        `SELECT span_type, name, start_time_ms FROM opik_spans WHERE trace_id = ?
         ORDER BY (start_time_ms IS NULL) ASC, start_time_ms ASC, sort_index ASC, span_id ASC
         LIMIT 48`,
      )
      .all(tid) as { span_type: string; name: string }[];
    summary.chain_preview.steps = steps.map((s) => ({
      kind: s.span_type === "llm" ? "llm" : s.span_type === "tool" ? "tool" : s.span_type ?? "span",
      name: String(s.name ?? "").slice(0, 120),
    }));
  }

  return { ...summary, db_snapshot };
}

export function queryShellExecList(db: Database.Database, q: ShellExecListQuery): {
  items: Record<string, unknown>[];
  total: number;
} {
  const { sql: whereSql, params: wp } = buildShellWhere(q);
  const { sql: csql, params: cparams } = buildShellExecCountSql(q);
  const total = Number((db.prepare(csql).get(...cparams) as { c: number } | undefined)?.c ?? 0) || 0;

  let pageIds: string[] = [];
  if (total > 0) {
    if (total <= SHELL_LIST_JS_SORT_MAX) {
      const raw = db.prepare(`SELECT s.span_id, s.start_time_ms FROM opik_spans s WHERE ${whereSql}`).all(...wp) as {
        span_id: unknown;
        start_time_ms: unknown;
      }[];
      const idRows = normalizeShellIdRows(raw);
      sortShellIdRows(idRows, q.order);
      const allIds = idRows.map((r) => r.span_id);
      pageIds = allIds.slice(q.offset, q.offset + q.limit);
    } else {
      const dir = q.order === "asc" ? "ASC" : "DESC";
      let idRaw = db
        .prepare(
          `SELECT s.span_id FROM opik_spans s WHERE ${whereSql} ORDER BY s.start_time_ms ${dir}, s.span_id ${dir} LIMIT ? OFFSET ?`,
        )
        .all(...wp, q.limit, q.offset) as { span_id: unknown }[];
      if (idRaw.length === 0) {
        idRaw = db
          .prepare(`SELECT s.span_id FROM opik_spans s WHERE ${whereSql} LIMIT ? OFFSET ?`)
          .all(...wp, q.limit, q.offset) as { span_id: unknown }[];
      }
      pageIds = idRaw.map((r) => String(r.span_id ?? "")).filter((id) => id.length > 0);
    }
  }

  const raw = fetchShellRowsBySpanIds(db, pageIds);
  const items = raw.map((row) => {
    const parsed = parseShellSpanRow({
      input_json: row.input_json != null ? String(row.input_json) : null,
      output_json: row.output_json != null ? String(row.output_json) : null,
      error_info_json: row.error_info_json != null ? String(row.error_info_json) : null,
      metadata_json: row.metadata_json != null ? String(row.metadata_json) : null,
      thread_metadata_json: row.thread_metadata_json != null ? String(row.thread_metadata_json) : null,
    });
    return { ...row, parsed: toParsedShellSpanLite(parsed) };
  });
  return { items, total };
}

export function queryShellExecDetail(db: Database.Database, spanId: string): Record<string, unknown> | null {
  const id = spanId.trim();
  if (!id) {
    return null;
  }
  const row = db
    .prepare(
      `${SHELL_SELECT_ROW_DETAIL}
WHERE s.span_id = ? AND ${SHELL_TOOL_WHERE_SQL}`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  const parsed = parseShellSpanRow({
    input_json: row.input_json != null ? String(row.input_json) : null,
    output_json: row.output_json != null ? String(row.output_json) : null,
    error_info_json: row.error_info_json != null ? String(row.error_info_json) : null,
    metadata_json: row.metadata_json != null ? String(row.metadata_json) : null,
    thread_metadata_json: row.thread_metadata_json != null ? String(row.thread_metadata_json) : null,
  });
  return { ...row, parsed };
}
