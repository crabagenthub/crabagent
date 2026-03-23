#!/usr/bin/env node
/**
 * Merges Crabagent trace plugin into ~/.openclaw/openclaw.json (or OPENCLAW_HOME).
 * Default: --dry-run (print only). Use --write to apply (creates backup).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(repoRoot, "packages/openclaw-trace-plugin");

const args = new Set(process.argv.slice(2));
const doWrite = args.has("--write");
const openclawHome = process.env.OPENCLAW_HOME ?? path.join(process.env.HOME ?? "", ".openclaw");
const configPath = path.join(openclawHome, "openclaw.json");

const collectorBaseUrl =
  process.env.CRABAGENT_COLLECTOR_URL?.trim() || "http://127.0.0.1:8787";
const collectorApiKey = process.env.CRABAGENT_COLLECTOR_API_KEY?.trim() ?? "";

/** OpenClaw manifest id (must match openclaw.plugin.json; equals package idHint). */
const PLUGIN_ENTRY_ID = "openclaw-trace-plugin";
const LEGACY_ENTRY_IDS = ["crabagent-trace", "openclaw-trace"];

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function ensurePlugins(cfg) {
  if (!cfg.plugins || typeof cfg.plugins !== "object") {
    cfg.plugins = {};
  }
  const p = cfg.plugins;
  if (!p.load || typeof p.load !== "object") {
    p.load = {};
  }
  if (!Array.isArray(p.load.paths)) {
    p.load.paths = [];
  }
  if (!p.entries || typeof p.entries !== "object") {
    p.entries = {};
  }
  return p;
}

function main() {
  if (!fs.existsSync(pluginDir)) {
    console.error("Plugin dir missing:", pluginDir);
    process.exit(1);
  }
  const resolvedPlugin = fs.realpathSync(pluginDir);

  let cfg = {};
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      console.error("Failed to parse", configPath, e);
      process.exit(1);
    }
  } else {
    console.warn("Config file does not exist yet:", configPath);
  }

  const before = deepClone(cfg);
  const plugins = ensurePlugins(cfg);

  if (!plugins.load.paths.includes(resolvedPlugin)) {
    plugins.load.paths.push(resolvedPlugin);
  }

  if (plugins.entries) {
    for (const id of LEGACY_ENTRY_IDS) {
      if (Object.prototype.hasOwnProperty.call(plugins.entries, id)) {
        delete plugins.entries[id];
      }
    }
  }

  if (Array.isArray(plugins.allow) && plugins.allow.length > 0) {
    const filtered = plugins.allow.filter((id) => !LEGACY_ENTRY_IDS.includes(id));
    if (filtered.length !== plugins.allow.length) {
      plugins.allow = filtered;
    }
    if (!plugins.allow.includes(PLUGIN_ENTRY_ID)) {
      plugins.allow.push(PLUGIN_ENTRY_ID);
    }
  }

  const entryConfig = { collectorBaseUrl };
  if (collectorApiKey) {
    entryConfig.collectorApiKey = collectorApiKey;
  }

  plugins.entries[PLUGIN_ENTRY_ID] = {
    enabled: true,
    config: entryConfig,
  };

  const after = cfg;

  console.log("Plugin path:", resolvedPlugin);
  console.log("Collector:", collectorBaseUrl, collectorApiKey ? "(API key set)" : "(no API key)");

  if (JSON.stringify(before) === JSON.stringify(after)) {
    console.log("No changes needed — config already matches.");
    return;
  }

  console.log("\n--- merged plugins section (preview) ---");
  console.log(JSON.stringify(after.plugins, null, 2));

  if (!doWrite) {
    console.log("\nDry run. Re-run with --write to apply (backup will be created).");
    console.log("Optional env: OPENCLAW_HOME, CRABAGENT_COLLECTOR_URL, CRABAGENT_COLLECTOR_API_KEY");
    return;
  }

  if (!fs.existsSync(openclawHome)) {
    fs.mkdirSync(openclawHome, { recursive: true });
  }
  const bak = `${configPath}.bak.${Date.now()}`;
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, bak);
    console.log("Backup:", bak);
  }
  fs.writeFileSync(configPath, `${JSON.stringify(after, null, 2)}\n`, "utf8");
  console.log("Wrote:", configPath);
  console.log("\n>>> 请你本地重启 OpenClaw Gateway 使插件生效。");
}

main();
