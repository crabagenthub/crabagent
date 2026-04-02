/**
 * 会话键解析：思路对齐 @cozeloop/openclaw-cozeloop-trace 的 resolveChannelId / normalizeChannelId，
 * 让飞书 user:/chat:、feishu:from、agent:、hook: 等与 OpenClaw 各 hook 上的 sessionKey/sessionId 能映射到同一组别名，
 * pending 多写多读，避免 email_automatic 等场景下 message_received 与 agent_end / llm_input 字段不一致丢数。
 *
 * 非 main agent 常见情况是 ctx.sessionKey/sessionId 仍指向主会话，仅 ctx.agentId 区分路由；
 * 此时在键上追加 \x1fagent:<id>，避免子 agent 的 LLM / pending 全部叠到 main 的 thread。
 */

export type TraceAgentCtx = {
  sessionId?: string;
  sessionKey?: string;
  channelId?: string;
  conversationId?: string;
  messageProvider?: string;
  agentId?: string;
  /** subagent 等场景下子会话路由键（若 OpenClaw 放在 ctx 上）。 */
  childSessionKey?: string;
};

/** 从 OpenClaw `agent:<agentId>:…` 或 resolvePrimaryTraceKey 归一后的 `agent/<id>:…` 解析 agent id。 */
export function extractAgentIdFromRoutingSessionKey(sk?: string): string | undefined {
  const t = sk?.trim() ?? "";
  const m1 = /^agent:([^:]+):/i.exec(t);
  if (m1?.[1]?.trim()) {
    return m1[1].trim();
  }
  const m2 = /^agent\/([^:]+):/i.exec(t);
  if (m2?.[1]?.trim()) {
    return m2[1].trim();
  }
  return undefined;
}

/**
 * 从 `agent:<agentId>:<provider>:<kind>:…` 形态 sessionKey 解析路由 kind（如 `group`、`dm`）。
 * 若形态不符或第四段像会话 id（如 `oc_` 前缀）则返回 undefined，避免误标。
 */
export function parseRoutingKindFromSessionKey(sk?: string): string | undefined {
  const t = sk?.trim() ?? "";
  if (!t) {
    return undefined;
  }
  const parts = t.split(":");
  if (parts.length < 4) {
    return undefined;
  }
  const head = parts[0]?.toLowerCase();
  if (head !== "agent") {
    return undefined;
  }
  const kindSeg = parts[3]?.trim() ?? "";
  if (!kindSeg || kindSeg.length > 48) {
    return undefined;
  }
  if (/^(oc_|ou_|og_)/i.test(kindSeg)) {
    return undefined;
  }
  if (!/^[a-z][a-z0-9_-]*$/i.test(kindSeg)) {
    return undefined;
  }
  return kindSeg;
}

function sessionKeyImpliesAgent(sk: string | undefined, aid: string): boolean {
  const fromSk = extractAgentIdFromRoutingSessionKey(sk);
  return Boolean(fromSk && fromSk.toLowerCase() === aid.toLowerCase());
}

/** 用于 agent 维度后缀：ctx.agentId 或已编码在 sessionKey/childSessionKey 中的路由 id。 */
export function deriveTraceAgentId(ctx: TraceAgentCtx): string | undefined {
  const raw = ctx.agentId?.trim();
  if (raw && raw.toLowerCase() !== "main") {
    return raw;
  }
  const fromSk =
    extractAgentIdFromRoutingSessionKey(ctx.sessionKey) ??
    extractAgentIdFromRoutingSessionKey(ctx.childSessionKey) ??
    extractAgentIdFromRoutingSessionKey(ctx.channelId);
  if (fromSk && fromSk.toLowerCase() !== "main") {
    return fromSk;
  }
  return undefined;
}

