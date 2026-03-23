#!/usr/bin/env node
/**
 * Self-test: Collector GET /v1/dev/events/query (used by Dev DB query page).
 * Requires a running Collector; uses id_min=1 as a safe filter when DB non-empty.
 * Exit 0 on success; non-zero on failure or unreachable.
 */
const base = (process.env.CRABAGENT_COLLECTOR_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const key = process.env.CRABAGENT_API_KEY?.trim() ?? "";

async function main() {
  const headers = {};
  if (key) {
    headers["x-api-key"] = key;
    headers.authorization = `Bearer ${key}`;
  }

  const noFilter = await fetch(`${base}/v1/dev/events/query?limit=1`);
  const noFilterBody = await noFilter.text();
  if (noFilter.status !== 400 || !noFilterBody.includes("at_least_one_filter")) {
    console.error("Expected 400 at_least_one_filter when no filters; got", noFilter.status, noFilterBody.slice(0, 200));
    process.exit(1);
  }

  const ok = await fetch(`${base}/v1/dev/events/query?id_min=1&limit=3`);
  const okBody = await ok.json().catch(() => null);
  if (!ok.ok) {
    console.error("Query with id_min=1 failed:", ok.status, JSON.stringify(okBody));
    process.exit(1);
  }
  if (!okBody?.ok || !Array.isArray(okBody.items)) {
    console.error("Unexpected JSON shape:", okBody);
    process.exit(1);
  }
  if (okBody.items.length > 0) {
    const row = okBody.items[0];
    const required = ["id", "event_id", "type", "payload_json"];
    const missing = required.filter((k) => !(k in row));
    if (missing.length > 0) {
      console.error("First row missing columns:", missing, "keys:", Object.keys(row));
      process.exit(1);
    }
  }

  const omit = await fetch(`${base}/v1/dev/events/query?id_min=1&limit=1&omit_payload=1`, { headers });
  const omitBody = await omit.json().catch(() => null);
  if (!omit.ok) {
    console.error("omit_payload query failed:", omit.status, omitBody);
    process.exit(1);
  }
  if (omitBody.items?.length && !("payload_json_length" in omitBody.items[0])) {
    console.error("omit_payload row should have payload_json_length:", omitBody.items[0]);
    process.exit(1);
  }

  console.log("verify-dev-db-query: OK", { base, rowsSample: okBody.items.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
