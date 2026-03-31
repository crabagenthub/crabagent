const SQL_LIKE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Display timestamps as local wall time `YYYY-MM-DD HH:mm:ss` (no timezone suffix).
 * Prefer parsing through `Date` first so `…Z` ISO strings from `toISOString()` become **local** machine time, not UTC digits.
 */
export function formatTraceDateTimeLocal(raw: string | null | undefined): string {
  if (raw == null) {
    return "—";
  }
  const s = String(raw).trim();
  if (s.length === 0) {
    return "—";
  }
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) {
    return formatFromDate(d);
  }
  if (SQL_LIKE.test(s)) {
    return `${s.slice(0, 10)} ${s.slice(11, 19).replace("T", " ")}`;
  }
  return s;
}

/** Format epoch ms as local wall time (avoids `toISOString()` UTC pitfall at call sites). */
export function formatTraceDateTimeFromMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "—";
  }
  return formatFromDate(new Date(ms));
}
