import type { TraceTimelineEvent } from "@/features/observe/traces/components/trace-timeline-tree";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { usageFromTracePayload } from "@/lib/trace-payload-usage";
import type { TurnWindowMetrics } from "@/lib/user-turn-list";

/** 与 `semanticSpanTokenEntries` / `usage_breakdown` 中 cache 键对齐（Collector 可能只写 breakdown、不写 `cache_read_tokens`）。 */
function cacheReadFromSpanUsageBreakdown(span: SemanticSpanRow): number {
  const bd =
    span.usage_breakdown && typeof span.usage_breakdown === "object" && !Array.isArray(span.usage_breakdown)
      ? (span.usage_breakdown as Record<string, unknown>)
      : {};
  const keys = [
    "cache_read_tokens",
    "cacheRead",
    "cache_read",
    "cached_prompt_tokens",
    "prompt_cache_hit_tokens",
    "cached_tokens",
  ];
  let max = 0;
  for (const k of keys) {
    const v = bd[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      max = Math.max(max, Math.trunc(v));
    }
  }
  return max;
}

/** 与语义树 / Collector `usage_json` 解析一致，用于侧栏、抽屉、Run 面板的 Token 展示。 */
export function spanTokenTotals(span: SemanticSpanRow): {
  prompt: number;
  completion: number;
  cacheRead: number;
  /** 仅当服务端显式返回 `total_tokens` 时有值（可与 displayTotal 不同，用于「总计来源」说明）。 */
  total: number | null;
  /** 界面展示的合计：优先 `total_tokens`，否则为 prompt+completion+cacheRead。 */
  displayTotal: number | null;
  hasAny: boolean;
} {
  const prompt = span.prompt_tokens ?? 0;
  const completion = span.completion_tokens ?? 0;
  const cacheCanonical =
    span.cache_read_tokens != null && Number.isFinite(span.cache_read_tokens) ? Math.trunc(span.cache_read_tokens) : 0;
  const cacheRead = Math.max(cacheCanonical, cacheReadFromSpanUsageBreakdown(span));
  const sumParts = prompt + completion + cacheRead;
  const explicitTotal =
    span.total_tokens != null && Number.isFinite(span.total_tokens)
      ? Math.max(0, Math.trunc(span.total_tokens))
      : null;
  const displayTotal = explicitTotal ?? (sumParts > 0 ? sumParts : null);
  const bd =
    span.usage_breakdown &&
    typeof span.usage_breakdown === "object" &&
    !Array.isArray(span.usage_breakdown)
      ? (span.usage_breakdown as Record<string, number>)
      : {};
  const hasAny =
    span.total_tokens != null ||
    prompt > 0 ||
    completion > 0 ||
    cacheRead > 0 ||
    Object.keys(bd).length > 0;
  return {
    prompt,
    completion,
    cacheRead,
    total: explicitTotal,
    displayTotal,
    hasAny,
  };
}

/**
 * Popover 展示：`total_tokens` 与 `total` 统一为 **input + output**（或等价字段 `prompt_tokens` + `completion_tokens`），
 * 避免 API 返回的 total 与分项不一致。
 */
export function normalizeTokenUsageEntriesForDisplay(entries: Record<string, number>): Record<string, number> {
  const e = { ...entries };
  const hasPart =
    "prompt_tokens" in e ||
    "completion_tokens" in e ||
    "input" in e ||
    "output" in e;
  if (!hasPart) {
    return e;
  }
  const p = Math.max(0, Math.trunc(e.prompt_tokens ?? e.input ?? 0));
  const c = Math.max(0, Math.trunc(e.completion_tokens ?? e.output ?? 0));
  const sumIo = p + c;
  e.total_tokens = sumIo;
  if ("total" in e) {
    e.total = sumIo;
  }
  return e;
}

/** 合并 `usage_breakdown` 与 canonical 字段，供 Token 明细卡片与 Popover 统一展示（与语义树 mergeTokenDisplay 一致）。 */
export function semanticSpanTokenEntries(span: SemanticSpanRow): Record<string, number> {
  const bd =
    span.usage_breakdown && typeof span.usage_breakdown === "object" && !Array.isArray(span.usage_breakdown)
      ? (span.usage_breakdown as Record<string, number>)
      : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.trunc(v);
    }
  }
  const set = (k: string, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) {
      return;
    }
    if (out[k] === undefined) {
      out[k] = Math.trunc(v);
    }
  };
  set("prompt_tokens", span.prompt_tokens);
  set("completion_tokens", span.completion_tokens);
  set("cache_read_tokens", span.cache_read_tokens);
  set("total_tokens", span.total_tokens);
  return out;
}

