import type Database from "better-sqlite3";
import { normalizeOpikTraceInputForStorage } from "./strip-leading-bracket-date.js";

type TraceRow = {
  trace_id: string;
  thread_id: string | null;
  name: string | null;
  input_json: string | null;
  output_json: string | null;
  metadata_json: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  ended_at_ms: number | null;
  duration_ms: number | null;
};

function strTrim(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return undefined;
}

/** 与 Web `eventMsgId` 对齐：用于同一条用户消息触发的多条 trace（如主命令 + 异步跟进）在 UI 上合并。 */
function extractMsgIdFromTrace(metadata: Record<string, unknown>, input: Record<string, unknown>): string | null {
  const fromMeta =
    strTrim(metadata.msg_id) ??
    strTrim(metadata.messageId) ??
    strTrim(metadata.message_id) ??
    strTrim(metadata.correlation_id);
  if (fromMeta) {
    return fromMeta;
  }
  const ut = input.user_turn;
  if (ut && typeof ut === "object" && !Array.isArray(ut)) {
    const mr = (ut as Record<string, unknown>).message_received;
    if (mr && typeof mr === "object" && !Array.isArray(mr)) {
      const m = mr as Record<string, unknown>;
      const direct =
        strTrim(m.msg_id) ??
        strTrim(m.messageId) ??
        strTrim(m.message_id) ??
        strTrim(m.id);
      if (direct) {
        return direct;
      }
      const mmeta = m.metadata;
      if (mmeta && typeof mmeta === "object" && !Array.isArray(mmeta)) {
        const mm = mmeta as Record<string, unknown>;
        const nested =
          strTrim(mm.msg_id) ??
          strTrim(mm.messageId) ??
          strTrim(mm.message_id) ??
          strTrim(mm.dingtalk_message_id) ??
          strTrim(mm.dingTalkMessageId);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return null;
}

/** 钉钉 / OpenClaw 异步跟进回合：用于会话左侧合并到主命令展示。 */
function inferAsyncCommandTrace(
  metadata: Record<string, unknown>,
  chatTitle: string | null,
  input: Record<string, unknown>,
): boolean {
  if (metadata.async_command === true || metadata.is_async === true) {
    return true;
  }
  const ck = strTrim(metadata.command_kind)?.toLowerCase();
  if (ck === "async" || ck === "async_follow_up" || ck === "async_command") {
    return true;
  }
  const title = (chatTitle ?? "").toLowerCase();
  if (title.includes("异步") || /\basync\b/i.test(title)) {
    return true;
  }
  const ut = input.user_turn;
  if (ut && typeof ut === "object" && !Array.isArray(ut)) {
    const mr = (ut as Record<string, unknown>).message_received;
    if (mr && typeof mr === "object" && !Array.isArray(mr)) {
      const m = mr as Record<string, unknown>;
      if (m.async === true || m.isAsync === true) {
        return true;
      }
      const mmeta = m.metadata;
      if (mmeta && typeof mmeta === "object" && !Array.isArray(mmeta)) {
        const mm = mmeta as Record<string, unknown>;
        if (mm.async_command === true || mm.is_async === true) {
          return true;
        }
        const kind = strTrim(mm.command_kind)?.toLowerCase();
        if (kind === "async" || kind === "async_command" || kind === "async_follow_up") {
          return true;
        }
      }
    }
  }
  return false;
}

function runKindFromMetadata(metadata: Record<string, unknown>): string | null {
  const v = strTrim(metadata.run_kind) ?? strTrim(metadata.runKind);
  return v ?? null;
}

function agentNameFromMetadata(metadata: Record<string, unknown>): string | null {
  for (const k of ["agent_name", "agentName", "agent"] as const) {
    const v = metadata[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  const oc = metadata.openclaw_context;
  if (oc && typeof oc === "object" && !Array.isArray(oc)) {
    const o = oc as Record<string, unknown>;
    for (const k of ["agentName", "agent_name", "agentId", "agent_id"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
  }
  return null;
}

/** 插件写入的 non-LLM / agent_end 合成 trace，勿把 metadata.output_preview 当助手回复。 */
function isSyntheticNonLlmTraceKind(traceKind: unknown): boolean {
  return typeof traceKind === "string" && traceKind.startsWith("agent_end_");
}

function safeObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || String(raw).trim() === "") {
    return {};
  }
  try {
    const j = JSON.parse(String(raw)) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      return j as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Payload shape expected by web `plainTextFromMessagePayload` / `message_received` handling. */
function userPayloadFromInput(input: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(input).length > 0) {
    const n = normalizeOpikTraceInputForStorage(input);
    if (n && typeof n === "object" && !Array.isArray(n)) {
      return n as Record<string, unknown>;
    }
    return { ...input };
  }
  return { text: "—" };
}

function roleLooksAssistantMessage(o: Record<string, unknown>): boolean {
  const role = String(o.role ?? "").toLowerCase();
  const typ = String(o.type ?? "").toLowerCase();
  return (
    role === "assistant" ||
    role === "ai" ||
    role === "model" ||
    role === "bot" ||
    typ === "ai" ||
    typ === "aimessage" ||
    typ === "assistant"
  );
}

/** OpenClaw 首条回复在 UI 常标为 Tool；`messages` 里为 `role: "tool"`，须与 assistant 一并抽取。 */
function roleLooksToolMessage(o: Record<string, unknown>): boolean {
  return String(o.role ?? "").toLowerCase() === "tool";
}

function textFromMessageLike(o: Record<string, unknown>): string | null {
  const content = o.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((x) => {
        if (typeof x === "string") {
          return x;
        }
        if (x && typeof x === "object" && !Array.isArray(x)) {
          const t = (x as Record<string, unknown>).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .filter(Boolean);
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

/** 按时间顺序拼接所有 assistant/tool 段，对齐 OpenClaw 单条 Tool 卡内多段正文。 */
function transcriptJoinedFromAssistantAndToolMessages(messages: unknown[]): string | null {
  const chunks: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      continue;
    }
    const o = m as Record<string, unknown>;
    if (!roleLooksAssistantMessage(o) && !roleLooksToolMessage(o)) {
      continue;
    }
    const t = textFromMessageLike(o);
    if (t && t.trim()) {
      chunks.push(t.trim());
    }
  }
  if (chunks.length === 0) {
    return null;
  }
  return chunks.join("\n\n");
}

/**
 * Normalize trace `output_json` into `assistantTexts[]` for the synthetic `llm_output` row.
 * OpenClaw / ingest often stores `messages`, `result`, or plain strings instead of `assistantTexts`.
 */
function extractAssistantTextsFromOutputShape(output: Record<string, unknown>): string[] | null {
  const direct = output.assistantTexts;
  if (Array.isArray(direct)) {
    const parts = direct
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length > 0) {
      return parts;
    }
  }
  const messages = output.messages;
  if (Array.isArray(messages)) {
    for (let pass = 0; pass < 2; pass += 1) {
      const accept = pass === 0 ? roleLooksAssistantMessage : roleLooksToolMessage;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (!m || typeof m !== "object" || Array.isArray(m)) {
          continue;
        }
        const o = m as Record<string, unknown>;
        if (!accept(o)) {
          continue;
        }
        const t = textFromMessageLike(o);
        if (t) {
          return [t];
        }
      }
    }
  }
  for (const k of ["output", "text", "content", "response", "message"] as const) {
    const v = output[k];
    if (typeof v === "string" && v.trim()) {
      return [v.trim()];
    }
  }
  const result = output.result;
  if (typeof result === "string" && result.trim()) {
    return [result.trim()];
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (typeof r.text === "string" && r.text.trim()) {
      return [r.text.trim()];
    }
    if (typeof r.content === "string" && r.content.trim()) {
      return [r.content.trim()];
    }
  }
  return null;
}

/**
 * 插件有时只把 completion 写在 `opik_spans`（llm span）上，而 `opik_traces.output_json` 仍为 {}（例如 llm_output hook 未命中、仅 span patch 入库）。
 * 时间线只读 trace 行会丢助手气泡；此处用同 trace 下第一条 llm span 的 output 兜底。
 */
function mergeTraceOutputWithPrimaryLlmSpan(
  traceOutput: Record<string, unknown>,
  spanOutputJson: string | null | undefined,
): Record<string, unknown> {
  if (extractAssistantTextsFromOutputShape(traceOutput) != null) {
    return { ...traceOutput };
  }
  const spanOut = safeObject(spanOutputJson);
  if (Object.keys(spanOut).length === 0) {
    return { ...traceOutput };
  }
  const fromSpan = extractAssistantTextsFromOutputShape(spanOut);
  if (fromSpan == null || fromSpan.length === 0) {
    return { ...traceOutput };
  }
  return { ...traceOutput, assistantTexts: fromSpan };
}

/** True when usage object carries any token counter (incl. OpenClaw `input`/`output`). */
function usageHasTokenSignals(u: unknown): boolean {
  if (!u || typeof u !== "object" || Array.isArray(u)) {
    return false;
  }
  const o = u as Record<string, unknown>;
  for (const k of [
    "input",
    "output",
    "inputTokens",
    "outputTokens",
    "total_tokens",
    "totalTokens",
    "totalTokenCount",
    "prompt_tokens",
    "completion_tokens",
    "input_tokens",
    "output_tokens",
    "prompt_token_count",
    "completion_token_count",
    "candidatesTokenCount",
    "promptTokenCount",
    "inputTokenCount",
    "outputTokenCount",
  ]) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return true;
    }
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return true;
    }
  }
  const um = o.usageMetadata;
  if (um && typeof um === "object" && !Array.isArray(um)) {
    const m = um as Record<string, unknown>;
    for (const kk of ["totalTokenCount", "totalTokens", "promptTokenCount", "candidatesTokenCount"]) {
      const v = m[kk];
      if (typeof v === "number" && Number.isFinite(v)) {
        return true;
      }
    }
  }
  return false;
}

function pickContextWindowTokens(input: Record<string, unknown>, metadata: Record<string, unknown>): number | null {
  const tryNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.trunc(v);
    }
    return null;
  };
  const routing = input.openclaw_routing;
  if (routing && typeof routing === "object" && !Array.isArray(routing)) {
    const n = tryNum((routing as Record<string, unknown>).max_context_tokens);
    if (n != null) {
      return n;
    }
  }
  for (const k of [
    "max_context_tokens",
    "contextTokens",
    "context_tokens",
    "contextWindow",
    "context_window_tokens",
  ] as const) {
    const n = tryNum(metadata[k] ?? input[k]);
    if (n != null) {
      return n;
    }
  }
  return null;
}

function llmOutputPayload(
  output: Record<string, unknown>,
  metadata: Record<string, unknown>,
  spanUsage: Record<string, unknown> | null,
  spanModel: string | null,
  spanProvider: string | null,
  contextWindowTokens: number | null,
): Record<string, unknown> {
  const out = { ...output };
  if (Array.isArray(out.messages) && out.messages.length > 0) {
    const joined = transcriptJoinedFromAssistantAndToolMessages(out.messages as unknown[]);
    if (joined) {
      const atArr = Array.isArray(out.assistantTexts)
        ? out.assistantTexts.filter((x): x is string => typeof x === "string").map((s) => s.trim())
        : [];
      const atJoined = atArr.join("\n\n").trim();
      if (joined.length > atJoined.length || atJoined.length === 0) {
        out.assistantTexts = [joined];
      }
    }
  }
  const mdUsage = metadata.usage;
  if (mdUsage && typeof mdUsage === "object" && !Array.isArray(mdUsage) && usageHasTokenSignals(mdUsage)) {
    const base =
      out.usage && typeof out.usage === "object" && !Array.isArray(out.usage)
        ? (out.usage as Record<string, unknown>)
        : {};
    out.usage = { ...base, ...(mdUsage as Record<string, unknown>) };
  } else if (
    (out.usage == null || typeof out.usage !== "object" || Array.isArray(out.usage)) &&
    mdUsage &&
    typeof mdUsage === "object" &&
    !Array.isArray(mdUsage)
  ) {
    out.usage = { ...(mdUsage as Record<string, unknown>) };
  }
  if (spanUsage && usageHasTokenSignals(spanUsage) && !usageHasTokenSignals(out.usage)) {
    const base =
      out.usage && typeof out.usage === "object" && !Array.isArray(out.usage)
        ? (out.usage as Record<string, unknown>)
        : {};
    out.usage = { ...base, ...spanUsage };
  }
  const mdUsageMetadata = metadata.usageMetadata;
  if (
    (out.usageMetadata == null || typeof out.usageMetadata !== "object" || Array.isArray(out.usageMetadata)) &&
    mdUsageMetadata &&
    typeof mdUsageMetadata === "object" &&
    !Array.isArray(mdUsageMetadata)
  ) {
    out.usageMetadata = { ...(mdUsageMetadata as Record<string, unknown>) };
  }
  const extracted = extractAssistantTextsFromOutputShape(out);
  if (extracted != null) {
    const existing = out.assistantTexts;
    if (!Array.isArray(existing) || existing.length === 0) {
      out.assistantTexts = extracted;
    }
  }
  const prev = metadata.output_preview;
  if (
    typeof prev === "string" &&
    prev.trim() &&
    !isSyntheticNonLlmTraceKind(metadata.trace_kind)
  ) {
    const existing = out.assistantTexts;
    if (!Array.isArray(existing) || existing.length === 0) {
      out.assistantTexts = [prev.trim()];
    }
  }
  if (typeof output.output === "string" && output.output.trim()) {
    const existing = out.assistantTexts;
    if (!Array.isArray(existing) || existing.length === 0) {
      out.assistantTexts = [output.output.trim()];
    }
  }
  if (contextWindowTokens != null && contextWindowTokens > 0) {
    out.context_window_tokens = contextWindowTokens;
  }
  if (out.model == null && spanModel != null && spanModel.trim()) {
    out.model = spanModel.trim();
  }
  if (out.provider == null && spanProvider != null && spanProvider.trim()) {
    out.provider = spanProvider.trim();
  }
  return out;
}

/**
 * Synthesize OpenClaw-style timeline rows from `opik_traces` (no legacy `events` table).
 * One user turn per trace: `message_received` → `llm_input` → `llm_output`.
 */
export function queryThreadTraceEvents(db: Database.Database, threadKey: string): Record<string, unknown>[] {
  const key = threadKey.trim();
  if (!key) {
    return [];
  }

  // Prefer `opik_thread_turns` because some follow-up traces may not have a consistent `opik_traces.thread_id`.
  // Include:
  // - turns whose `thread_id` is this session (主会话);
  // - subagent turns stored under **子** `thread_id` but grafted via `anchor_parent_thread_id`（与 plugin / thread-turns-query 一致）。
  // 否则主会话 API 拿不到子 trace，`mergedTraceRootIds` 与「查看子代理会话」均无法工作。
  let rowsFromTurns: TraceRow[];
  try {
    rowsFromTurns = db
      .prepare(
        `SELECT ot.trace_id,
                ot.thread_id,
                ot.name,
                ot.input_json,
                ot.output_json,
                ot.metadata_json,
                ot.created_at_ms,
                ot.updated_at_ms,
                ot.ended_at_ms,
                ot.duration_ms
           FROM opik_thread_turns t
           JOIN opik_traces ot ON ot.trace_id = t.primary_trace_id
          WHERE t.thread_id = ? OR t.anchor_parent_thread_id = ?
          ORDER BY ot.created_at_ms ASC, ot.trace_id ASC`,
      )
      .all(key, key) as TraceRow[];
  } catch {
    rowsFromTurns = db
      .prepare(
        `SELECT ot.trace_id,
                ot.thread_id,
                ot.name,
                ot.input_json,
                ot.output_json,
                ot.metadata_json,
                ot.created_at_ms,
                ot.updated_at_ms,
                ot.ended_at_ms,
                ot.duration_ms
           FROM opik_thread_turns t
           JOIN opik_traces ot ON ot.trace_id = t.primary_trace_id
          WHERE t.thread_id = ?
          ORDER BY ot.created_at_ms ASC, ot.trace_id ASC`,
      )
      .all(key) as TraceRow[];
  }

  let rows: TraceRow[];
  if (rowsFromTurns.length > 0) {
    rows = rowsFromTurns;
  } else {
    // Back-compat fallback for older DBs that don't have `opik_thread_turns`.
    rows = db
      .prepare(
        `SELECT trace_id,
                thread_id,
                name,
                input_json,
                output_json,
                metadata_json,
              created_at_ms,
              updated_at_ms,
              ended_at_ms,
              duration_ms
         FROM opik_traces
         WHERE COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) = ?
         ORDER BY created_at_ms ASC, trace_id ASC`,
      )
      .all(key) as TraceRow[];
  }

  const events: Record<string, unknown>[] = [];
  let seq = 0;

  const selectPrimaryLlmSpanRow = db.prepare(
    `SELECT output_json, usage_json, model, provider FROM opik_spans
      WHERE trace_id = ? AND span_type = 'llm'
      ORDER BY COALESCE(sort_index, 999999) ASC, COALESCE(start_time_ms, 0) ASC
      LIMIT 1`,
  );

  for (const r of rows) {
    const traceId = String(r.trace_id ?? "").trim();
    if (!traceId) {
      continue;
    }
    const created = typeof r.created_at_ms === "number" && Number.isFinite(r.created_at_ms) ? r.created_at_ms : 0;
    const updated = typeof r.updated_at_ms === "number" && Number.isFinite(r.updated_at_ms) ? r.updated_at_ms : null;
    const ended = typeof r.ended_at_ms === "number" && Number.isFinite(r.ended_at_ms) ? r.ended_at_ms : null;
    const duration = typeof r.duration_ms === "number" && Number.isFinite(r.duration_ms) && r.duration_ms >= 0 ? r.duration_ms : null;
    const computedEnded =
      ended ?? (created > 0 && duration != null ? created + duration : null) ?? updated ?? (created > 0 ? created : null);
    const baseId = created + seq * 100;
    seq += 1;

    const input = safeObject(r.input_json);
    const spanRow = selectPrimaryLlmSpanRow.get(traceId) as {
      output_json: string | null;
      usage_json: string | null;
      model: string | null;
      provider: string | null;
    } | undefined;
    const output = mergeTraceOutputWithPrimaryLlmSpan(safeObject(r.output_json), spanRow?.output_json ?? null);
    const metadata = safeObject(r.metadata_json);
    const spanUsageRaw = safeObject(spanRow?.usage_json ?? null);
    const spanUsageForPayload = Object.keys(spanUsageRaw).length > 0 ? spanUsageRaw : null;
    const spanModel = typeof spanRow?.model === "string" && spanRow.model.trim() ? spanRow.model.trim() : null;
    const spanProvider = typeof spanRow?.provider === "string" && spanRow.provider.trim() ? spanRow.provider.trim() : null;
    const contextWindowTokens = pickContextWindowTokens(input, metadata);

    const agentName = agentNameFromMetadata(metadata);
    const chatTitle = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
    const startWhen =
      created > 0
        ? new Date(created).toISOString()
        : new Date().toISOString();
    const endWhen =
      computedEnded != null && computedEnded > 0
        ? new Date(computedEnded).toISOString()
        : startWhen;

    const runId =
      (typeof metadata.run_id === "string" && metadata.run_id.trim()) ||
      (typeof metadata.runId === "string" && metadata.runId.trim()) ||
      traceId;

    const msgId = extractMsgIdFromTrace(metadata, input);
    const asyncCommand = inferAsyncCommandTrace(metadata, chatTitle, input);
    const threadIdRow =
      typeof r.thread_id === "string" && r.thread_id.trim() ? r.thread_id.trim() : null;
    const runKindRow = runKindFromMetadata(metadata);

    events.push({
      id: baseId,
      event_id: `${traceId}:recv`,
      type: "message_received",
      trace_root_id: traceId,
      thread_id: threadIdRow,
      run_kind: runKindRow,
      agent_id: null,
      agent_name: agentName,
      chat_title: chatTitle,
      msg_id: msgId,
      async_command: asyncCommand,
      client_ts: startWhen,
      created_at: startWhen,
      started_at_ms: created || null,
      ended_at_ms: computedEnded,
      updated_at_ms: updated,
      duration_ms: duration,
      payload: userPayloadFromInput(input),
    });

    events.push({
      id: baseId + 1,
      event_id: `${traceId}:llm_in`,
      type: "llm_input",
      trace_root_id: traceId,
      thread_id: threadIdRow,
      run_kind: runKindRow,
      run_id: runId,
      agent_name: agentName,
      chat_title: chatTitle,
      msg_id: msgId,
      async_command: asyncCommand,
      client_ts: startWhen,
      created_at: startWhen,
      started_at_ms: created || null,
      ended_at_ms: computedEnded,
      updated_at_ms: updated,
      duration_ms: duration,
      payload: Object.keys(input).length > 0 ? { ...input, run_id: runId } : { prompt: "—", run_id: runId },
    });

    const llmOutPayload = llmOutputPayload(
      output,
      metadata,
      spanUsageForPayload,
      spanModel,
      spanProvider,
      contextWindowTokens,
    ) as Record<string, unknown>;
    const inModel = input.model;
    if (llmOutPayload.model == null && typeof inModel === "string" && inModel.trim()) {
      llmOutPayload.model = inModel.trim();
    }
    const inProvider = input.provider;
    if (llmOutPayload.provider == null && typeof inProvider === "string" && inProvider.trim()) {
      llmOutPayload.provider = inProvider.trim();
    }

    events.push({
      id: baseId + 2,
      event_id: `${traceId}:llm_out`,
      type: "llm_output",
      trace_root_id: traceId,
      thread_id: threadIdRow,
      run_kind: runKindRow,
      run_id: runId,
      agent_name: agentName,
      chat_title: chatTitle,
      msg_id: msgId,
      async_command: asyncCommand,
      client_ts: endWhen,
      created_at: endWhen,
      started_at_ms: created || null,
      ended_at_ms: computedEnded,
      updated_at_ms: updated,
      duration_ms: duration,
      payload: llmOutPayload,
    });
  }

  return events;
}
