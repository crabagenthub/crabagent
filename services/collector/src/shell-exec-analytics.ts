/**
 * 从 OpenClaw / Opik tool span 的 input/output 中解析 Shell 执行语义，
 * 用于「指令执行分析」聚合与列表（无独立 shell 表时依赖 JSON 启发式）。
 */

export type ShellCommandCategory = "file" | "network" | "system" | "process" | "package" | "other";

export type ParsedShellSpan = {
  command: string;
  commandKey: string;
  category: ShellCommandCategory;
  exitCode: number | null;
  success: boolean | null;
  stdoutLen: number;
  stderrLen: number;
  stdoutPreview: string | null;
  stderrPreview: string | null;
  estTokens: number;
  estUsd: number;
  tokenRisk: boolean;
  commandNotFound: boolean;
  permissionDenied: boolean;
  illegalArgHint: boolean;
  cwd: string | null;
  envKeys: string[];
  userId: string | null;
  host: string | null;
};

const TOKEN_RISK_STDOUT_CHARS = 24_000;
const TOKEN_APPROX_DIVISOR = 4;
const USD_PER_MTOK = 0.5;

const FILE_BIN = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "find",
  "grep",
  "rg",
  "fd",
  "cp",
  "mv",
  "rm",
  "mkdir",
  "rmdir",
  "touch",
  "chmod",
  "chown",
  "stat",
  "diff",
  "wc",
  "sort",
  "uniq",
  "tee",
  "xargs",
  "sed",
  "awk",
  "readlink",
  "realpath",
  "tree",
]);

const NET_BIN = new Set(["curl", "wget", "ping", "ssh", "scp", "rsync", "nc", "netcat", "telnet", "dig", "nslookup"]);

const SYS_BIN = new Set([
  "sudo",
  "su",
  "systemctl",
  "service",
  "mount",
  "umount",
  "df",
  "du",
  "free",
  "uname",
  "whoami",
  "id",
  "env",
  "printenv",
  "export",
  "ulimit",
  "sysctl",
]);

const PROC_BIN = new Set(["ps", "top", "htop", "kill", "killall", "pkill", "pgrep", "jobs", "fg", "bg", "nohup", "nice"]);

const PKG_BIN = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "apt", "apt-get", "yum", "dnf", "brew", "cargo", "go"]);

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || typeof raw !== "string" || !raw.trim()) {
    return {};
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return null;
}

/** 从 tool input `{ params: ... }` 抽取命令文本 */
export function extractCommandFromInput(input: Record<string, unknown>): string {
  const params = input.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const p = params as Record<string, unknown>;
    const c =
      str(p.command) ??
      str(p.cmd) ??
      str(p.shell_command) ??
      str(p.script) ??
      str(p.shellCommand) ??
      str(p.bash_command) ??
      str(p.line) ??
      str(p.executable) ??
      str(p.input);
    if (c) {
      return c;
    }
    if (typeof p.args === "string" && p.args.trim()) {
      return p.args.trim();
    }
  }
  const flat =
    str(input.command) ??
    str(input.cmd) ??
    str(input.shell_command) ??
    str(input.script) ??
    str(input.text) ??
    str(input.line);
  return flat ?? "";
}

