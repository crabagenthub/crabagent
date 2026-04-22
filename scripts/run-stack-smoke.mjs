#!/usr/bin/env node
/**
 * Starts a temporary Collector, POSTs /v1/opik/batch, verifies traces list, trace/list, trace/spans.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const collectorEntry = path.join(repoRoot, "services/collector/dist/index.js");

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
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (c) => {
    stderr += String(c);
  });

  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  process.on("exit", kill);

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

    const traceId = randomUUID();
    const threadKey = `smoke-thread-${Date.now()}`;
    const spanLlm = randomUUID();
    const t = Date.now();
    const batch = {
      threads: [
        {
          thread_id: threadKey,
          workspace_name: "default",
          project_name: "openclaw",
          first_seen_ms: t,
          last_seen_ms: t,
          metadata: { smoke: true },
        },
      ],
      traces: [
        {
          trace_id: traceId,
          thread_id: threadKey,
          workspace_name: "default",
          project_name: "openclaw",
          name: "smoke-model",
          input: { prompt: "smoke hello world" },
          metadata: { total_tokens: 42, usage: { total_tokens: 42 } },
          created_at_ms: t,
          is_complete: 1,
          success: 1,
          ended_at_ms: t,
          created_from: "smoke",
        },
      ],
      spans: [
        {
          span_id: spanLlm,
          trace_id: traceId,
          parent_span_id: null,
          name: "smoke-model",
          type: "llm",
          start_time_ms: t,
          end_time_ms: t,
          is_complete: 1,
          sort_index: 1,
          usage: { prompt_tokens: 10, completion_tokens: 32, total_tokens: 42 },
        },
      ],
    };

    const batchRes = await fetch(`${base}/v1/opik/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(batch),
    });
    const batchBody = await batchRes.text();
    if (!batchRes.ok) {
      console.error("opik/batch failed", batchRes.status, batchBody);
      process.exit(1);
    }

    const gone = await fetch(`${base}/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ events: [] }),
    });
    if (gone.status !== 410) {
      console.error("expected /v1/ingest 410 Gone, got", gone.status);
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
    const foundThread = items.some((r) => r.thread_key === threadKey || r.trace_root_id === traceId);
    if (!foundThread) {
      console.error("Expected thread or trace in list:", threadKey, traceId, "got", items);
      process.exit(1);
    }

    const msgRes = await fetch(`${base}/v1/trace-messages?limit=20`, {
      headers: { "X-API-Key": API_KEY },
    });
    const msgJson = await msgRes.json();
    if (!msgRes.ok || !Array.isArray(msgJson.items)) {
      console.error("trace-messages failed", msgRes.status, msgJson);
      process.exit(1);
    }

    const recRes = await fetch(`${base}/v1/trace/list?limit=50`, {
      headers: { "X-API-Key": API_KEY },
    });
    const recJson = await recRes.json();
    if (!recRes.ok) {
      console.error("trace/list failed", recRes.status, recJson);
      process.exit(1);
    }
    const recItems = recJson.items ?? [];
    const recRow = recItems.find((r) => r.trace_id === traceId);
    if (!recRow) {
      console.error("Expected trace/list row for trace_id", traceId, "got", recItems);
      process.exit(1);
    }

    const searchRes = await fetch(
      `${base}/v1/trace/list?limit=10&search=${encodeURIComponent("smoke hello")}`,
      { headers: { "X-API-Key": API_KEY } },
    );
    const searchJson = await searchRes.json();
    if (!searchRes.ok || !(searchJson.items ?? []).some((r) => r.trace_id === traceId)) {
      console.error("trace/list search failed", searchRes.status, searchJson);
      process.exit(1);
    }

    const semRes = await fetch(
      `${base}/v1/trace/spans?trace_id=${encodeURIComponent(traceId)}`,
      { headers: { "X-API-Key": API_KEY } },
    );
    const semJson = await semRes.json();
    if (!semRes.ok || !Array.isArray(semJson.items)) {
      console.error("trace/spans failed", semRes.status, semJson);
      process.exit(1);
    }
    if (!semJson.items.some((s) => s.span_id === spanLlm)) {
      console.error("trace/spans missing llm span", semJson.items);
      process.exit(1);
    }

    console.log("OK — Collector opik/batch smoke passed.");
    console.log("  thread_key:", threadKey);
    console.log("  trace_id:", traceId);
    console.log("  trace-messages count (opik mode):", msgJson.items.length);
  } finally {
    kill();
    await sleep(200);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
