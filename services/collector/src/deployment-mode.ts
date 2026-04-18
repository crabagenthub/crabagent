export type DeploymentMode = "personal" | "enterprise";

type Env = NodeJS.ProcessEnv;

export type DeploymentConfig = {
  mode: DeploymentMode;
  primary: {
    kind: "sqlite" | "pgsql";
    sqlitePath?: string;
    pgUrl?: string;
  };
  analytics: {
    kind: "duckdb" | "clickhouse";
    duckdbPath?: string;
    clickhouseUrl?: string;
  };
};

function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

function deriveDuckDbPathFromSqlitePath(sqlitePath: string): string {
  const lower = sqlitePath.toLowerCase();
  if (lower.endsWith(".db")) {
    return `${sqlitePath.slice(0, -3)}.analytics.duckdb`;
  }
  return `${sqlitePath}.analytics.duckdb`;
}

function parseMode(env: Env): DeploymentMode {
  const raw = normalize(env.CRABAGENT_DEPLOYMENT_MODE).toLowerCase();
  return raw === "enterprise" ? "enterprise" : "personal";
}

export function loadDeploymentConfig(defaultSqlitePath: string, env: Env = process.env): DeploymentConfig {
  const mode = parseMode(env);

  if (mode === "enterprise") {
    return {
      mode,
      primary: {
        kind: "pgsql",
        pgUrl: normalize(env.CRABAGENT_PG_URL) || undefined,
      },
      analytics: {
        kind: "clickhouse",
        clickhouseUrl: normalize(env.CRABAGENT_CLICKHOUSE_URL) || undefined,
      },
    };
  }

  const sqlitePath = normalize(env.CRABAGENT_DB_PATH) || defaultSqlitePath;
  const duckdbPath = normalize(env.CRABAGENT_DUCKDB_PATH) || deriveDuckDbPathFromSqlitePath(sqlitePath);

  return {
    mode,
    primary: {
      kind: "sqlite",
      sqlitePath,
    },
    analytics: {
      kind: "duckdb",
      duckdbPath,
    },
  };
}

export function validateDeploymentConfig(config: DeploymentConfig): string[] {
  const errors: string[] = [];
  if (config.mode === "enterprise") {
    if (!config.primary.pgUrl) {
      errors.push("CRABAGENT_PG_URL is required when CRABAGENT_DEPLOYMENT_MODE=enterprise");
    }
    if (!config.analytics.clickhouseUrl) {
      errors.push("CRABAGENT_CLICKHOUSE_URL is required when CRABAGENT_DEPLOYMENT_MODE=enterprise");
    }
  }
  return errors;
}
