import path from "node:path";
import type { DeploymentConfig } from "./deployment-mode.js";
import { openDatabase } from "./db.js";
import type { StorageRuntime } from "./storage-adapters.js";

function looksLikeUrl(raw: string | undefined): boolean {
  if (!raw || !raw.trim()) {
    return false;
  }
  try {
    const u = new URL(raw);
    return Boolean(u.protocol && u.host);
  } catch {
    return false;
  }
}

function parseDefaultTimeWindowMs(raw: string | undefined): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || n <= 0) {
    return 24 * 60 * 60 * 1000;
  }
  return Math.floor(n);
}

export function initializeRuntimeStorage(config: DeploymentConfig): StorageRuntime {
  if (config.primary.kind !== "sqlite") {
    const pgReady = looksLikeUrl(config.primary.pgUrl);
    const chReady = looksLikeUrl(config.analytics.clickhouseUrl);
    return {
      primary: {
        kind: "pgsql",
        db: null,
        locationLabel: config.primary.pgUrl ?? "",
        ready: pgReady,
        message: pgReady
          ? "PostgreSQL URL configured; query migration to pgsql is not completed yet"
          : "PostgreSQL URL is invalid",
      },
      analytics: {
        kind: "clickhouse",
        locationLabel: config.analytics.clickhouseUrl ?? "",
        ready: chReady,
        message: chReady
          ? "ClickHouse URL configured; analytics sync pipeline is not implemented yet"
          : "ClickHouse URL is invalid",
      },
      capabilities: {
        defaultTimeWindowMs: parseDefaultTimeWindowMs(process.env.CRABAGENT_DEFAULT_TIME_WINDOW_MS),
      },
    };
  }

  const sqlitePath = config.primary.sqlitePath;
  if (!sqlitePath) {
    throw new Error("[crabagent-collector] sqlite path is empty in personal mode");
  }
  const sqlite = openDatabase(sqlitePath);

  return {
    primary: {
      kind: "sqlite",
      db: sqlite,
      locationLabel: path.resolve(sqlitePath),
      ready: true,
    },
    analytics: {
      kind: "duckdb",
      locationLabel: config.analytics.duckdbPath ?? "",
      ready: false,
      message: "DuckDB analytics pipeline is not implemented yet",
    },
    capabilities: {
      defaultTimeWindowMs: parseDefaultTimeWindowMs(process.env.CRABAGENT_DEFAULT_TIME_WINDOW_MS),
    },
  };
}
