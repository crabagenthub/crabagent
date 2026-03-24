import type Database from "better-sqlite3";
import { computeThreadKey } from "./thread-key.js";
import {
  buildSpanActionMetadata,
  ensureSyntheticAgentLoopSpan,
  extensionKindFromPayload,
  loopParentSpanId,
  type OpenClawSemanticSpanType,
  openClawSemanticSpanType,
  resolveSemanticParentId,
  shouldEnsureLoopForEvent,
} from "./observability-span-policy.js";

export type { OpenClawSemanticSpanType } from "./observability-span-policy.js";

const MAX_JSON_CHARS = 240_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function jsonBlob(v: unknown): string {
  try {
    const s = JSON.stringify(v ?? {});
    if (s.length <= MAX_JSON_CHARS) {
      return s;
    }
    return `${s.slice(0, MAX_JSON_CHARS)}…`;
  } catch {
    return "{}";
  }
}

function parseTimeMs(clientTs: string | null, fallback: number): number {
  if (!clientTs?.trim()) {
    return fallback;
  }
  const t = Date.parse(clientTs.trim());
  return Number.isFinite(t) ? t : fallback;
}

function pickStr(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function pickNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  return 0;
}

function mergeMetadata(existingJson: string, patch: Record<string, unknown>): string {
  let base: Record<string, unknown> = {};
  try {
    const p = JSON.parse(existingJson || "{}") as unknown;
    if (isPlainObject(p)) {
      base = { ...p };
    }
  } catch {
    base = {};
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null && v !== "") {
      base[k] = v;
    }
  }
  return jsonBlob(base);
}

/**
 * 商业/优化侧模块分桶（对应「LLM / TOOL / MEMORY / RAG」类统计）。
 * 与 `type`（执行形态：AGENT_LOOP / SKILL / PLUGIN / IO）正交。
 */
export type OpenClawSpanModule = "LLM" | "TOOL" | "MEMORY" | "RAG" | "OTHER";

/** 与 `spans.type`（语义动作）对齐后的计费分桶。 */
export function openclawSpanModuleForSemanticType(
  sem: OpenClawSemanticSpanType,
  eventType: string,
  payload: Record<string, unknown>,
): OpenClawSpanModule {
  if (sem === "LLM") {
    return "LLM";
  }
  if (sem === "MEMORY") {
    const tn = (pickStr(payload.toolName) ?? "").toLowerCase();
    if (/(vector|embed|rag|retriev|similarity)/.test(tn)) {
      return "RAG";
    }
    return "MEMORY";
  }
  if (sem === "IO" && eventType.trim().toLowerCase() === "message_received") {
    return "OTHER";
  }
  if (sem === "IO") {
    return "TOOL";
  }
  if (sem === "TOOL") {
    return "TOOL";
  }
  if (sem === "SKILL" || sem === "PLUGIN") {
    return "OTHER";
  }
  return "OTHER";
}

/** 具体工具名 / 插件 id / 模型名等，供统计与下钻。 */
export function openclawSpanDisplayName(eventType: string, payload: Record<string, unknown>): string {
  const t = eventType.trim().toLowerCase();
  if (t === "before_tool" || t === "after_tool") {
    return pickStr(payload.toolName) || "tool_call";
  }
  if (t === "hook_contribution") {
    const pid = pickStr(payload.pluginId) || "plugin";
    const sh = pickStr(payload.sourceHook);
    return sh ? `${pid}:${sh}` : pid;
  }
  if (t === "subagent_spawned" || t === "subagent_ended") {
    return (
      pickStr(payload.label) ||
      pickStr(payload.agentId) ||
      pickStr(payload.targetKind) ||
      pickStr(payload.targetSessionKey) ||
      eventType
    );
  }
  if (t === "llm_input") {
    return pickStr(payload.model) || "llm_input";
  }
  if (t === "llm_output") {
    return pickStr(payload.model) || "llm_output";
  }
  if (t === "message_received") {
    return pickStr(payload.from) || "inbound_message";
  }
  if (t === "context_prune_applied") {
    return pickStr(payload.mode) || "context_prune";
  }
  if (t === "agent_end") {
    return "agent_end";
  }
  return eventType.length > 56 ? `${eventType.slice(0, 53)}…` : eventType;
}

