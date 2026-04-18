import type { ProbeResult } from "./connection-probes.js";
import { probeHttp, probeTcpConnect } from "./connection-probes.js";

export type HealthProbes = {
  postgres?: ProbeResult;
  clickhouse?: ProbeResult;
};

type CacheEntry = { key: string; result: ProbeResult };

let cache: CacheEntry[] = [];

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function cached(key: string, ttlMs: number): ProbeResult | undefined {
  const now = Date.now();
  const hit = cache.find((x) => x.key === key);
  if (!hit) {
    return undefined;
  }
  return now - hit.result.checked_at_ms <= ttlMs ? hit.result : undefined;
}

function save(key: string, result: ProbeResult): void {
  cache = [{ key, result }, ...cache.filter((x) => x.key !== key)].slice(0, 16);
}

function hostAndPortFromPgUrl(pgUrl: string): { host: string; port: number } | null {
  try {
    const u = new URL(pgUrl);
    const host = u.hostname;
    const port = u.port ? Number(u.port) : 5432;
    if (!host || !Number.isFinite(port) || port <= 0) {
      return null;
    }
    return { host, port: Math.floor(port) };
  } catch {
    return null;
  }
}

function clickhouseHealthUrl(base: string): string | null {
  try {
    const u = new URL(base);
    if (!u.pathname || u.pathname === "/") {
      u.pathname = "/ping";
    }
    return u.toString();
  } catch {
    return null;
  }
}

export async function runHealthProbes(input: {
  pgUrl?: string;
  clickhouseUrl?: string;
}): Promise<HealthProbes> {
  const timeoutMs = Math.min(parsePositiveIntEnv("CRABAGENT_HEALTH_PROBE_TIMEOUT_MS", 150), 2000);
  const ttlMs = Math.min(parsePositiveIntEnv("CRABAGENT_HEALTH_PROBE_TTL_MS", 2000), 60_000);

  const out: HealthProbes = {};

  if (input.pgUrl) {
    const key = `pg:${input.pgUrl}`;
    const hit = cached(key, ttlMs);
    if (hit) {
      out.postgres = hit;
    } else {
      const hp = hostAndPortFromPgUrl(input.pgUrl);
      const res = hp
        ? await probeTcpConnect(hp.host, hp.port, timeoutMs)
        : { ok: false, checked_at_ms: Date.now(), latency_ms: 0, error: "invalid_pg_url" };
      save(key, res);
      out.postgres = res;
    }
  }

  if (input.clickhouseUrl) {
    const key = `ch:${input.clickhouseUrl}`;
    const hit = cached(key, ttlMs);
    if (hit) {
      out.clickhouse = hit;
    } else {
      const url = clickhouseHealthUrl(input.clickhouseUrl);
      const res = url
        ? await probeHttp(url, timeoutMs)
        : { ok: false, checked_at_ms: Date.now(), latency_ms: 0, error: "invalid_clickhouse_url" };
      save(key, res);
      out.clickhouse = res;
    }
  }

  return out;
}

