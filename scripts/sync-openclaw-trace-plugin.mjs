#!/usr/bin/env node
/**
 * 将本仓库 `packages/openclaw-trace-plugin/` 同步到 OpenClaw `plugins.load.paths` 指向的目录，
 * 避免 Cursor worktree（如 ivj）与 `~/www/crabagent` 两套路径代码不一致。
 *
 * 用法:
 *   pnpm run sync:trace-plugin
 *   pnpm run sync:trace-plugin -- --to /abs/path/to/openclaw-trace-plugin
 *
 * 默认目标: $CRABAGENT_TRACE_PLUGIN_SYNC_TARGET 或 ~/www/crabagent/packages/openclaw-trace-plugin
 * 需要系统有 `rsync`（macOS / 多数 Linux 自带）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = path.join(repoRoot, "packages/openclaw-trace-plugin");

const argv = process.argv.slice(2);
let to = process.env.CRABAGENT_TRACE_PLUGIN_SYNC_TARGET?.trim() ?? "";
const i = argv.indexOf("--to");
if (i >= 0 && argv[i + 1]) {
  to = path.resolve(argv[i + 1].trim());
}
if (!to) {
  to = path.join(process.env.HOME ?? "", "www/crabagent/packages/openclaw-trace-plugin");
}

if (!fs.existsSync(path.join(src, "index.ts"))) {
  console.error("sync-openclaw-trace-plugin: source missing:", src);
  process.exit(1);
}

const parent = path.dirname(to);
if (!fs.existsSync(parent)) {
  console.error("sync-openclaw-trace-plugin: parent of target does not exist:", parent);
  process.exit(1);
}

const rsync = spawnSync(
  "rsync",
  ["-a", "--delete", "--exclude=node_modules", `${src}/`, `${to}/`],
  { stdio: "inherit" },
);

if (rsync.error?.code === "ENOENT") {
  console.error("sync-openclaw-trace-plugin: `rsync` not found. Install rsync or copy manually.");
  process.exit(1);
}

if (rsync.status !== 0) {
  process.exit(rsync.status ?? 1);
}

console.log("sync-openclaw-trace-plugin: ok");
console.log(" ", src);
console.log("→", to);
