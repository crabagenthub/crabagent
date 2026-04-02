/**
 * 通道（钉钉等）在用户文首注入的 `[Thu 2026-04-02 13:24 GMT+8]`：入库前剥离，避免写入 DB。
 * 规则与 `apps/web/src/lib/strip-inbound-meta.ts` 中 `stripLeadingBracketDatePrefixes` 对齐。
 */

// Strip bracket date prefixes at the start of the whole string OR at the start of any new line.
// Example: `...\n[Thu ... GMT+8] user text` should become `...\nuser text`.
const BRACKET_DATE_PREFIX_LINE_START_RE =
  /(^|\r?\n)\[[^\]]*(?:\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2})[^\]]*]\s*/g;
const BRACKET_DATE_PREFIX_LINE_START_TEST_RE =
  /(^|\r?\n)\[[^\]]*(?:\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2})[^\]]*]\s*/;

export function stripLeadingBracketDatePrefixes(text: string): string {
  const out = text.replace(BRACKET_DATE_PREFIX_LINE_START_RE, "$1");
  return out;
}

function stripUserTurnRecord(ut: Record<string, unknown>): Record<string, unknown> {
  const out = { ...ut };
  const mr = out.message_received;
  if (mr && typeof mr === "object" && !Array.isArray(mr)) {
    const m = { ...(mr as Record<string, unknown>) };
    if (typeof m.content === "string" && m.content.length > 0) {
      m.content = stripLeadingBracketDatePrefixes(m.content);
    }
    out.message_received = m;
  }
  return out;
}

const TRACE_INPUT_STRING_KEYS = [
  "list_input_preview",
  "prompt",
  "systemPrompt",
  "text",
  "body",
  "message",
  "content",
] as const;

/**
 * 规范化即将写入 `opik_traces.input_json` 的对象（ingest 与 thread 合成共用）。
 */
export function normalizeOpikTraceInputForStorage(input: unknown): unknown {
  if (input === undefined || input === null) {
    return input;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const o = input as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };
  for (const k of TRACE_INPUT_STRING_KEYS) {
    const v = out[k];
    if (typeof v === "string" && v.length > 0) {
      out[k] = stripLeadingBracketDatePrefixes(v);
    }
  }
  const ut = out.user_turn;
  if (ut && typeof ut === "object" && !Array.isArray(ut)) {
    out.user_turn = stripUserTurnRecord(ut as Record<string, unknown>);
  }
  return out;
}

/** LLM span `input_json` 里的 `promptPreview` 等。 */
export function normalizeOpikSpanInputForStorage(input: unknown): unknown {
  if (input === undefined || input === null) {
    return input;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const o = input as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };
  const spanInputKeys = ["promptPreview", ...TRACE_INPUT_STRING_KEYS] as const;
  for (const k of spanInputKeys) {
    const v = out[k];
    if (typeof v === "string" && v.length > 0) {
      out[k] = stripLeadingBracketDatePrefixes(v);
    }
  }
  return out;
}
