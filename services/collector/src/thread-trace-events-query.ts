import type Database from "better-sqlite3";

type TraceRow = {
  trace_id: string;
  thread_id: string | null;
  name: string | null;
  input_json: string | null;
  output_json: string | null;
  metadata_json: string | null;
  created_at_ms: number | null;
};

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
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        continue;
      }
      const o = m as Record<string, unknown>;
      if (!roleLooksAssistantMessage(o)) {
        continue;
      }
      const t = textFromMessageLike(o);
      if (t) {
        return [t];
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

function llmOutputPayload(
  output: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...output };
  const mdUsage = metadata.usage;
  if (
    (out.usage == null || typeof out.usage !== "object" || Array.isArray(out.usage)) &&
    mdUsage &&
    typeof mdUsage === "object" &&
    !Array.isArray(mdUsage)
  ) {
    out.usage = { ...(mdUsage as Record<string, unknown>) };
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
  return out;
}

/**
 * Synthesize OpenClaw-style timeline rows from `opik_traces` (no legacy `events` table).
 * One user turn per trace: `message_received` → `llm_input` → `llm_output`.
 */
export function queryThreadTraceEvents(db: Database.Database, threadKey: string): Record<string, unknown>[] {
  const key = threadKey.trim();
  // #region agent log
  fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"H3",location:"services/collector/src/thread-trace-events-query.ts:191",message:"queryThreadTraceEvents_enter",data:{threadKey:key},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!key) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT trace_id,
              thread_id,
              name,
              input_json,
              output_json,
              metadata_json,
              created_at_ms
       FROM opik_traces
       WHERE COALESCE(NULLIF(TRIM(thread_id), ''), trace_id) = ?
       ORDER BY created_at_ms ASC, trace_id ASC`,
    )
    .all(key) as TraceRow[];
  // #region agent log
  fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"H3",location:"services/collector/src/thread-trace-events-query.ts:210",message:"queryThreadTraceEvents_rows_loaded",data:{threadKey:key,rowCount:rows.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const events: Record<string, unknown>[] = [];
  let seq = 0;

  for (const r of rows) {
    const traceId = String(r.trace_id ?? "").trim();
    if (!traceId) {
      continue;
    }
    const created = typeof r.created_at_ms === "number" && Number.isFinite(r.created_at_ms) ? r.created_at_ms : 0;
    const baseId = created + seq * 100;
    seq += 1;

    const input = safeObject(r.input_json);
    const output = safeObject(r.output_json);
    const metadata = safeObject(r.metadata_json);
    // #region agent log
    fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"H1",location:"services/collector/src/thread-trace-events-query.ts:229",message:"llm_output_usage_source_shape",data:{traceId,threadKey:key,outputHasUsage:typeof output.usage==="object"&&output.usage!==null,outputHasUsageMetadata:typeof output.usageMetadata==="object"&&output.usageMetadata!==null,metadataHasUsage:typeof metadata.usage==="object"&&metadata.usage!==null,metadataHasTotalTokens:typeof metadata.total_tokens==="number"||typeof metadata.totalTokens==="number"},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const agentName = agentNameFromMetadata(metadata);
    const chatTitle = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
    const when =
      created > 0
        ? new Date(created).toISOString()
        : new Date().toISOString();

    const runId =
      (typeof metadata.run_id === "string" && metadata.run_id.trim()) ||
      (typeof metadata.runId === "string" && metadata.runId.trim()) ||
      traceId;

    events.push({
      id: baseId,
      event_id: `${traceId}:recv`,
      type: "message_received",
      trace_root_id: traceId,
      agent_id: null,
      agent_name: agentName,
      chat_title: chatTitle,
      client_ts: when,
      created_at: when,
      payload: userPayloadFromInput(input),
    });

    events.push({
      id: baseId + 1,
      event_id: `${traceId}:llm_in`,
      type: "llm_input",
      trace_root_id: traceId,
      run_id: runId,
      agent_name: agentName,
      chat_title: chatTitle,
      client_ts: when,
      created_at: when,
      payload: Object.keys(input).length > 0 ? { ...input, run_id: runId } : { prompt: "—", run_id: runId },
    });

    events.push({
      id: baseId + 2,
      event_id: `${traceId}:llm_out`,
      type: "llm_output",
      trace_root_id: traceId,
      run_id: runId,
      agent_name: agentName,
      chat_title: chatTitle,
      client_ts: when,
      created_at: when,
      payload: llmOutputPayload(output, metadata),
    });
    // #region agent log
    {
      const p = events[events.length - 1]?.payload;
      const po = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
      fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"H2",location:"services/collector/src/thread-trace-events-query.ts:280",message:"llm_output_payload_ready",data:{traceId,threadKey:key,payloadHasUsage:typeof po.usage==="object"&&po.usage!==null,payloadHasUsageMetadata:typeof po.usageMetadata==="object"&&po.usageMetadata!==null,payloadAssistantTexts:Array.isArray(po.assistantTexts)?po.assistantTexts.length:0},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
  }

  return events;
}