function firstToken(cmd: string): string {
  const t = cmd.trim().split(/[\s;&|]+/)[0]?.replace(/^['"]|['"]$/g, "") ?? "";
  const base = t.includes("/") ? t.split("/").pop() ?? t : t;
  return base.replace(/^\.\//, "").toLowerCase();
}

export function classifyCommandCategory(cmd: string): ShellCommandCategory {
  const tok = firstToken(cmd);
  if (!tok) {
    return "other";
  }
  if (FILE_BIN.has(tok)) {
    return "file";
  }
  if (NET_BIN.has(tok)) {
    return "network";
  }
  if (SYS_BIN.has(tok)) {
    return "system";
  }
  if (PROC_BIN.has(tok)) {
    return "process";
  }
  if (PKG_BIN.has(tok)) {
    return "package";
  }
  if (tok === "cd" || tok === "pwd") {
    return "file";
  }
  return "other";
}

function digExitCode(v: unknown, depth = 0): number | null {
  if (depth > 8 || v == null) {
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "boolean") {
    return v ? 0 : 1;
  }
  if (typeof v === "string") {
    const m = v.match(/\bexit(?:\s*code)?[:\s]+(-?\d+)/i);
    if (m) {
      return Number.parseInt(m[1]!, 10);
    }
    return null;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of ["exit_code", "exitCode", "code", "status", "returncode", "returnCode"]) {
      const x = o[k];
      const n = typeof x === "number" && Number.isFinite(x) ? Math.trunc(x) : null;
      if (n != null) {
        return n;
      }
    }
    for (const k of ["result", "output", "data", "value", "payload"]) {
      const n = digExitCode(o[k], depth + 1);
      if (n != null) {
        return n;
      }
    }
  }
  return null;
}

function collectTextLengths(v: unknown, depth = 0): { out: string; err: string } {
  if (depth > 10) {
    return { out: "", err: "" };
  }
  let out = "";
  let err = "";
  if (typeof v === "string") {
    return { out: v, err: "" };
  }
  if (typeof v !== "object" || v == null) {
    return { out: "", err: "" };
  }
  if (Array.isArray(v)) {
    for (const it of v) {
      const s = collectTextLengths(it, depth + 1);
      out += s.out;
      err += s.err;
    }
    return { out, err };
  }
  const o = v as Record<string, unknown>;
  const so = o.stdout ?? o.stdOut ?? o.STDOUT;
  const se = o.stderr ?? o.stdErr ?? o.STDERR;
  if (typeof so === "string") {
    out += so;
  }
  if (typeof se === "string") {
    err += se;
  }
  const content = o.content ?? o.text ?? o.output ?? o.message;
  if (typeof content === "string" && !so) {
    out += content;
  }
  for (const k of ["result", "data", "value", "body"]) {
    if (o[k] != null) {
      const s = collectTextLengths(o[k], depth + 1);
      out += s.out;
      err += s.err;
    }
  }
  return { out, err };
}

function errorText(errJson: string | null | undefined): string {
  if (errJson == null || !String(errJson).trim()) {
    return "";
  }
  const o = parseJsonObject(errJson);
  const msg = o.message ?? o.error ?? o.detail;
  if (typeof msg === "string") {
    return msg;
  }
  return String(errJson);
}

function threadMetaUserHost(metadataJson: string | null | undefined): { userId: string | null; host: string | null } {
  const m = parseJsonObject(metadataJson);
  const userId =
    str(m.user_id) ??
    str(m.userId) ??
    str(m.dingtalk_user_id) ??
    (m.openclaw_context && typeof m.openclaw_context === "object"
      ? str((m.openclaw_context as Record<string, unknown>).userId)
      : null);
  const host =
    str(m.host) ??
    str(m.hostname) ??
    str(m.machine) ??
    (m.openclaw_context && typeof m.openclaw_context === "object"
      ? str((m.openclaw_context as Record<string, unknown>).host)
      : null);
  return { userId, host };
}

function extractCwdEnv(params: Record<string, unknown>): { cwd: string | null; envKeys: string[] } {
  const cwd =
    str(params.cwd) ??
    str(params.working_directory) ??
    str(params.workingDirectory) ??
    str(params.pwd) ??
    null;
  const env = params.env ?? params.environment;
  const envKeys: string[] = [];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    envKeys.push(...Object.keys(env as Record<string, unknown>).slice(0, 40));
  }
  return { cwd, envKeys };
}

export function parseShellSpanRow(row: {
  input_json: string | null;
  output_json: string | null;
  error_info_json: string | null;
  metadata_json: string | null;
  thread_metadata_json?: string | null;
}): ParsedShellSpan {
  const input = parseJsonObject(row.input_json);
  const outputRoot = parseJsonObject(row.output_json);
  const innerResult =
    Object.prototype.hasOwnProperty.call(outputRoot, "result") && outputRoot.result !== undefined
      ? outputRoot.result
      : outputRoot;
  const errStr = errorText(row.error_info_json);
  const meta = parseJsonObject(row.metadata_json);
  const params =
    input.params && typeof input.params === "object" && !Array.isArray(input.params)
      ? (input.params as Record<string, unknown>)
      : input;

  const command = extractCommandFromInput(input);
  const commandKey = command.replace(/\s+/g, " ").trim().slice(0, 512);
  const category = classifyCommandCategory(command);
  const { cwd, envKeys } = extractCwdEnv(params);

  const exitCode = digExitCode(innerResult);
  const { out: stdoutText, err: stderrText } = collectTextLengths(innerResult);
  const stdoutLen = stdoutText.length;
  const stderrLen = stderrText.length + (errStr ? errStr.length : 0);

  const commandNotFound =
    /command not found|not found as command|No such file or directory.*command/i.test(errStr) ||
    /command not found/i.test(stdoutText + stderrText);
  const permissionDenied =
    /permission denied|EACCES|Operation not permitted/i.test(errStr) ||
    /permission denied/i.test(stdoutText + stderrText);
  const illegalArgHint =
    /illegal option|invalid option|unrecognized option|syntax error|usage:/i.test(errStr + stdoutText + stderrText);

  const hasSpanError = errStr.trim().length > 0;
  let success: boolean | null = null;
  if (exitCode != null) {
    success = exitCode === 0 && !hasSpanError;
  } else if (hasSpanError) {
    success = false;
  } else {
    success = true;
  }

  const estTokens = Math.ceil((stdoutLen + stderrLen) / TOKEN_APPROX_DIVISOR);
  const estUsd = (estTokens / 1_000_000) * USD_PER_MTOK;
  const tokenRisk = stdoutLen >= TOKEN_RISK_STDOUT_CHARS;

  const { userId, host } = threadMetaUserHost(row.thread_metadata_json ?? null);

  const preview = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`);

  return {
    command,
    commandKey,
    category,
    exitCode,
    success,
    stdoutLen,
    stderrLen,
    stdoutPreview: stdoutLen ? preview(stdoutText, 8000) : null,
    stderrPreview: stderrLen ? preview(stderrText || errStr, 4000) : null,
    estTokens,
    estUsd,
    tokenRisk,
    commandNotFound,
    permissionDenied,
    illegalArgHint,
    cwd,
    envKeys,
    userId,
    host,
  };
}

export function normalizeCommandKeyForLoop(cmd: string): string {
  return cmd.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 400);
}

/** 列表接口用：不含长 stdout 正文 */
export type ParsedShellSpanLite = {
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

export function toParsedShellSpanLite(p: ParsedShellSpan): ParsedShellSpanLite {
  return {
    command: p.command.slice(0, 2000),
    category: p.category,
    exitCode: p.exitCode,
    success: p.success,
    stdoutLen: p.stdoutLen,
    stderrLen: p.stderrLen,
    estTokens: p.estTokens,
    estUsd: Math.round(p.estUsd * 10000) / 10000,
    tokenRisk: p.tokenRisk,
    commandNotFound: p.commandNotFound,
    permissionDenied: p.permissionDenied,
    cwd: p.cwd,
    userId: p.userId,
    host: p.host,
  };
}
