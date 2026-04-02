/**
 * 从 OpenClaw `llm_input` 事件（及嵌套对象）中抽取路由/模型开关字段，写入 trace metadata。
 * OpenClaw 版本间字段名可能不同，此处做多别名与嵌套合并；未出现的键不写。
 */

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) {
        return t;
      }
    }
  }
  return undefined;
}

function pickStrOrBoolString(o: Record<string, unknown>, keys: string[]): string | boolean | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") {
      return v;
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) {
        return t;
      }
    }
  }
  return undefined;
}

function pickFiniteInt(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = Math.trunc(v);
      if (n >= 0) {
        return n;
      }
    }
    if (typeof v === "string" && /^\d+$/.test(v.trim())) {
      const n = Math.trunc(Number(v.trim()));
      if (n >= 0) {
        return n;
      }
    }
  }
  return undefined;
}

function mergeFromObject(target: Record<string, unknown>, src: Record<string, unknown>): void {
  const label = pickStr(src, [
    "routingLabel",
    "routeLabel",
    "label",
    "displayLabel",
    "routing_label",
    "route_label",
    "sessionLabel",
    "routeName",
    "route_name",
    "bindingLabel",
    "binding_label",
  ]);
  if (label !== undefined) {
    target.label = label;
  }

  const kind = pickStr(src, ["routingKind", "routeKind", "kind", "sessionKind", "routing_kind", "route_kind", "session_kind"]);
  if (kind !== undefined) {
    target.kind = kind;
  }

  const thinking = pickStrOrBoolString(src, [
    "thinking",
    "thinkingLevel",
    "thinking_level",
    "thinkingMode",
    "includeThinking",
    "thinking_mode",
    "include_thinking",
    "thinkingEnabled",
    "thinking_enabled",
  ]);
  if (thinking !== undefined) {
    target.thinking = thinking;
  }

  const fast = pickStrOrBoolString(src, ["fast", "fastMode", "fast_mode"]);
  if (fast !== undefined) {
    target.fast = fast;
  }

  const verbose = pickStrOrBoolString(src, [
    "verbose",
    "verboseLevel",
    "verbose_level",
    "verboseMode",
    "verbose_mode",
  ]);
  if (verbose !== undefined) {
    target.verbose = verbose;
  }

  const reasoning = pickStrOrBoolString(src, [
    "reasoning",
    "reasoningLevel",
    "reasoning_level",
    "reasoningEffort",
    "reasoningMode",
    "reasoning_effort",
    "reasoning_mode",
  ]);
  if (reasoning !== undefined) {
    target.reasoning = reasoning;
  }

  const maxCtx = pickFiniteInt(src, [
    "maxContextTokens",
    "contextTokens",
    "context_tokens",
    "contextWindowMax",
    "tokenLimit",
    "max_tokens",
    "context_window_tokens",
    "contextWindow",
    "maxInputTokens",
  ]);
  if (maxCtx !== undefined) {
    target.max_context_tokens = maxCtx;
  }
}

/**
 * OpenClaw 会话表里 THINKING/FAST/VERBOSE/REASONING 的空串表示 inherit；
 * `openclawSession` 快照会省略这些键，导致观测侧只有 kind 有值。若事件上带了快照，则为未出现的键补上 `inherit`。
 */
function applyOpenclawSessionInheritPlaceholders(out: Record<string, unknown>, ev: Record<string, unknown>): void {
  if (!isPlainObj(ev.openclawSession)) {
    return;
  }
  for (const k of ["thinking", "verbose", "reasoning", "fast"] as const) {
    if (out[k] === undefined) {
      out[k] = "inherit";
    }
  }
}

/** OpenClaw / LangChain 等可能把开关放在这些嵌套键下 */
const ROUTING_NEST_KEYS = [
  "options",
  "modelOptions",
  "providerOptions",
  "completionOptions",
  "request",
  "requestOptions",
  "params",
  "body",
  "kwargs",
  "extra",
  "extras",
  "metadata",
  "config",
  "settings",
  "invocationParams",
  "invocation_params",
  "llmConfig",
  "llm_config",
] as const;

function collectRoutingFromRecord(ev: Record<string, unknown>, out: Record<string, unknown>): void {
  mergeFromObject(out, ev);

  if (isPlainObj(ev.openclawSession)) {
    mergeFromObject(out, ev.openclawSession);
  }

  const nestedSources: unknown[] = [
    ev.routing,
    ev.route,
    ev.routeConfig,
    ev.route_config,
    ev.openclawRouting,
    ev.openclaw_routing,
  ];
  if (isPlainObj(ev.openclaw)) {
    nestedSources.push(ev.openclaw.routing, ev.openclaw.route, (ev.openclaw as Record<string, unknown>).routing_config);
  }

  for (const n of nestedSources) {
    if (isPlainObj(n)) {
      mergeFromObject(out, n);
    }
  }

  for (const k of ROUTING_NEST_KEYS) {
    const n = ev[k];
    if (isPlainObj(n)) {
      mergeFromObject(out, n);
    }
  }

  applyOpenclawSessionInheritPlaceholders(out, ev);
}

/**
 * 合并根对象、显式 routing 子对象，以及常见嵌套（options / kwargs / metadata 等）。
 */
export function extractLlmInputRoutingMeta(ev: unknown): Record<string, unknown> | undefined {
  if (!isPlainObj(ev)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  collectRoutingFromRecord(ev, out);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 后出现的 layer 覆盖先出现的同名字段（用于 pending → ctx → llm_input 优先级）。 */
export function mergeOpenclawRoutingLayers(
  ...layers: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) {
      continue;
    }
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 从 pending `user_turn.message_received.metadata` 抽路由展示字段（与控制台表格对齐）。 */
export function extractRoutingFromPendingUserTurn(pending: Record<string, unknown>): Record<string, unknown> | undefined {
  const mr = pending.message_received;
  if (!isPlainObj(mr)) {
    return undefined;
  }
  const md = mr.metadata;
  if (!isPlainObj(md)) {
    return undefined;
  }
  return extractLlmInputRoutingMeta(md);
}

export function pickLlmInputModelParams(ev: unknown): Record<string, unknown> | undefined {
  if (!isPlainObj(ev)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  const t = ev.temperature;
  if (typeof t === "number" && Number.isFinite(t)) {
    out.temperature = t;
  }
  const tp = ev.topP ?? ev.top_p;
  if (typeof tp === "number" && Number.isFinite(tp)) {
    out.topP = tp;
  }
  const mt = ev.maxTokens ?? ev.max_tokens;
  if (typeof mt === "number" && Number.isFinite(mt) && mt >= 0) {
    out.maxTokens = Math.trunc(mt);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
