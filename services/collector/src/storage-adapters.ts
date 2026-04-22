import type Database from "better-sqlite3";

export type PrimaryStorageAdapter =
  | {
      kind: "sqlite";
      db: Database.Database;
      locationLabel: string;
      ready: true;
      message?: string;
    }
  | {
      kind: "pgsql";
      db: null;
      locationLabel: string;
      ready: false;
      message: string;
    };

export type AnalyticsStorageAdapter =
  | {
      kind: "duckdb";
      locationLabel: string;
      ready: boolean;
      message?: string;
    }
  | {
      kind: "clickhouse";
      locationLabel: string;
      ready: boolean;
      message?: string;
    };

export type StorageCapabilities = {
  defaultTimeWindowMs: number;
};

export type StorageRuntime = {
  primary: PrimaryStorageAdapter;
  analytics: AnalyticsStorageAdapter;
  capabilities: StorageCapabilities;
};