/** 与 CozeLoop `normalizeChannelId` 同构（略去与 trace 无关的 default）。 */
export function normalizeTraceChannelId(input: string, defaultPlatform = "system"): string {
  const t = input.trim();
  if (!t || t === "unknown") {
    return `${defaultPlatform}/unknown`;
  }
  if (t.includes("/")) {
    return t;
  }
  const prefix = t.split(/[_:]/)[0] ?? "";
  switch (prefix) {
    case "ou":
    case "oc":
    case "og":
      return `feishu/${t}`;
    case "user":
    case "chat":
      return `feishu/${t.slice(prefix.length + 1)}`;
    case "agent":
      return `agent/${t.slice(6)}`;
    default:
      return `${defaultPlatform}/${t}`;
  }
}

/**
 * 单路「主」键：在只有 conversationId / channelId 时也能落到稳定字符串（便于 thread 展示）。
 */
export function resolvePrimaryTraceKey(ctx: TraceAgentCtx, eventFrom?: string): string {
  const conv = ctx.conversationId?.trim();
  if (conv && /^(user|chat):/i.test(conv)) {
    return normalizeTraceChannelId(conv);
  }
  const from = eventFrom?.trim();
  if (from && /^feishu:/i.test(from)) {
    return `feishu/${from.slice(7)}`;
  }
  const ch = ctx.channelId?.trim();
  if (ch && /^feishu\/(ou|oc|og)_/i.test(ch)) {
    return ch;
  }
  const sk = ctx.sessionKey?.trim();
  if (sk) {
    if (sk.startsWith("hook:") || sk.startsWith("session:")) {
      return sk;
    }
    if (/^agent:/i.test(sk)) {
      return normalizeTraceChannelId(sk);
    }
    return sk;
  }
  if (ch) {
    return ch.includes("/") ? ch : normalizeTraceChannelId(ch);
  }
  if (conv) {
    return conv;
  }
  const sid = ctx.sessionId?.trim();
  if (sid) {
    return sid;
  }
  if (from) {
    return normalizeTraceChannelId(from);
  }
  return "unknown-session";
}

/**
 * OpenClaw 飞书路由常见 `agent:<id>:feishu:group:oc_xxx`；入站 hook 往往只在 `feishu/oc_xxx` 或裸 `oc_xxx` 上 merge pending。
 * 为 LLM / agent_end 侧 sessionKey 补充 `feishu/<id>`，使 `takePendingAliases` 能命中同一会话。
 */
function feishuOpenClawRoutingExtras(sk: string): string[] {
  const t = sk.trim();
  const m = /^agent:[^:]+:feishu:(.+)$/i.exec(t);
  if (!m?.[1]) {
    return [];
  }
  let rest = m[1].trim();
  if (/^group:/i.test(rest)) {
    rest = rest.slice("group:".length).trim();
  }
  if (!rest || rest.includes("/")) {
    return [];
  }
  if (/^user:/i.test(rest)) {
    const id = rest.slice("user:".length).trim();
    return id ? [`feishu/${id}`] : [];
  }
  if (/^chat:/i.test(rest)) {
    const id = rest.slice("chat:".length).trim();
    return id ? [`feishu/${id}`] : [];
  }
  if (!rest.includes(":")) {
    return [`feishu/${rest}`];
  }
  return [];
}

function traceSessionKeyCandidatesBase(ctx: TraceAgentCtx, eventFrom?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw?: string) => {
    const t = raw?.trim();
    if (!t || seen.has(t)) {
      return;
    }
    seen.add(t);
    out.push(t);
  };

  const fromTrim = eventFrom?.trim();

  add(resolvePrimaryTraceKey(ctx, eventFrom));
  add(ctx.sessionKey);
  add(ctx.sessionId);
  add(ctx.conversationId);
  add(ctx.channelId);
  const prov = ctx.messageProvider?.trim();
  const c = ctx.conversationId?.trim();
  if (prov && c) {
    add(`${prov}:${c}`);
  }
  const ch2 = ctx.channelId?.trim();
  if (prov && ch2) {
    add(`${prov}:${ch2}`);
  }
  if (fromTrim) {
    if (/^feishu:/i.test(fromTrim)) {
      add(`feishu/${fromTrim.slice(7)}`);
    } else {
      add(normalizeTraceChannelId(fromTrim));
    }
  }

  const snapshot = [...out];
  for (const b of snapshot) {
    for (const e of feishuOpenClawRoutingExtras(b)) {
      add(e);
    }
  }

  if (out.length === 0) {
    return ["unknown-session"];
  }
  return out;
}

