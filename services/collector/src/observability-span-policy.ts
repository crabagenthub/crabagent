import type Database from "better-sqlite3";

const MAX_JSON = 120_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function jsonBlob(v: unknown): string {
  try {
    const s = JSON.stringify(v ?? {});
    if (s.length <= MAX_JSON) {
      return s;
    }
    return `${s.slice(0, MAX_JSON)}…`;
  } catch {
    return "{}";
  }
}

function pickStr(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function pickNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return undefined;
}

/** 与产品文档一致：AGENT_LOOP 仅用于合成「思考循环」父 Span；LLM/MEMORY/IO 等用于子步骤。 */
export type OpenClawSemanticSpanType = "AGENT_LOOP" | "LLM" | "TOOL" | "SKILL" | "PLUGIN" | "IO" | "MEMORY";

export type ExtensionKind = "skill" | "plugin";

export function loopParentSpanId(
  traceId: string,
  msgId: string | null | undefined,
  runId: string | null | undefined,
): string | null {
  const m = typeof msgId === "string" ? msgId.trim() : "";
  if (m) {
    return `loop:${traceId}:${m}`;
  }
  const r = typeof runId === "string" ? runId.trim() : "";
  if (r) {
    return `loop:${traceId}:run:${r}`;
  }
  return null;
}

/** 用户入站消息等不挂在 Agent Loop 下。 */
export function isTraceRootIoEvent(eventType: string): boolean {
  const t = eventType.trim().toLowerCase();
  return t === "message_received" || t === "session_start";
}

/** 有 msg_id 或 run_id 时，为 Agent 侧事件维护合成 Loop 父级。 */
export function shouldEnsureLoopForEvent(eventType: string): boolean {
  if (isTraceRootIoEvent(eventType)) {
    return false;
  }
  return true;
}

export function openClawSemanticSpanType(
  eventType: string,
  payload: Record<string, unknown>,
): OpenClawSemanticSpanType {
  const t = eventType.trim().toLowerCase();
  if (t === "message_received" || t === "session_start") {
    return "IO";
  }
  if (t === "context_prune_applied" || t.startsWith("compaction_")) {
    return "MEMORY";
  }
  if (t === "before_tool" || t === "after_tool") {
    const tn = (pickStr(payload.toolName) ?? "").toLowerCase();
    if (/(memory|embed|vector|rag|retriev|search|similarity)/.test(tn)) {
      return "MEMORY";
    }
    if (
      /^(read|open|load|cat|file|path|fs)/.test(tn) ||
      tn.includes("file") ||
      tn.includes("path") ||
      /\.(md|txt|json|csv|pdf)\b/.test(tn)
    ) {
      return "IO";
    }
    return "TOOL";
  }
  if (t === "hook_contribution") {
    return extensionKindFromPayload(payload) === "skill" ? "SKILL" : "PLUGIN";
  }
  if (t === "subagent_spawned" || t === "subagent_ended") {
    return "SKILL";
  }
  if (
    t === "llm_input" ||
    t === "llm_output" ||
    t === "before_model_resolve" ||
    t === "before_prompt_build" ||
    t === "agent_end"
  ) {
    return "LLM";
  }
  return "IO";
}

export function extensionKindFromPayload(payload: Record<string, unknown>): ExtensionKind {
  const pid = (pickStr(payload.pluginId) ?? "").toLowerCase();
  const sh = (pickStr(payload.sourceHook) ?? "").toLowerCase();
  if (
    pid.startsWith("openclaw") ||
    pid.includes("openclaw-trace") ||
    pid === "openclaw-trace-plugin" ||
    sh.includes("openclaw")
  ) {
    return "skill";
  }
  if (payload.isInternal === true || payload.internal === true) {
    return "skill";
  }
  return "plugin";
}