const PROMPT_CAP = 120_000;
const CONTENT_CAP = 32_000;

function buildSemanticInputOutput(
  eventType: string,
  payload: Record<string, unknown>,
): { input: string; output: string } {
  const t = eventType.trim().toLowerCase();

  if (t === "message_received") {
    const content = payload.content;
    const text =
      typeof content === "string"
        ? content.length > CONTENT_CAP
          ? `${content.slice(0, CONTENT_CAP)}…`
          : content
        : content;
    return {
      input: jsonBlob({
        from: payload.from,
        channel: payload.channel,
        content: text,
        metadata: payload.metadata,
      }),
      output: "{}",
    };
  }

  if (t === "before_tool") {
    return {
      input: jsonBlob({
        toolName: payload.toolName,
        toolCallId: payload.toolCallId,
        params: payload.params,
        path: payload.path ?? payload.filePath ?? payload.file_path,
        query: payload.query ?? payload.embedding_query ?? payload.searchQuery,
      }),
      output: "{}",
    };
  }

  if (t === "after_tool") {
    const rawResult = payload.result ?? payload.resultForLlm;
    let resultSummary: string | undefined;
    if (typeof rawResult === "string") {
      resultSummary =
        rawResult.length > 8000 ? `${rawResult.slice(0, 8000)}…` : rawResult;
    }
    return {
      input: jsonBlob({
        toolName: payload.toolName,
        toolCallId: payload.toolCallId,
        path: payload.path ?? payload.filePath,
        query: payload.query,
      }),
      output: jsonBlob({
        result: payload.result,
        resultForLlm: payload.resultForLlm,
        result_summary: resultSummary,
        top_k: payload.topK ?? payload.top_k,
        error: payload.error,
        durationMs: payload.durationMs,
        retryCount: payload.retryCount,
      }),
    };
  }

  if (t === "hook_contribution") {
    return {
      input: jsonBlob({
        sourceHook: payload.sourceHook,
        pluginId: payload.pluginId,
        toolName: payload.toolName,
        contribution: payload.contribution,
      }),
      output: "{}",
    };
  }

  if (t === "llm_input") {
    const prompt = payload.prompt;
    const p =
      typeof prompt === "string" && prompt.length > PROMPT_CAP
        ? `${prompt.slice(0, PROMPT_CAP)}…`
        : prompt;
    return {
      input: jsonBlob({
        event_hook: "llm_input",
        runId: payload.run_id ?? payload.runId,
        model: payload.model,
        provider: payload.provider,
        prompt: p,
        systemPrompt: payload.systemPrompt ?? payload.system_prompt,
        imagesCount: payload.imagesCount,
        historyMessageCount: Array.isArray(payload.historyMessages) ? payload.historyMessages.length : undefined,
      }),
      output: "{}",
    };
  }

  if (t === "llm_output") {
    return {
      input: jsonBlob({
        event_hook: "llm_output",
        runId: payload.run_id ?? payload.runId,
        model: payload.model,
        provider: payload.provider,
      }),
      output: jsonBlob({
        assistantTexts: payload.assistantTexts,
        usage: payload.usage,
      }),
    };
  }

  if (t === "context_prune_applied") {
    return {
      input: jsonBlob({
        embedding_query: payload.embedding_query ?? payload.query,
        mode: payload.mode,
        estimatedCharsBefore: payload.estimatedCharsBefore,
        estimatedCharsAfter: payload.estimatedCharsAfter,
        messageCountBefore: payload.messageCountBefore,
        messageCountAfter: payload.messageCountAfter,
        messageChanges: payload.messageChanges,
      }),
      output: "{}",
    };
  }

  if (t === "subagent_spawned" || t === "subagent_ended") {
    return {
      input: jsonBlob({
        runId: payload.runId,
        childSessionKey: payload.childSessionKey,
        targetSessionKey: payload.targetSessionKey,
        agentId: payload.agentId,
        label: payload.label,
        reason: payload.reason,
        mode: payload.mode,
      }),
      output: jsonBlob({
        outcome: payload.outcome,
        targetKind: payload.targetKind,
      }),
    };
  }

  if (t === "agent_end") {
    return {
      input: jsonBlob({
        success: payload.success,
        durationMs: payload.durationMs,
      }),
      output: jsonBlob({
        error: payload.error,
        messageCount: Array.isArray(payload.messages) ? payload.messages.length : payload.messages,
      }),
    };
  }

  return {
    input: jsonBlob({
      event_type: eventType,
      run_id: payload.run_id ?? payload.runId,
      msg_id: payload.msg_id ?? payload.msgId,
      toolName: payload.toolName,
    }),
    output: "{}",
  };
}