function expandAgentScopedCandidates(bases: string[], aid: string): string[] {
  if (bases.some((b) => sessionKeyImpliesAgent(b, aid))) {
    return bases;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bases) {
    const s = `${b}\x1fagent:${aid}`;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  for (const b of bases) {
    if (!seen.has(b)) {
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

/**
 * 所有应参与 pending 读写的别名（去重有序）。OpenClaw 不同 hook 可能只填其中一部分。
 * 非 main 且 session 键未显式含 `agent:<id>:` 时，为每个基键追加 `\x1fagent:<id>` 变体并优先，避免与 main 串线。
 */
export function traceSessionKeyCandidates(ctx: TraceAgentCtx, eventFrom?: string): string[] {
  const bases = traceSessionKeyCandidatesBase(ctx, eventFrom);
  const aid = deriveTraceAgentId(ctx);
  if (!aid) {
    return bases;
  }
  return expandAgentScopedCandidates(bases, aid);
}

/**
 * `message_received` 用 `event.from` 扩充 pending 键；仅传 ctx 的 hook（如 `llm_input` / `agent_end`）会少一组别名，
 * 导致 peek/takePending 命中不了同一批 pending。将 `conversationId` / `channelId` 当作 from 再跑候选合并。
 */
export function traceSessionKeyCandidatesForPending(ctx: TraceAgentCtx): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const addAll = (keys: string[]) => {
    for (const raw of keys) {
      const k = raw.trim();
      if (!k || seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(k);
    }
  };
  addAll(traceSessionKeyCandidates(ctx));
  const conv = ctx.conversationId?.trim();
  if (conv) {
    addAll(traceSessionKeyCandidates(ctx, conv));
  }
  const ch = ctx.channelId?.trim();
  if (ch && ch !== conv) {
    addAll(traceSessionKeyCandidates(ctx, ch));
  }
  return out.length > 0 ? out : ["unknown-session"];
}

/** 入站 + LLM 侧并集：`message_received` 的 `from` 与 ctx 派生键合并，避免 deferred flush / pending take 键不一致。 */
export function traceSessionKeyCandidatesForInbound(ctx: TraceAgentCtx, eventFrom?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const addAll = (keys: string[]) => {
    for (const raw of keys) {
      const k = raw.trim();
      if (!k || seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(k);
    }
  };
  addAll(traceSessionKeyCandidatesForPending(ctx));
  const from = eventFrom?.trim();
  if (from) {
    addAll(traceSessionKeyCandidates(ctx, from));
  }
  return out.length > 0 ? out : ["unknown-session"];
}

/** ActiveTurn / 采样跳过等：优先 OpenClaw broker 的 sessionKey → sessionId，再回落到主 trace 键。 */
export function effectiveTraceSessionKey(ctx: TraceAgentCtx, eventFrom?: string): string {
  const a = ctx.sessionKey?.trim();
  if (a) {
    return a;
  }
  const b = ctx.sessionId?.trim();
  if (b) {
    return b;
  }
  const p = resolvePrimaryTraceKey(ctx, eventFrom);
  if (p && p !== "unknown-session") {
    return p;
  }
  return "unknown-session";
}

/**
 * 与 `traceSessionKeyCandidates` 中「主」活跃键一致：在需区分子 agent 时为 effective 基键加 agent 后缀。
 */
export function agentScopedTraceKey(ctx: TraceAgentCtx, eventFrom?: string): string {
  const base = effectiveTraceSessionKey(ctx, eventFrom);
  const aid = deriveTraceAgentId(ctx);
  if (!aid) {
    return base;
  }
  if (sessionKeyImpliesAgent(ctx.sessionKey, aid) || sessionKeyImpliesAgent(ctx.childSessionKey, aid)) {
    return base;
  }
  return `${base}\x1fagent:${aid}`;
}