function mergeTokenEntriesSum(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/**
 * 单条 `llm_output` payload → 与 `semanticSpanTokenEntries` 同逻辑（`usage_breakdown` 优先，缺再用 `usageFromTracePayload`）。
 */
export function tokenEntriesFromLlmOutputPayload(p: Record<string, unknown>): Record<string, number> {
  const bd =
    p.usage_breakdown && typeof p.usage_breakdown === "object" && !Array.isArray(p.usage_breakdown)
      ? (p.usage_breakdown as Record<string, number>)
      : {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.trunc(v);
    }
  }
  const u = usageFromTracePayload(p);
  const set = (k: string, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) {
      return;
    }
    if (out[k] === undefined) {
      out[k] = Math.trunc(v);
    }
  };
  set("prompt_tokens", u.prompt);
  set("completion_tokens", u.completion);
  set("cache_read_tokens", u.cacheRead);
  if (u.total != null && u.total > 0) {
    set("total_tokens", u.total);
  }
  return out;
}

/**
 * 用户轮次窗口内全部 `llm_output` 的 usage（含 `usage_breakdown`）累加，
 * 与 Trace 详情语义树 LLM 节点数据来源一致。
 */
export function aggregateLlmOutputTokenEntries(events: readonly TraceTimelineEvent[]): Record<string, number> {
  let acc: Record<string, number> = {};
  for (const e of events) {
    if ((e.type ?? "") !== "llm_output") {
      continue;
    }
    const payload =
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : {};
    acc = mergeTokenEntriesSum(acc, tokenEntriesFromLlmOutputPayload(payload));
  }
  return acc;
}

/**
 * 会话左侧主数字：有 input/output（或 prompt/completion）分项时为其和（不含 cache）；否则用显式 total。
 */
export function usageRecordDisplayTotals(entries: Record<string, number>): {
  displayTotal: number | null;
  prompt: number | null;
  completion: number | null;
  cacheRead: number;
} {
  const prompt =
    typeof entries.prompt_tokens === "number"
      ? entries.prompt_tokens
      : typeof entries.input === "number"
        ? entries.input
        : null;
  const completion =
    typeof entries.completion_tokens === "number"
      ? entries.completion_tokens
      : typeof entries.output === "number"
        ? entries.output
        : null;
  const cacheRead =
    typeof entries.cache_read_tokens === "number"
      ? entries.cache_read_tokens
      : typeof entries.cacheRead === "number"
        ? entries.cacheRead
        : 0;
  const explicitTotal =
    typeof entries.total_tokens === "number" && entries.total_tokens > 0
      ? Math.trunc(entries.total_tokens)
      : typeof entries.total === "number" && entries.total > 0
        ? Math.trunc(entries.total)
        : null;
  /** 左侧汇总数字不含 cache；有 prompt+completion 时优先用其和，否则回退到仅有显式 total 的 API。 */
  const sumNoCache = (prompt ?? 0) + (completion ?? 0);
  const displayTotal =
    sumNoCache > 0 ? sumNoCache : explicitTotal != null && explicitTotal > 0 ? explicitTotal : null;
  return { displayTotal, prompt, completion, cacheRead };
}

/** 会话抽屉单轮 `TurnWindowMetrics` → 与 `semanticSpanTokenEntries` 同形的 `Record`，供 `TokenUsageDetailsCard` 使用。 */
export function turnWindowTokenEntries(m: TurnWindowMetrics): Record<string, number> {
  const out: Record<string, number> = {};
  const hasAny =
    (m.displayTotal != null && m.displayTotal > 0) ||
    m.promptTokens > 0 ||
    m.completionTokens > 0 ||
    m.cacheReadTokens > 0;
  if (!hasAny) {
    return out;
  }
  out.prompt_tokens = m.promptTokens;
  out.completion_tokens = m.completionTokens;
  if (m.cacheReadTokens > 0) {
    out.cache_read_tokens = m.cacheReadTokens;
  }
  const sumNoCache = out.prompt_tokens + out.completion_tokens;
  if (m.displayTotal != null && m.displayTotal > 0 && sumNoCache === 0 && (out.cache_read_tokens ?? 0) === 0) {
    out.total_tokens = Math.trunc(m.displayTotal);
  }
  return out;
}
