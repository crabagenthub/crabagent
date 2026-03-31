import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  resolveOpenClawSessionsBasePath,
  sessionStoreKeysForSessionId,
} from "./session-store-bridge.js";

describe("session-store-bridge", () => {
  it("resolveOpenClawSessionsBasePath 使用 runtime.resolvePath", () => {
    const base = "/tmp/oc-sessions";
    const p = resolveOpenClawSessionsBasePath({
      runtime: { resolvePath: () => base },
    });
    assert.equal(p, base);
  });

  it("resolveOpenClawSessionsBasePath 回落 OPENCLAW_STATE_DIR", () => {
    const prev = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = "/state/x";
    try {
      const p = resolveOpenClawSessionsBasePath({});
      assert.equal(p, path.join("/state/x", "agents/main/sessions"));
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = prev;
      }
    }
  });

  it("sessionStoreKeysForSessionId 按 entry.sessionId 反查 store 键", () => {
    const dir = path.join(os.tmpdir(), `crab-ssb-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const store = {
      "agent:email:auto:feishu:x": { sessionId: "sid-99", sessionFile: "/f.jsonl" },
      other: { sessionId: "other-id" },
    };
    writeFileSync(path.join(dir, "sessions.json"), JSON.stringify(store), "utf8");
    const keys = sessionStoreKeysForSessionId(dir, "sid-99");
    assert.deepEqual(keys, ["agent:email:auto:feishu:x"]);
  });
});
