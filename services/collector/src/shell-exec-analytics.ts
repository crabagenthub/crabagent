/**
 * 从 OpenClaw / Opik tool span 的 input/output 中解析 Shell 执行语义，
 * 用于「指令执行分析」聚合与列表（无独立 shell 表时依赖 JSON 启发式）。
 */
import type { ResourceAuditConfig } from "./resource-audit-config.js";

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
  platform: "unix" | "windows_cmd" | "powershell";
  commandAst: ShellCommandAst;
};

export type ShellCommandAstNode = {
  kind: "command" | "pipe" | "sequence" | "and" | "or";
  raw: string;
  argv: string[];
  children?: ShellCommandAstNode[];
};

export type ShellCommandAst = {
  shell: "unix" | "windows_cmd" | "powershell";
  nodes: ShellCommandAstNode[];
};

const TOKEN_RISK_STDOUT_CHARS_DEFAULT = 24_000;
const TOKEN_APPROX_DIVISOR = 4;
const USD_PER_MTOK = 0.5;

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

function normalizeToken(tok: string, config: ResourceAuditConfig): string {
  const key = tok.trim().toLowerCase();
  return config.shellExec.commandSemantics.aliases[key] ?? key;
}

function detectPlatform(
  command: string,
  metadataJson: string | null | undefined,
  config: ResourceAuditConfig,
): "unix" | "windows_cmd" | "powershell" {
  const spanName = String(parseJsonObject(metadataJson).name ?? "").toLowerCase();
  const hints = config.shellExec.commandSemantics.platformDetect.spanNameHints;
  if (config.shellExec.commandSemantics.platformDetect.preferSpanNameHints) {
    if (hints.powershell.some((h) => spanName.includes(h.toLowerCase()))) return "powershell";
    if (hints.windows_cmd.some((h) => spanName.includes(h.toLowerCase()))) return "windows_cmd";
    if (hints.unix.some((h) => spanName.includes(h.toLowerCase()))) return "unix";
  }
  const t = firstToken(command);
  if (["powershell", "pwsh", "get-childitem", "get-content", "remove-item"].includes(t)) {
    return "powershell";
  }
  if (["cmd", "cmd.exe", "dir", "type", "del", "copy", "move", "findstr"].includes(t)) {
    return "windows_cmd";
  }
  return config.shellExec.commandSemantics.defaultPlatform;
}

export function classifyCommandCategory(cmd: string, config: ResourceAuditConfig): ShellCommandCategory {
  const tok = normalizeToken(firstToken(cmd), config);
  if (!tok) {
    return "other";
  }
  const categories = config.shellExec.commandSemantics.categories;
  if (categories.file.includes(tok)) {
    return "file";
  }
  if (categories.network.includes(tok)) {
    return "network";
  }
  if (categories.system.includes(tok)) {
    return "system";
  }
  if (categories.process.includes(tok)) {
    return "process";
  }
  if (categories.package.includes(tok)) {
    return "package";
  }
  return "other";
}

function tokenizeBySpace(input: string): string[] {
  return input.split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

function parseCommandAst(command: string, platform: "unix" | "windows_cmd" | "powershell"): ShellCommandAst {
  const trim = command.trim();
  if (!trim) {
    return { shell: platform, nodes: [] };
  }
  const splitBy = (src: string, sep: RegExp): string[] => src.split(sep).map((x) => x.trim()).filter(Boolean);
  const seq = splitBy(trim, /(?:&&|\|\||;)/g);
  const nodes: ShellCommandAstNode[] = seq.map((raw) => {
    const pipes = splitBy(raw, /\|/g);
    if (pipes.length <= 1) {
      return { kind: "command", raw, argv: tokenizeBySpace(raw) };
    }
    return {
      kind: "pipe",
      raw,
      argv: [],
      children: pipes.map((p) => ({ kind: "command", raw: p, argv: tokenizeBySpace(p) })),
    };
  });
  return { shell: platform, nodes };
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
}, config: ResourceAuditConfig, opts?: { tokenRiskStdoutChars?: number }): ParsedShellSpan {
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
  const category = classifyCommandCategory(command, config);
  const platform = detectPlatform(command, row.metadata_json, config);
  const commandAst = parseCommandAst(command, platform);
  const { cwd, envKeys } = extractCwdEnv(params);

  const exitCode = digExitCode(innerResult);
  const { out: stdoutText, err: stderrText } = collectTextLengths(innerResult);
  const stdoutLen = stdoutText.length;
  const stderrLen = stderrText.length + (errStr ? errStr.length : 0);

  const commandNotFound =
    config.shellExec.commandSemantics.diagnosticPatterns.commandNotFound.some((pat) =>
      new RegExp(pat, "i").test(errStr + "\n" + stdoutText + "\n" + stderrText),
    );
  const permissionDenied =
    config.shellExec.commandSemantics.diagnosticPatterns.permissionDenied.some((pat) =>
      new RegExp(pat, "i").test(errStr + "\n" + stdoutText + "\n" + stderrText),
    );
  const illegalArgHint =
    config.shellExec.commandSemantics.diagnosticPatterns.illegalArgHint.some((pat) =>
      new RegExp(pat, "i").test(errStr + "\n" + stdoutText + "\n" + stderrText),
    );

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
  const tokenRiskStdoutChars =
    opts?.tokenRiskStdoutChars != null &&
    Number.isFinite(opts.tokenRiskStdoutChars) &&
    opts.tokenRiskStdoutChars >= 0
      ? Math.floor(opts.tokenRiskStdoutChars)
      : TOKEN_RISK_STDOUT_CHARS_DEFAULT;
  const tokenRisk = stdoutLen >= tokenRiskStdoutChars;

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
    platform,
    commandAst,
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
  platform: "unix" | "windows_cmd" | "powershell";
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
    platform: p.platform,
  };
}
