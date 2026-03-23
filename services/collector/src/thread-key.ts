/**
 * Product model: one **conversation thread** per list row (personal users see one chat,
 * not N internal trace_root UUIDs). Technical `trace_root_id` remains on each event for devs.
 */
export const THREAD_KEY_SQL = `COALESCE(NULLIF(TRIM(session_key), ''), NULLIF(TRIM(session_id), ''), trace_root_id)`;

/** Match ingest-time fan-out (must stay aligned with THREAD_KEY_SQL). */
export function computeThreadKey(params: {
  session_key?: string | null;
  session_id?: string | null;
  trace_root_id?: string | null;
}): string | undefined {
  const sk = typeof params.session_key === "string" ? params.session_key.trim() : "";
  if (sk) {
    return sk;
  }
  const sid = typeof params.session_id === "string" ? params.session_id.trim() : "";
  if (sid) {
    return sid;
  }
  const tr = typeof params.trace_root_id === "string" ? params.trace_root_id.trim() : "";
  return tr || undefined;
}
