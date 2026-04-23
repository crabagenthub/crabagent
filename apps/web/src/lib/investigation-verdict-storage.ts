export type InvestigationVerdictValue =
  | "confirmed_risk"
  | "false_positive"
  | "monitoring"
  | "resolved";

export type InvestigationVerdictRecord = {
  eventKey: string;
  verdict: InvestigationVerdictValue;
  note: string;
  updatedAt: number;
};

const STORAGE_KEY = "crabagent.investigationVerdict.v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readRaw(): InvestigationVerdictRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  const rows = safeParse<InvestigationVerdictRecord[]>(window.localStorage.getItem(STORAGE_KEY), []);
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter(
    (row) =>
      row &&
      typeof row.eventKey === "string" &&
      typeof row.verdict === "string" &&
      typeof row.note === "string" &&
      Number.isFinite(row.updatedAt),
  );
}

function writeRaw(rows: InvestigationVerdictRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function readInvestigationVerdicts(): InvestigationVerdictRecord[] {
  return readRaw().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getInvestigationVerdict(eventKey: string): InvestigationVerdictRecord | null {
  if (!eventKey.trim()) {
    return null;
  }
  return readRaw().find((row) => row.eventKey === eventKey) ?? null;
}

export function saveInvestigationVerdict(
  input: Omit<InvestigationVerdictRecord, "updatedAt">,
): InvestigationVerdictRecord {
  const next: InvestigationVerdictRecord = {
    ...input,
    note: input.note.trim(),
    updatedAt: Date.now(),
  };
  const prev = readRaw().filter((row) => row.eventKey !== input.eventKey);
  writeRaw([next, ...prev]);
  return next;
}

export function clearInvestigationVerdict(eventKey: string): void {
  writeRaw(readRaw().filter((row) => row.eventKey !== eventKey));
}
