#!/usr/bin/env node
/**
 * Removes Crabagent collector SQLite files (default location + legacy cwd-relative file at repo root).
 * Stop the collector first; otherwise the OS may keep an unlinked file open until the process exits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
    console.log("removed", p);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") {
      throw e;
    }
  }
}

/** @param {string} stemPath path ending in `.db` (no -wal/-shm) */
function removeSqliteTriplet(stemPath) {
  unlinkQuiet(stemPath);
  unlinkQuiet(`${stemPath}-wal`);
  unlinkQuiet(`${stemPath}-shm`);
}

const canonical = path.join(repoRoot, "services/collector", "data", "crabagent.db");
const legacyAtRepoRoot = path.join(repoRoot, "data", "crabagent.db");

console.log("Clearing collector DB files (stop collector first)…");
removeSqliteTriplet(canonical);
removeSqliteTriplet(legacyAtRepoRoot);
console.log("Done.");