function usageFromPayload(payload: Record<string, unknown>): {
  prompt: number;
  completion: number;
  model: string | null;
} {
  const u = payload.usage;
  let prompt = 0;
  let completion = 0;
  if (isPlainObject(u)) {
    prompt =
      pickNum(u.prompt_tokens) ||
      pickNum(u.promptTokens) ||
      pickNum(u.input_tokens) ||
      pickNum(u.inputTokens);
    completion =
      pickNum(u.completion_tokens) ||
      pickNum(u.completionTokens) ||
      pickNum(u.output_tokens) ||
      pickNum(u.outputTokens);
  }
  const crab = payload.crabagent;
  if (isPlainObject(crab)) {
    const layers = crab.layers;
    if (isPlainObject(layers)) {
      const reasoning = layers.reasoning;
      if (isPlainObject(reasoning)) {
        const tm = reasoning.tokenMetrics;
        if (isPlainObject(tm)) {
          if (!prompt) {
            prompt =
              pickNum(tm.prompt_tokens) ||
              pickNum(tm.promptTokens) ||
              pickNum(tm.input_tokens) ||
              pickNum(tm.inputTokens);
          }
          if (!completion) {
            completion =
              pickNum(tm.completion_tokens) ||
              pickNum(tm.completionTokens) ||
              pickNum(tm.output_tokens) ||
              pickNum(tm.outputTokens);
          }
        }
      }
    }
  }
  let model: string | null = pickStr(payload.model) || pickStr(payload.modelName);
  if (!model && isPlainObject(payload.crabagent)) {
    const layers = payload.crabagent.layers;
    if (isPlainObject(layers)) {
      const reasoning = layers.reasoning;
      if (isPlainObject(reasoning)) {
        model = pickStr(reasoning.model);
      }
    }
  }
  return { prompt, completion, model };
}

function systemPromptFromPayload(payload: Record<string, unknown>): string | null {
  const a = pickStr(payload.systemPrompt) || pickStr(payload.system_prompt);
  if (a) {
    return a.length > MAX_JSON_CHARS ? `${a.slice(0, MAX_JSON_CHARS)}…` : a;
  }
  return null;
}

function contextFieldsFromPayload(payload: Record<string, unknown>): { full: string | null; sent: string | null } {
  const prompt = pickStr(payload.prompt);
  const pbp = pickStr(payload.promptBeforeHookPrepend);
  const sent =
    prompt && pbp
      ? `${pbp}\n---\n${prompt}`.length > MAX_JSON_CHARS
        ? `${(pbp + "\n---\n" + prompt).slice(0, MAX_JSON_CHARS)}…`
        : `${pbp}\n---\n${prompt}`
      : prompt || pbp;
  const hist = payload.historyMessages;
  let full: string | null = null;
  if (Array.isArray(hist) || (hist && typeof hist === "object")) {
    const blob = jsonBlob({ historyMessages: hist, prompt: prompt ?? undefined });
    full = blob.length > MAX_JSON_CHARS ? `${blob.slice(0, MAX_JSON_CHARS)}…` : blob;
  } else if (sent) {
    full = sent;
  }
  return {
    full: full && full.length > MAX_JSON_CHARS ? `${full.slice(0, MAX_JSON_CHARS)}…` : full,
    sent: sent && sent.length > MAX_JSON_CHARS ? `${sent.slice(0, MAX_JSON_CHARS)}…` : sent,
  };
}

function agentEndStatus(payload: Record<string, unknown>): "SUCCESS" | "ERROR" | null {
  if (payload.success === false) {
    return "ERROR";
  }
  if (payload.success === true) {
    return "SUCCESS";
  }
  return null;
}

