/** Aligned with Collector `thread-key.ts` / `THREAD_KEY_SQL` for deep links to Traces. */
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
