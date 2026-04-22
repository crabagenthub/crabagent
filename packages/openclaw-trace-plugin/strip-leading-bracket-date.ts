/**
 * 与 Go 侧 `iseeagentc/internal/parser` / model 入库前规范化规则一致：剥文首 `[…日期…]` 时间戳。
 * `list_input_preview` 另剥 OpenClaw 文首多段入站元数据 + ```json 围栏（与 `apps/web` `INBOUND_META_SENTINELS` 对齐），避免列表展示成模型 prompt 前缀。
 */

/** 与 `apps/web/src/lib/strip-inbound-meta.ts` 同步 */
const INBOUND_META_SENTINELS = [
  "Conversation info (untrusted metadata):",
  "Sender (untrusted metadata):",
  "Thread starter (untrusted, for context):",
  "Replied message (untrusted, for context):",
  "Forwarded message context (untrusted metadata):",
  "Chat history since last reply (untrusted, for context):",
] as const;

function lineMatchesAnyInboundSentinel(line: string | undefined): string | null {
  if (line == null) {
    return null;
  }
  const t = line.trim().toLowerCase();
  for (const s of INBOUND_META_SENTINELS) {
    if (t === s.trim().toLowerCase()) {
      return s;
    }
  }
  return null;
}

function isOpeningJsonFenceLine(line: string | undefined): boolean {
  return /^\s*```json\s*$/i.test(line ?? "");
}

/** 若文首为任一入站元数据标题行 + ```json … ```，剥除一段并返回余下正文；否则原样。 */
function stripOneLeadingFencedJsonMetaBlock(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") {
    i += 1;
  }
  if (i >= lines.length) {
    return text;
  }
  if (lineMatchesAnyInboundSentinel(lines[i]) == null) {
    return text;
  }
  i += 1;
  if (i >= lines.length || !isOpeningJsonFenceLine(lines[i])) {
    return text;
  }
  i += 1;
  while (i < lines.length && (lines[i] ?? "").trim() !== "```") {
    i += 1;
  }
  if (i >= lines.length) {
    return text;
  }
  i += 1;
  while (i < lines.length && (lines[i] ?? "").trim() === "") {
    i += 1;
  }
  const rest = lines.slice(i).join("\n");
  return rest.length > 0 ? rest : text;
}

/**
 * 连续剥文首多段 `…(untrusted metadata)…` + ```json``` 块（Feishu 等常在 Conversation info 之后还有 Sender 等）。
 * 与 Web `stripLeadingInboundMetadata` 首段行为一致，此处仅处理围栏 JSON 块以便入库预览。
 */
export function stripLeadingInboundFencedJsonBlocks(text: string): string {
  let s = text;
  for (let n = 0; n < 16; n += 1) {
    const next = stripOneLeadingFencedJsonMetaBlock(s);
    if (next === s) {
      break;
    }
    s = next;
  }
  return s;
}

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
      if (k === "list_input_preview") {
        out[k] = stripLeadingBracketDatePrefixes(stripLeadingInboundFencedJsonBlocks(v));
      } else {
        out[k] = stripLeadingBracketDatePrefixes(v);
      }
    }
  }
  const ut = out.user_turn;
  if (ut && typeof ut === "object" && !Array.isArray(ut)) {
    out.user_turn = stripUserTurnRecord(ut as Record<string, unknown>);
  }
  return out;
}

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