function pruneSavedTokensEstimate(payload: Record<string, unknown>): number {
  const before = payload.estimatedCharsBefore;
  const after = payload.estimatedCharsAfter;
  if (typeof before === "number" && typeof after === "number" && Number.isFinite(before) && Number.isFinite(after)) {
    const savedChars = Math.max(0, before - after);
    return Math.max(0, Math.floor(savedChars / 4));
  }
  const changes = payload.messageChanges;
  if (!Array.isArray(changes)) {
    return 0;
  }
  let savedChars = 0;
  for (const c of changes) {
    if (!isPlainObject(c)) {
      continue;
    }
    const delta = c.charDelta;
    if (typeof delta === "number" && Number.isFinite(delta) && delta < 0) {
      savedChars += -delta;
    }
  }
  return Math.max(0, Math.floor(savedChars / 4));
}

function mergeTraceStatus(current: string, incoming: string): string {
  if (current === "ERROR" || incoming === "ERROR") {
    return "ERROR";
  }
  if (incoming === "SUCCESS") {
    return "SUCCESS";
  }
  if (current === "SUCCESS") {
    return "SUCCESS";
  }
  return current || incoming || "RUNNING";
}

/**
 * After a new row is inserted into `events`, mirror into traces / spans / generations / optimizations.
 * Requires `trace_root_id` (used as business `trace_id`).
 */
