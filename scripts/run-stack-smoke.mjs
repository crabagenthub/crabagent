#!/usr/bin/env node
/**
 * Starts a temporary Collector (separate port + temp DB), POSTs a sample ingest,
 * verifies GET /v1/traces, /v1/trace-messages, /v1/trace-records, and /v1/semantic-spans. No manual services required.
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
    const msgEventId = `smoke-msg-${Date.now()}`;
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
          {
            event_id: msgEventId,
            trace_root_id: traceRoot,
            session_id: "smoke-session",
            session_key: "agent:main:smoke:channel:user-1",
            type: "message_received",
            payload: { content: "smoke hello", channel: "smoke" },
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

    const msgRes = await fetch(`${base}/v1/trace-messages?limit=20`, {
      headers: { "X-API-Key": API_KEY },
    });
    const msgJson = await msgRes.json();
    if (!msgRes.ok) {
      console.error("trace-messages failed", msgRes.status, msgJson);
      process.exit(1);
    }
    const msgItems = msgJson.items ?? [];
    const msgFound = msgItems.some((r) => r.event_id === msgEventId);
    if (!msgFound) {
      console.error("Expected message row in trace-messages:", msgEventId, "got", msgItems);
      process.exit(1);
    }

    const recRes = await fetch(`${base}/v1/trace-records?limit=50`, {
      headers: { "X-API-Key": API_KEY },
    });
    const recJson = await recRes.json();
    if (!recRes.ok) {
      console.error("trace-records failed", recRes.status, recJson);
      process.exit(1);
    }
    const recItems = recJson.items ?? [];
    const recRow = recItems.find(
      (r) => r.trace_id === traceRoot && typeof r.thread_key === "string" && r.thread_key.length > 0,
    );
    if (!recRow) {
      console.error("Expected trace-records row for trace_id", traceRoot, "got", recItems);
      process.exit(1);
    }
    for (const k of ["loop_count", "tool_call_count", "saved_tokens_total", "optimization_rate_pct"]) {
      if (!(k in recRow)) {
        console.error("trace-records row missing field", k, recRow);
        process.exit(1);
      }
    }

    const searchRes = await fetch(
      `${base}/v1/trace-records?limit=10&search=${encodeURIComponent("smoke hello")}`,
      { headers: { "X-API-Key": API_KEY } },
    );
    const searchJson = await searchRes.json();
    if (!searchRes.ok || !(searchJson.items ?? []).some((r) => r.trace_id === traceRoot)) {
      console.error("trace-records search filter failed", searchRes.status, searchJson);
      process.exit(1);
    }

    const semRes = await fetch(
      `${base}/v1/semantic-spans?trace_id=${encodeURIComponent(traceRoot)}`,
      { headers: { "X-API-Key": API_KEY } },
    );
    const semJson = await semRes.json();
    if (!semRes.ok || !Array.isArray(semJson.items)) {
      console.error("semantic-spans failed", semRes.status, semJson);
      process.exit(1);
    }

    /** Full pipeline slice: message without trace_root, later rows share root (matches plugin ordering). */
    const chainTk = `agent:smoke-chain-${Date.now()}`;
    const trChain = `tr-chain-${Date.now()}`;
    const runChain = `run-chain-${Date.now()}`;
    const msgChainId = `msg-chain-${Date.now()}`;
    const chainIngest = await fetch(`${base}/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        events: [
          {
            event_id: msgChainId,
            session_id: "smoke-chain-sess",
            session_key: chainTk,
            type: "message_received",
            payload: { content: "chain smoke", channel: "smoke" },
            schema_version: 1,
          },
          {
            event_id: `ev-bmr-${Date.now()}`,
            trace_root_id: trChain,
            session_id: "smoke-chain-sess",
            session_key: chainTk,
            type: "before_model_resolve",
            payload: { promptCharCount: 3 },
            schema_version: 1,
          },
          {
            event_id: `ev-bpb-${Date.now()}`,
            trace_root_id: trChain,
            session_id: "smoke-chain-sess",
            session_key: chainTk,
            type: "before_prompt_build",
            payload: { historyMessageCount: 0 },
            schema_version: 1,
          },
          {
            event_id: `ev-li-${Date.now()}`,
            trace_root_id: trChain,
            session_id: "smoke-chain-sess",
            session_key: chainTk,
            run_id: runChain,
            type: "llm_input",
            payload: { provider: "x", model: "y", prompt: "p" },
            schema_version: 1,
          },
          {
            event_id: `ev-lo-${Date.now()}`,
            trace_root_id: trChain,
            session_id: "smoke-chain-sess",
            session_key: chainTk,
            run_id: runChain,
            type: "llm_output",
            payload: { assistantTexts: ["ok"] },
            schema_version: 1,
          },
        ],
      }),
    });
    if (!chainIngest.ok) {
      console.error("chain ingest failed", chainIngest.status, await chainIngest.text());
      process.exit(1);
    }

    const evRes = await fetch(
      `${base}/v1/traces/${encodeURIComponent(chainTk)}/events?limit=100`,
      { headers: { "X-API-Key": API_KEY } },
    );
    const evJson = await evRes.json();
    if (!evRes.ok) {
      console.error("chain events failed", evRes.status, evJson);
      process.exit(1);
    }
    const evItems = evJson.items ?? [];
    const types = new Set(evItems.map((r) => r.type));
    for (const need of ["message_received", "before_model_resolve", "before_prompt_build", "llm_input", "llm_output"]) {
      if (!types.has(need)) {
        console.error("Chain slice missing type", need, "got", [...types]);
        process.exit(1);
      }
    }

    /** session_key thread vs session_id-only rows must merge (same session_id). */
    const mergeSk = `agent:smoke-merge-${Date.now()}`;
    const mergeSid = `smoke-sid-merge-${Date.now()}`;
    const mergeTr = `tr-merge-${Date.now()}`;
    const mergeRun = `run-merge-${Date.now()}`;
    const mergeIngest = await fetch(`${base}/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        events: [
          {
            event_id: `mrg-msg-${Date.now()}`,
            session_key: mergeSk,
            session_id: mergeSid,
            type: "message_received",
            payload: { content: "merge test", channel: "smoke" },
            schema_version: 1,
          },
          {
            event_id: `mrg-llm-${Date.now()}`,
            session_id: mergeSid,
            trace_root_id: mergeTr,
            run_id: mergeRun,
            type: "llm_input",
            payload: { provider: "x", model: "y", prompt: "p" },
            schema_version: 1,
          },
        ],
      }),
    });
    if (!mergeIngest.ok) {
      console.error("merge ingest failed", mergeIngest.status, await mergeIngest.text());
      process.exit(1);
    }
    const mergeEvRes = await fetch(
      `${base}/v1/traces/${encodeURIComponent(mergeSk)}/events?limit=50`,
      { headers: { "X-API-Key": API_KEY } },
    );
    const mergeEvJson = await mergeEvRes.json();
    if (!mergeEvRes.ok) {
      console.error("merge events failed", mergeEvRes.status, mergeEvJson);
      process.exit(1);
    }
    const mergeTypes = new Set((mergeEvJson.items ?? []).map((r) => r.type));
    if (!mergeTypes.has("message_received") || !mergeTypes.has("llm_input")) {
      console.error("session merge expected message_received + llm_input, got", [...mergeTypes]);
      process.exit(1);
    }

    console.log("OK — Collector ingest + list smoke passed.");
    console.log("  thread_key:", threadKey);
    console.log("  trace_root_id (event):", traceRoot);
    console.log("  event_id:", eventId);
    console.log("  message_received event_id:", msgEventId);
    console.log("  pipeline chain thread_key:", chainTk, "types:", [...types].join(", "));
    console.log("  session merge thread_key:", mergeSk, "types:", [...mergeTypes].join(", "));
  } finally {
    kill();
    await sleep(200);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
