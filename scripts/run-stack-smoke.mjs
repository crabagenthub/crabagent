#!/usr/bin/env node
/**
 * Starts a temporary Collector (separate port + temp DB), POSTs a sample ingest,
 * verifies GET /v1/traces. No manual services required.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collectorEntry = path.join(repoRoot, "services/collector/dist/index.js");

/** Isolated key for this process only (do not inherit empty CRABAGENT_API_KEY from the shell). */
const API_KEY =
  process.env.CRABAGENT_SMOKE_API_KEY?.trim() || "crabagent-smoke-key";
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      s.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("no port"));
        }
      });
    });
  });
}
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crabagent-smoke-")), "smoke.db");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function health(base) {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(collectorEntry)) {
    console.error(
      "Missing services/collector/dist/index.js — run: pnpm --filter @crabagent/collector build",
    );
    process.exit(1);
  }

  const PORT = process.env.CRABAGENT_SMOKE_PORT
    ? Number(process.env.CRABAGENT_SMOKE_PORT)
    : await reserveFreePort();
  const base = `http://127.0.0.1:${PORT}`;
  const env = {
    ...process.env,
    CRABAGENT_PORT: String(PORT),
    CRABAGENT_API_KEY: API_KEY,
    CRABAGENT_DB_PATH: dbPath,
    CRABAGENT_CORS_ORIGIN: process.env.CRABAGENT_CORS_ORIGIN ?? "*",
  };

  const child = spawn(process.execPath, [collectorEntry], {
    env,
    cwd: path.join(repoRoot, "services/collector"),
    // Do not pipe stdout: server startup logs can fill the buffer and deadlock the process.
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (c) => {
    stderr += String(c);
  });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error("Collector exited early", { code, signal, stderr: stderr.slice(-2000) });
    }
  });

  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  process.on("exit", kill);
  process.on("SIGINT", () => {
    kill();
    process.exit(130);
  });

  try {
    for (let i = 0; i < 50; i++) {
      if (await health(base)) {
        break;
      }
      if (i === 49) {
        console.error("Collector did not become healthy in time.");
        console.error(stderr.slice(-2000));
        process.exit(1);
      }
      await sleep(100);
    }

    const traceRoot = `smoke-trace-${Date.now()}`;
    const eventId = `smoke-event-${Date.now()}`;
    const ingestRes = await fetch(`${base}/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        events: [
          {
            event_id: eventId,
            trace_root_id: traceRoot,
            session_id: "smoke-session",
            type: "smoke_test",
            payload: { hello: true },
            schema_version: 1,
          },
        ],
      }),
    });
    const ingestBody = await ingestRes.text();
    if (!ingestRes.ok) {
      console.error("ingest failed", ingestRes.status, ingestBody);
      process.exit(1);
    }

    const tracesRes = await fetch(`${base}/v1/traces?limit=20`, {
      headers: { "X-API-Key": API_KEY },
    });
    const tracesJson = await tracesRes.json();
    if (!tracesRes.ok) {
      console.error("traces failed", tracesRes.status, tracesJson);
      process.exit(1);
    }
    const items = tracesJson.items ?? [];
    const threadKey = "smoke-session";
    const found = items.some((r) => r.thread_key === threadKey);
    if (!found) {
      console.error("Expected thread_key in list:", threadKey, "got", items);
      process.exit(1);
    }

    console.log("OK — Collector ingest + list smoke passed.");
    console.log("  thread_key:", threadKey);
    console.log("  trace_root_id (event):", traceRoot);
    console.log("  event_id:", eventId);
  } finally {
    kill();
    await sleep(200);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