export function applyObservabilityFromIngestedEvent(db: Database.Database, row: {
  event_id: string;
  trace_root_id: string | null;
  session_id: string | null;
  session_key: string | null;
  agent_id: string | null;
  agent_name: string | null;
  chat_title: string | null;
  run_id: string | null;
  msg_id: string | null;
  channel: string | null;
  type: string;
  payload: Record<string, unknown>;
  client_ts: string | null;
}): void {
  const traceId = row.trace_root_id?.trim();
  if (!traceId) {
    return;
  }

  const now = Date.now();
  const eventMs = parseTimeMs(row.client_ts, now);
  const sessionId = row.session_id?.trim() || row.session_key?.trim() || "";
  const userId =
    pickStr(row.payload.user_id) ||
    pickStr(row.payload.userId) ||
    pickStr((row.payload.metadata as Record<string, unknown> | undefined)?.user_id) ||
    "";

  const threadKey = computeThreadKey({
    session_key: row.session_key,
    session_id: row.session_id,
    trace_root_id: traceId,
  });

  const metaPatch: Record<string, unknown> = {
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    chat_title: row.chat_title,
    channel: row.channel,
    msg_id: row.msg_id,
    run_id: row.run_id,
    ...(threadKey ? { thread_key: threadKey } : {}),
  };

  const endStatus = row.type === "agent_end" ? agentEndStatus(row.payload) : null;

  const existing = db
    .prepare(`SELECT start_time, end_time, status, total_tokens, metadata FROM traces WHERE trace_id = ?`)
    .get(traceId) as
    | {
        start_time: number;
        end_time: number | null;
        status: string;
        total_tokens: number;
        metadata: string;
      }
    | undefined;

  const startTime = existing ? Math.min(existing.start_time, eventMs) : eventMs;
  const endTime = existing
    ? Math.max(existing.end_time ?? existing.start_time, eventMs)
    : eventMs;
  const nextStatus = endStatus
    ? mergeTraceStatus(existing?.status ?? "RUNNING", endStatus)
    : (existing?.status ?? "RUNNING");
  const metaJson = mergeMetadata(existing?.metadata ?? "{}", metaPatch);

  const usage = row.type === "llm_output" ? usageFromPayload(row.payload) : { prompt: 0, completion: 0, model: null };
  const tokenDelta = usage.prompt + usage.completion;

  if (!existing) {
    db.prepare(
      `INSERT INTO traces (trace_id, session_id, user_id, start_time, end_time, status, total_tokens, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(traceId, sessionId || null, userId || null, startTime, endTime, nextStatus, tokenDelta, metaJson);
  } else {
    const newTotal = existing.total_tokens + tokenDelta;
    db.prepare(
      `UPDATE traces SET session_id = COALESCE(NULLIF(?, ''), session_id),
            user_id = COALESCE(NULLIF(?, ''), user_id),
            start_time = ?,
            end_time = ?,
            status = ?,
            total_tokens = ?,
            metadata = ?,
            updated_at = datetime('now')
       WHERE trace_id = ?`,
    ).run(
      sessionId,
      userId,
      startTime,
      endTime,
      nextStatus,
      newTotal,
      metaJson,
      traceId,
    );
  }

  const loopId = loopParentSpanId(traceId, row.msg_id, row.run_id);
  if (loopId && shouldEnsureLoopForEvent(row.type)) {
    ensureSyntheticAgentLoopSpan({ db, traceId, loopSpanId: loopId, eventMs });
  }

  const semType = openClawSemanticSpanType(row.type, row.payload);
  const spanModule = openclawSpanModuleForSemanticType(semType, row.type, row.payload);
  const spanName = openclawSpanDisplayName(row.type, row.payload);
  const parentId = resolveSemanticParentId({
    db,
    traceId,
    eventType: row.type,
    eventId: row.event_id,
    eventMs,
    payload: row.payload,
    loopSpanId: loopId,
  });
  const { input: inputJson, output: outputJson } = buildSemanticInputOutput(row.type, row.payload);
  const spanMetaJson = buildSpanActionMetadata({
    eventType: row.type,
    payload: row.payload,
    extensionKind:
      row.type.trim().toLowerCase() === "hook_contribution"
        ? extensionKindFromPayload(row.payload)
        : undefined,
  });

  const toolErr = row.type === "after_tool" ? pickStr(row.payload.error) : null;
  const errText =
    row.type === "agent_end" && row.payload.success === false
      ? pickStr(row.payload.error) || "agent_end failed"
      : toolErr;

  db.prepare(
    `INSERT INTO spans (span_id, trace_id, parent_id, module, type, name, input, output, start_time, end_time, error, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(span_id) DO UPDATE SET
       trace_id = excluded.trace_id,
       parent_id = COALESCE(excluded.parent_id, spans.parent_id),
       module = excluded.module,
       type = excluded.type,
       name = excluded.name,
       input = excluded.input,
       output = excluded.output,
       start_time = MIN(spans.start_time, excluded.start_time),
       end_time = MAX(COALESCE(spans.end_time, spans.start_time), COALESCE(excluded.end_time, excluded.start_time)),
       error = COALESCE(excluded.error, spans.error),
       metadata = excluded.metadata`,
  ).run(
    row.event_id,
    traceId,
    parentId,
    spanModule,
    semType,
    spanName,
    inputJson,
    outputJson,
    eventMs,
    eventMs,
    errText,
    spanMetaJson,
  );

  if (row.type === "llm_output" && (usage.prompt > 0 || usage.completion > 0 || usage.model)) {
    const ctx = contextFieldsFromPayload(row.payload);
    const sys = systemPromptFromPayload(row.payload);
    db.prepare(
      `INSERT INTO generations (span_id, model_name, prompt_tokens, completion_tokens, system_prompt, context_full, context_sent)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(span_id) DO UPDATE SET
         model_name = COALESCE(excluded.model_name, generations.model_name),
         prompt_tokens = MAX(generations.prompt_tokens, excluded.prompt_tokens),
         completion_tokens = MAX(generations.completion_tokens, excluded.completion_tokens),
         system_prompt = COALESCE(excluded.system_prompt, generations.system_prompt),
         context_full = COALESCE(excluded.context_full, generations.context_full),
         context_sent = COALESCE(excluded.context_sent, generations.context_sent)`,
    ).run(
      row.event_id,
      usage.model,
      usage.prompt,
      usage.completion,
      sys,
      ctx.full,
      ctx.sent,
    );
  }

  if (row.type === "context_prune_applied") {
    const saved = pruneSavedTokensEstimate(row.payload);
    if (saved > 0) {
      const optId = `opt:${row.event_id}`;
      db.prepare(
        `INSERT INTO optimizations (opt_id, span_id, saved_tokens, strategy, cost_saved)
         VALUES (?, ?, ?, 'PRUNING', 0)
         ON CONFLICT(opt_id) DO UPDATE SET
           saved_tokens = MAX(optimizations.saved_tokens, excluded.saved_tokens)`,
      ).run(optId, row.event_id, saved);
    }
  }
}