export function buildSpanActionMetadata(params: {
  eventType: string;
  payload: Record<string, unknown>;
  extensionKind?: ExtensionKind;
}): string {
  const { eventType, payload } = params;
  const t = eventType.trim().toLowerCase();
  const action_details: Record<string, unknown> = {
    is_internal:
      params.extensionKind === "skill" ||
      extensionKindFromPayload(payload) === "skill" ||
      payload.isInternal === true,
  };

  const pathLike =
    pickStr(payload.path) ||
    pickStr(payload.filePath) ||
    pickStr(payload.file_path) ||
    pickStr(payload.uri);
  if (pathLike || t === "message_received") {
    const size = pickStr(payload.size) ?? pickStr(payload.fileSize);
    const encoding = pickStr(payload.encoding) ?? pickStr(payload.charset);
    if (pathLike || size || encoding) {
      action_details.file_stats = {
        ...(pathLike ? { path: pathLike } : {}),
        ...(size ? { size } : {}),
        ...(encoding ? { encoding } : {}),
      };
    }
  }

  const collection =
    pickStr(payload.collection) ||
    pickStr(payload.memoryCollection) ||
    (isPlainObject(payload.memory_context) ? pickStr(payload.memory_context.collection) : null);
  const score =
    pickNum(payload.score) ??
    pickNum(payload.relevanceScore) ??
    (isPlainObject(payload.memory_context) ? pickNum(payload.memory_context.score) : undefined);
  if (collection != null || score != undefined) {
    action_details.memory_context = {
      ...(collection ? { collection } : {}),
      ...(score !== undefined ? { score } : {}),
    };
  }

  const pv = pickStr(payload.pluginVersion) ?? pickStr(payload.plugin_version);
  if (pv) {
    action_details.plugin_version = pv;
  }

  if (params.extensionKind) {
    action_details.extension = {
      kind: params.extensionKind,
      is_internal: params.extensionKind === "skill",
    };
  } else if (t === "hook_contribution") {
    const ek = extensionKindFromPayload(payload);
    action_details.extension = { kind: ek, is_internal: ek === "skill" };
  }

  return jsonBlob({ action_details });
}

export function ensureSyntheticAgentLoopSpan(params: {
  db: Database.Database;
  traceId: string;
  loopSpanId: string;
  eventMs: number;
}): void {
  const { db, traceId, loopSpanId, eventMs } = params;
  const input = jsonBlob({
    purpose: "agent_loop",
    wraps: "thought_action_observation_cycle",
  });
  db.prepare(
    `INSERT INTO spans (span_id, trace_id, parent_id, module, type, name, input, output, start_time, end_time, error, metadata)
     VALUES (?, ?, NULL, 'OTHER', 'AGENT_LOOP', 'agent_loop', ?, '{}', ?, ?, NULL, ?)
     ON CONFLICT(span_id) DO UPDATE SET
       start_time = MIN(spans.start_time, excluded.start_time),
       end_time = MAX(COALESCE(spans.end_time, spans.start_time), COALESCE(excluded.end_time, excluded.start_time)),
       input = excluded.input`,
  ).run(
    loopSpanId,
    traceId,
    input,
    eventMs,
    eventMs,
    jsonBlob({
      action_details: {
        is_internal: true,
        synthetic_loop: true,
      },
    }),
  );
}

function openclawPayloadParentId(payload: Record<string, unknown>): string | null {
  const top =
    pickStr(payload.parent_span_id) ||
    pickStr(payload.parentSpanId) ||
    pickStr(payload.parent_id);
  if (top) {
    return top;
  }
  if (isPlainObject(payload.crabagent)) {
    const c = payload.crabagent as Record<string, unknown>;
    return pickStr(c.parent_span_id) || pickStr(c.parentSpanId);
  }
  return null;
}

function normalizeRunId(payload: Record<string, unknown>): string {
  return pickStr(payload.run_id) || pickStr(payload.runId) || "";
}

export function resolveSemanticParentId(params: {
  db: Database.Database;
  traceId: string;
  eventType: string;
  eventId: string;
  eventMs: number;
  payload: Record<string, unknown>;
  loopSpanId: string | null;
}): string | null {
  const explicit = openclawPayloadParentId(params.payload);
  if (explicit) {
    return explicit;
  }

  const t = params.eventType.trim().toLowerCase();
  if (isTraceRootIoEvent(params.eventType)) {
    return null;
  }

  if (t === "after_tool") {
    const tc = pickStr(params.payload.toolCallId);
    if (tc) {
      const row = params.db
        .prepare(
          `SELECT span_id FROM spans
           WHERE trace_id = ?
             AND type IN ('TOOL','IO','MEMORY')
             AND json_extract(input, '$.toolCallId') = ?
             AND span_id != ?
             AND start_time <= ?
           ORDER BY start_time DESC
           LIMIT 1`,
        )
        .get(params.traceId, tc, params.eventId, params.eventMs) as { span_id: string } | undefined;
      if (row?.span_id) {
        return row.span_id;
      }
    }
  }

  if (t === "llm_output") {
    const rid = normalizeRunId(params.payload);
    if (rid) {
      const row = params.db
        .prepare(
          `SELECT span_id FROM spans
           WHERE trace_id = ?
             AND type = 'LLM'
             AND json_extract(input, '$.event_hook') = 'llm_input'
             AND json_extract(input, '$.runId') = ?
             AND span_id != ?
             AND start_time <= ?
           ORDER BY start_time DESC
           LIMIT 1`,
        )
        .get(params.traceId, rid, params.eventId, params.eventMs) as { span_id: string } | undefined;
      if (row?.span_id) {
        return row.span_id;
      }
    }
  }

  if (params.loopSpanId) {
    return params.loopSpanId;
  }

  return null;
}
