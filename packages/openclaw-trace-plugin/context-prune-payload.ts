/**
 * Normalize `context_prune_applied` hook payloads for ingest.
 * Works with stock OpenClaw (aggregate fields only) and builds that add `messageChanges`.
 */

const PLUGIN_ID = "openclaw-trace-plugin";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function roleCounts(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = num(raw);
    if (n !== undefined && n >= 0) {
      out[k] = n;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

/**
 * Keep rows that look like OpenClaw `PluginHookContextPruneAppliedMessageChange`.
 */
function sanitizeMessageChanges(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  const list: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }
    const index = num(item.index);
    if (index === undefined || index < 0) {
      continue;
    }
    const role = typeof item.role === "string" ? item.role : "?";
    const toolName =
      typeof item.toolName === "string" && item.toolName.trim() ? item.toolName.trim() : undefined;
    const charsBefore = num(item.charsBefore) ?? 0;
    const charsAfter = num(item.charsAfter) ?? 0;
    const charDelta =
      num(item.charDelta) ?? Math.max(0, charsAfter) - Math.max(0, charsBefore);
    const phase =
      item.phase === "soft_trim" || item.phase === "hard_clear" || item.phase === "unknown"
        ? item.phase
        : "unknown";
    list.push({
      index,
      role,
      ...(toolName ? { toolName } : {}),
      charsBefore,
      charsAfter,
      charDelta,
      phase,
    });
  }
  return list;
}

export function buildContextPruneTracePayload(event: unknown): Record<string, unknown> {
  const e = isPlainObject(event) ? event : {};

  const messageCountBefore = num(e.messageCountBefore);
  const messageCountAfter = num(e.messageCountAfter);
  const estimatedCharsBefore = num(e.estimatedCharsBefore);
  const estimatedCharsAfter = num(e.estimatedCharsAfter);

  const messageChanges = sanitizeMessageChanges(e.messageChanges);
  const messageChangesTruncated = e.messageChangesTruncated === true ? true : undefined;

  const charDelta =
    estimatedCharsBefore !== undefined && estimatedCharsAfter !== undefined
      ? estimatedCharsAfter - estimatedCharsBefore
      : undefined;

  const detailLevel: "per_message" | "aggregate_only" =
    messageChanges.length > 0 ? "per_message" : "aggregate_only";

  const out: Record<string, unknown> = {
    mode: typeof e.mode === "string" && e.mode.trim() ? e.mode.trim() : "unknown",
    ...(messageCountBefore !== undefined ? { messageCountBefore } : {}),
    ...(messageCountAfter !== undefined ? { messageCountAfter } : {}),
    ...(estimatedCharsBefore !== undefined ? { estimatedCharsBefore } : {}),
    ...(estimatedCharsAfter !== undefined ? { estimatedCharsAfter } : {}),
    roleCountsBefore: roleCounts(e.roleCountsBefore),
    roleCountsAfter: roleCounts(e.roleCountsAfter),
    ...(charDelta !== undefined ? { charDelta } : {}),
    ...(messageChanges.length > 0 ? { messageChanges } : {}),
    ...(messageChangesTruncated ? { messageChangesTruncated } : {}),
    tracePlugin: {
      id: PLUGIN_ID,
      detailLevel,
      payloadSchema: 1,
    },
  };

  return out;
}
