const SQL_LIKE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Display timestamps as local wall time `YYYY-MM-DD HH:mm:ss` (no timezone suffix).
 */
export function formatTraceDateTimeLocal(raw: string | null | undefined): string {
  if (raw == null) {
    return "—";
  }
  const s = String(raw).trim();
  if (s.length === 0) {
    return "—";
  }
  if (SQL_LIKE.test(s)) {
    return `${s.slice(0, 10)} ${s.slice(11, 19).replace("T", " ")}`;
  }
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) {
    return s;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
