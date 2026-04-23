export type AuditSilenceScope = "trace" | "event_type";

export type AuditSilenceRule = {
  id: string;
  scope: AuditSilenceScope;
  traceId?: string;
  eventType?: "command" | "resource" | "policy_hit";
  reason: string;
  createdAt: number;
  expireAt: number;
};

export type AuditSilenceOverview = {
  activeCount: number;
  expiringSoonCount: number;
};

const STORAGE_KEY = "crabagent.auditSilence.v1";

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

function readRaw(): AuditSilenceRule[] {
  if (typeof window === "undefined") {
    return [];
  }
  const arr = safeParse<AuditSilenceRule[]>(window.localStorage.getItem(STORAGE_KEY), []);
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr.filter(Boolean);
}

function writeRaw(rows: AuditSilenceRule[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function readActiveAuditSilences(now = Date.now()): AuditSilenceRule[] {
  const rows = readRaw();
  const active = rows.filter((r) => Number.isFinite(r.expireAt) && r.expireAt > now);
  if (active.length !== rows.length) {
    writeRaw(active);
  }
  return active;
}

export function readAuditSilenceOverview(now = Date.now(), soonMinutes = 30): AuditSilenceOverview {
  const active = readActiveAuditSilences(now);
  const soonMs = Math.max(1, Math.floor(soonMinutes)) * 60_000;
  const soonCutoff = now + soonMs;
  return {
    activeCount: active.length,
    expiringSoonCount: active.filter((rule) => rule.expireAt <= soonCutoff).length,
  };
}

export function appendAuditSilenceRule(
  input: Omit<AuditSilenceRule, "id" | "createdAt">,
): AuditSilenceRule {
  const now = Date.now();
  const next: AuditSilenceRule = {
    id: `as_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    ...input,
  };
  const prev = readActiveAuditSilences(now);
  writeRaw([next, ...prev]);
  return next;
}

export function removeAuditSilenceRule(id: string): void {
  const prev = readActiveAuditSilences();
  writeRaw(prev.filter((r) => r.id !== id));
}

export function matchAuditSilence(
  params: { traceId: string; eventType: "command" | "resource" | "policy_hit" },
  now = Date.now(),
): AuditSilenceRule | null {
  const active = readActiveAuditSilences(now);
  const byTrace = active.find((r) => r.scope === "trace" && r.traceId === params.traceId);
  if (byTrace) {
    return byTrace;
  }
  const byEventType = active.find(
    (r) => r.scope === "event_type" && r.eventType === params.eventType,
  );
  return byEventType ?? null;
}

