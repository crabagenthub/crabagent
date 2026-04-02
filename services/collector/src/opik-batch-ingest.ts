import type Database from "better-sqlite3";
import { normalizeOpikSpanInputForStorage, normalizeOpikTraceInputForStorage } from "./strip-leading-bracket-date.js";
import { upsertThreadTurnFromTraceMetadata } from "./thread-turns-ingest.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBoolInt(v: unknown): number | null {
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  if (v === 1 || v === 0) {
    return v;
  }
  return null;
}

function jsonCol(v: unknown): string | null {
  if (v === undefined || v === null) {
    return null;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || String(raw).trim() === "") {
    return {};
  }
  try {
    const v = JSON.parse(String(raw)) as unknown;
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

/** True when `usage`-shaped object has any token counter the SQL layer would read. */
function usageHasTokenSignals(u: unknown): boolean {
  if (!isRecord(u)) {
    return false;
  }
  for (const k of [
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
    const v = u[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return true;
    }
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return true;
    }
  }
  const um = u.usageMetadata;
  if (isRecord(um)) {
    for (const k of ["totalTokenCount", "totalTokens", "promptTokenCount", "candidatesTokenCount"]) {
      const v = um[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * On trace upsert, keep prior `usage` / `total_tokens` when the incoming payload would drop them
 * (e.g. 合并批次里只有精简 metadata)，避免会话 total_tokens SQL 永远为 0。
 */
function mergeTraceMetadataForUpsert(incoming: unknown, previousJson: string | null): unknown {
  const prev = parseJsonRecord(previousJson);
  if (!isRecord(incoming)) {
    return Object.keys(prev).length > 0 ? prev : incoming;
  }
  const merged: Record<string, unknown> = { ...prev, ...incoming };
  const inUsage = incoming.usage;
  const prevUsage = prev.usage;
  if (usageHasTokenSignals(prevUsage) && !usageHasTokenSignals(inUsage)) {
    merged.usage = prevUsage;
  }
  if (
    (incoming.total_tokens === undefined || incoming.total_tokens === null) &&
    prev.total_tokens !== undefined &&
    prev.total_tokens !== null
  ) {
    merged.total_tokens = prev.total_tokens;
  }
  return merged;
}

function usageNumericFields(u: Record<string, unknown>): {
  prompt: number;
  completion: number;
  explicitTotal: number | null;
} {
  const um = isRecord(u.usageMetadata) ? (u.usageMetadata as Record<string, unknown>) : undefined;
  const first = (obj: Record<string, unknown>, keys: string[]): number | null => {
    for (const k of keys) {
      const n = asNum(obj[k]);
      if (n !== null) {
        return n;
      }
    }
    return null;
  };
  const pt =
    first(u, [
      "prompt_tokens",
      "promptTokens",
      "input_tokens",
      "inputTokens",
      "prompt_token_count",
      "promptTokenCount",
      "inputTokenCount",
    ]) ?? (um ? first(um, ["promptTokenCount", "inputTokenCount"]) : null);
  const ct =
    first(u, [
      "completion_tokens",
      "completionTokens",
      "output_tokens",
      "outputTokens",
      "completion_token_count",
      "candidatesTokenCount",
      "outputTokenCount",
    ]) ?? (um ? first(um, ["candidatesTokenCount", "outputTokenCount"]) : null);
  const tt =
    first(u, ["total_tokens", "totalTokens", "totalTokenCount"]) ??
    (um ? first(um, ["totalTokenCount", "totalTokens"]) : null);
  return {
    prompt: pt ?? 0,
    completion: ct ?? 0,
    explicitTotal: tt,
  };
}

/** Sum token fields across LLM span `usage_json` rows (one trace may have multiple llm spans). */
function aggregateLlmSpanUsageRecords(usages: Record<string, unknown>[]): Record<string, unknown> | null {
  let sumP = 0;
  let sumC = 0;
  let sumT = 0;
  let nWithExplicitT = 0;
  let any = false;
  for (const u of usages) {
    if (!usageHasTokenSignals(u)) {
      continue;
    }
    any = true;
    const { prompt, completion, explicitTotal } = usageNumericFields(u);
    sumP += prompt;
    sumC += completion;
    if (explicitTotal != null) {
      sumT += explicitTotal;
      nWithExplicitT += 1;
    }
  }
  if (!any) {
    return null;
  }
  let total: number;
  if (sumP > 0 || sumC > 0) {
    total = sumP + sumC;
  } else if (nWithExplicitT > 0) {
    total = sumT;
  } else {
    return null;
  }
  return {
    prompt_tokens: sumP,
    completion_tokens: sumC,
    total_tokens: total,
  };
}

/**
 * After spans are upserted: copy aggregated LLM `usage_json` into `opik_traces.metadata_json`
 * so observability and raw metadata both expose token counts (plugin trace row may omit them).
 */
function backfillTraceMetadataUsageFromLlmSpans(
  db: Database.Database,
  traceIds: Set<string>,
  selectTraceMetadata: Database.Statement,
): void {
  if (traceIds.size === 0) {
    return;
  }
  const selectUsages = db.prepare(
    `SELECT usage_json FROM opik_spans WHERE trace_id = ? AND span_type = 'llm'`,
  );
  const updateMeta = db.prepare(`UPDATE opik_traces SET metadata_json = ? WHERE trace_id = ?`);

  for (const traceId of traceIds) {
    const rows = selectUsages.all(traceId) as { usage_json: string | null }[];
    const parsed: Record<string, unknown>[] = [];
    for (const r of rows) {
      const u = parseJsonRecord(r.usage_json);
      if (usageHasTokenSignals(u)) {
        parsed.push(u);
      }
    }
    const agg = aggregateLlmSpanUsageRecords(parsed);
    if (!agg || !usageHasTokenSignals(agg)) {
      continue;
    }
    const prevRow = selectTraceMetadata.get(traceId) as { metadata_json: string | null } | undefined;
    const prev = parseJsonRecord(prevRow?.metadata_json);
    const merged: Record<string, unknown> = { ...prev, usage: agg };
    const tt = asNum(agg.total_tokens);
    if (tt !== null) {
      merged.total_tokens = tt;
    }
    const payload = jsonCol(merged);
    if (payload === null) {
      continue;
    }
    updateMeta.run(payload, traceId);
  }
}

export type OpikBatchBody = {
  threads?: unknown[];
  traces?: unknown[];
  spans?: unknown[];
  attachments?: unknown[];
  feedback?: unknown[];
  /** 可选：整包原文对账 */
  envelope_json?: unknown;
};

export type OpikBatchResult = {
  accepted: {
    threads: number;
    traces: number;
    spans: number;
    attachments: number;
    feedback: number;
    raw: number;
  };
  skipped: { reason: string; at: string }[];
};

const DEFAULT_WORKSPACE = "default";
const DEFAULT_PROJECT = "openclaw";

export function applyOpikBatch(db: Database.Database, body: unknown): OpikBatchResult {
  const skipped: OpikBatchResult["skipped"] = [];
  const acc = { threads: 0, traces: 0, spans: 0, attachments: 0, feedback: 0, raw: 0 };

  if (!isRecord(body)) {
    skipped.push({ reason: "expected_object", at: "body" });
    return { accepted: acc, skipped };
  }

  const envelope = body as OpikBatchBody;
  const now = Date.now();

  if (envelope.envelope_json !== undefined) {
    try {
      db.prepare(
        `INSERT INTO opik_raw_ingest (received_at_ms, route, trace_id, span_id, body_json)
         VALUES (?, 'batch', NULL, NULL, ?)`,
      ).run(now, jsonCol(envelope.envelope_json) ?? "{}");
      acc.raw += 1;
    } catch (e) {
      skipped.push({ reason: String(e), at: "raw" });
    }
  }

  const upsertThread = db.prepare(`
    INSERT INTO opik_threads (thread_id, workspace_name, project_name, first_seen_ms, last_seen_ms, metadata_json, agent_name, channel_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, workspace_name, project_name) DO UPDATE SET
      last_seen_ms = MAX(opik_threads.last_seen_ms, excluded.last_seen_ms),
      first_seen_ms = MIN(opik_threads.first_seen_ms, excluded.first_seen_ms),
      metadata_json = COALESCE(excluded.metadata_json, opik_threads.metadata_json),
      agent_name = COALESCE(NULLIF(TRIM(excluded.agent_name), ''), opik_threads.agent_name),
      channel_name = COALESCE(NULLIF(TRIM(excluded.channel_name), ''), opik_threads.channel_name)
  `);

  for (let i = 0; i < (envelope.threads ?? []).length; i++) {
    const row = envelope.threads![i];
    if (!isRecord(row)) {
      skipped.push({ reason: "not_object", at: `threads[${i}]` });
      continue;
    }
    const threadId = asStr(row.thread_id);
    if (!threadId) {
      skipped.push({ reason: "missing_thread_id", at: `threads[${i}]` });
      continue;
    }
    const ws = asStr(row.workspace_name) ?? DEFAULT_WORKSPACE;
    const proj = asStr(row.project_name) ?? DEFAULT_PROJECT;
    const firstMs = asNum(row.first_seen_ms) ?? now;
    const lastMs = asNum(row.last_seen_ms) ?? now;
    const agentName = asStr(row.agent_name ?? row.agentName);
    const channelName = asStr(row.channel_name ?? row.channelName);
    try {
      upsertThread.run(threadId, ws, proj, firstMs, lastMs, jsonCol(row.metadata), agentName, channelName);
      acc.threads += 1;
    } catch (e) {
      skipped.push({ reason: String(e), at: `threads[${i}]` });
    }
  }

  const upsertTrace = db.prepare(`
    INSERT INTO opik_traces (
      trace_id, thread_id, workspace_name, project_name, name,
      tags_json, input_json, output_json, metadata_json, error_info_json,
      success, duration_ms, total_cost, created_at_ms, updated_at_ms, ended_at_ms,
      is_complete, created_from
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trace_id) DO UPDATE SET
      thread_id = COALESCE(excluded.thread_id, opik_traces.thread_id),
      workspace_name = excluded.workspace_name,
      project_name = excluded.project_name,
      name = COALESCE(excluded.name, opik_traces.name),
      tags_json = COALESCE(excluded.tags_json, opik_traces.tags_json),
      input_json = COALESCE(excluded.input_json, opik_traces.input_json),
      output_json = COALESCE(excluded.output_json, opik_traces.output_json),
      metadata_json = COALESCE(excluded.metadata_json, opik_traces.metadata_json),
      error_info_json = COALESCE(excluded.error_info_json, opik_traces.error_info_json),
      success = COALESCE(excluded.success, opik_traces.success),
      duration_ms = COALESCE(excluded.duration_ms, opik_traces.duration_ms),
      total_cost = COALESCE(excluded.total_cost, opik_traces.total_cost),
      updated_at_ms = COALESCE(excluded.updated_at_ms, opik_traces.updated_at_ms),
      ended_at_ms = COALESCE(excluded.ended_at_ms, opik_traces.ended_at_ms),
      is_complete = MAX(excluded.is_complete, opik_traces.is_complete),
      created_from = COALESCE(excluded.created_from, opik_traces.created_from)
  `);

  const selectTraceMetadata = db.prepare("SELECT metadata_json FROM opik_traces WHERE trace_id = ?");

  for (let i = 0; i < (envelope.traces ?? []).length; i++) {
    const row = envelope.traces![i];
    if (!isRecord(row)) {
      skipped.push({ reason: "not_object", at: `traces[${i}]` });
      continue;
    }
    const traceId = asStr(row.trace_id ?? row.id);
    if (!traceId) {
      skipped.push({ reason: "missing_trace_id", at: `traces[${i}]` });
      continue;
    }
    const ws = asStr(row.workspace_name) ?? DEFAULT_WORKSPACE;
    const proj = asStr(row.project_name) ?? DEFAULT_PROJECT;
    const createdMs = asNum(row.created_at_ms) ?? now;
    const th = asStr(row.thread_id);
    if (th) {
      try {
        upsertThread.run(th, ws, proj, createdMs, createdMs, null, null, null);
      } catch {
        /* ignore — trace upsert may still fail if FK misconfigured */
      }
    }
    const prevMetaRow = selectTraceMetadata.get(traceId) as { metadata_json: string | null } | undefined;
    const mergedMetadata = mergeTraceMetadataForUpsert(row.metadata, prevMetaRow?.metadata_json ?? null);
    try {
      upsertTrace.run(
        traceId,
        asStr(row.thread_id),
        ws,
        proj,
        asStr(row.name),
        jsonCol(row.tags),
        jsonCol(normalizeOpikTraceInputForStorage(row.input)),
        jsonCol(row.output),
        jsonCol(mergedMetadata),
        jsonCol(row.error_info ?? row.errorInfo),
        asBoolInt(row.success),
        asNum(row.duration_ms ?? row.durationMs),
        asNum(row.total_cost ?? row.totalCost),
        createdMs,
        asNum(row.updated_at_ms ?? row.updatedAtMs),
        asNum(row.ended_at_ms ?? row.end_time_ms ?? row.endTimeMs),
        asBoolInt(row.is_complete ?? row.isComplete) ?? 0,
        asStr(row.created_from) ?? "opik-openclaw",
      );
      acc.traces += 1;
      try {
        const inputNorm = normalizeOpikTraceInputForStorage(row.input);
        const previewFromInput = (() => {
          if (!inputNorm || typeof inputNorm !== "object" || Array.isArray(inputNorm)) {
            return null;
          }
          const p = inputNorm as Record<string, unknown>;
          const listPreview = asStr(p.list_input_preview) ?? asStr((p as Record<string, unknown>).listInputPreview);
          if (listPreview) {
            return listPreview.slice(0, 500);
          }
          const prompt = asStr(p.prompt);
          if (prompt) {
            return prompt.slice(0, 500);
          }
          const ut = p.user_turn;
          if (ut && typeof ut === "object" && !Array.isArray(ut)) {
            const mr = (ut as Record<string, unknown>).message_received;
            if (mr && typeof mr === "object" && !Array.isArray(mr)) {
              const c = (mr as Record<string, unknown>).content;
              if (typeof c === "string" && c.trim()) {
                return c.trim().slice(0, 500);
              }
            }
          }
          return null;
        })();

        const preview = previewFromInput ?? asStr(row.name)?.slice(0, 500) ?? null;
        upsertThreadTurnFromTraceMetadata(db, {
          traceId,
          threadId: th,
          workspaceName: ws,
          projectName: proj,
          metadata: mergedMetadata,
          createdAtMs: createdMs,
          previewText: preview,
        });
      } catch {
        /* ignore turn upsert errors — trace already stored */
      }
    } catch (e) {
      skipped.push({ reason: String(e), at: `traces[${i}]` });
    }
  }

  const upsertSpan = db.prepare(`
    INSERT INTO opik_spans (
      span_id, trace_id, parent_span_id, name, span_type,
      start_time_ms, end_time_ms, duration_ms,
      metadata_json, input_json, output_json, tags_json,
      usage_json, model, provider, error_info_json, total_cost,
      sort_index, is_complete
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(span_id) DO UPDATE SET
      trace_id = excluded.trace_id,
      parent_span_id = COALESCE(excluded.parent_span_id, opik_spans.parent_span_id),
      name = COALESCE(excluded.name, opik_spans.name),
      span_type = COALESCE(excluded.span_type, opik_spans.span_type),
      start_time_ms = COALESCE(excluded.start_time_ms, opik_spans.start_time_ms),
      end_time_ms = COALESCE(excluded.end_time_ms, opik_spans.end_time_ms),
      duration_ms = COALESCE(excluded.duration_ms, opik_spans.duration_ms),
      metadata_json = COALESCE(excluded.metadata_json, opik_spans.metadata_json),
      input_json = COALESCE(excluded.input_json, opik_spans.input_json),
      output_json = COALESCE(excluded.output_json, opik_spans.output_json),
      tags_json = COALESCE(excluded.tags_json, opik_spans.tags_json),
      usage_json = COALESCE(excluded.usage_json, opik_spans.usage_json),
      model = COALESCE(excluded.model, opik_spans.model),
      provider = COALESCE(excluded.provider, opik_spans.provider),
      error_info_json = COALESCE(excluded.error_info_json, opik_spans.error_info_json),
      total_cost = COALESCE(excluded.total_cost, opik_spans.total_cost),
      sort_index = COALESCE(excluded.sort_index, opik_spans.sort_index),
      is_complete = MAX(excluded.is_complete, opik_spans.is_complete)
  `);

  const traceIdsWithLlmSpan = new Set<string>();

  for (let i = 0; i < (envelope.spans ?? []).length; i++) {
    const row = envelope.spans![i];
    if (!isRecord(row)) {
      skipped.push({ reason: "not_object", at: `spans[${i}]` });
      continue;
    }
    const spanId = asStr(row.span_id ?? row.id);
    const traceId = asStr(row.trace_id);
    if (!spanId || !traceId) {
      skipped.push({ reason: "missing_span_or_trace_id", at: `spans[${i}]` });
      continue;
    }
    const spanTypeRaw = asStr(row.type ?? row.span_type);
    const spanType =
      spanTypeRaw && ["general", "tool", "llm", "guardrail"].includes(spanTypeRaw) ? spanTypeRaw : "general";
    if (spanType === "llm") {
      traceIdsWithLlmSpan.add(traceId);
    }
    try {
      upsertSpan.run(
        spanId,
        traceId,
        asStr(row.parent_span_id ?? row.parentSpanId),
        asStr(row.name) ?? "(unnamed)",
        spanType,
        asNum(row.start_time_ms ?? row.startTimeMs),
        asNum(row.end_time_ms ?? row.endTimeMs),
        asNum(row.duration_ms ?? row.durationMs),
        jsonCol(row.metadata),
        jsonCol(normalizeOpikSpanInputForStorage(row.input)),
        jsonCol(row.output),
        jsonCol(row.tags),
        jsonCol(row.usage),
        asStr(row.model),
        asStr(row.provider),
        jsonCol(row.error_info ?? row.errorInfo),
        asNum(row.total_cost ?? row.totalCost),
        asNum(row.sort_index ?? row.sortIndex),
        asBoolInt(row.is_complete ?? row.isComplete) ?? 0,
      );
      acc.spans += 1;
    } catch (e) {
      skipped.push({ reason: String(e), at: `spans[${i}]` });
    }
  }

  backfillTraceMetadataUsageFromLlmSpans(db, traceIdsWithLlmSpan, selectTraceMetadata);

  const insertAttachment = db.prepare(`
    INSERT INTO opik_attachments (
      attachment_id, trace_id, span_id, entity_type,
      content_type, file_name, url, payload_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(attachment_id) DO UPDATE SET
      trace_id = COALESCE(excluded.trace_id, opik_attachments.trace_id),
      span_id = COALESCE(excluded.span_id, opik_attachments.span_id),
      entity_type = COALESCE(excluded.entity_type, opik_attachments.entity_type),
      content_type = COALESCE(excluded.content_type, opik_attachments.content_type),
      file_name = COALESCE(excluded.file_name, opik_attachments.file_name),
      url = COALESCE(excluded.url, opik_attachments.url),
      payload_json = COALESCE(excluded.payload_json, opik_attachments.payload_json),
      created_at_ms = excluded.created_at_ms
  `);

  for (let i = 0; i < (envelope.attachments ?? []).length; i++) {
    const row = envelope.attachments![i];
    if (!isRecord(row)) {
      skipped.push({ reason: "not_object", at: `attachments[${i}]` });
      continue;
    }
    const aid = asStr(row.attachment_id ?? row.id);
    if (!aid) {
      skipped.push({ reason: "missing_attachment_id", at: `attachments[${i}]` });
      continue;
    }
    const et = asStr(row.entity_type);
    const entityType = et === "trace" || et === "span" ? et : "span";
    try {
      insertAttachment.run(
        aid,
        asStr(row.trace_id),
        asStr(row.span_id),
        entityType,
        asStr(row.content_type ?? row.mime_type),
        asStr(row.file_name ?? row.filename),
        asStr(row.url),
        jsonCol(row.payload ?? row.metadata) ?? "{}",
        asNum(row.created_at_ms) ?? now,
      );
      acc.attachments += 1;
    } catch (e) {
      skipped.push({ reason: String(e), at: `attachments[${i}]` });
    }
  }

  const insertFeedback = db.prepare(`
    INSERT INTO opik_trace_feedback (trace_id, score_name, value, category_name, reason, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < (envelope.feedback ?? []).length; i++) {
    const row = envelope.feedback![i];
    if (!isRecord(row)) {
      skipped.push({ reason: "not_object", at: `feedback[${i}]` });
      continue;
    }
    const traceId = asStr(row.trace_id);
    const name = asStr(row.name ?? row.score_name);
    const value = asNum(row.value);
    if (!traceId || !name || value === null) {
      skipped.push({ reason: "missing_trace_id_name_or_value", at: `feedback[${i}]` });
      continue;
    }
    try {
      insertFeedback.run(
        traceId,
        name,
        value,
        asStr(row.category_name ?? row.categoryName),
        asStr(row.reason),
        asNum(row.created_at_ms) ?? now,
      );
      acc.feedback += 1;
    } catch (e) {
      skipped.push({ reason: String(e), at: `feedback[${i}]` });
    }
  }

  return { accepted: acc, skipped };
}
