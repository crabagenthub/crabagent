import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenClawPluginApi, PluginLogger, PluginServiceContext } from "openclaw/plugin-sdk/core";
import plugin from "./index.js";

describe("openclaw-trace-plugin register()", () => {
  it("emits [CrabagentTrace] Plugin activated and Flush service started via logger.info", () => {
    const infos: string[] = [];
    const logger: PluginLogger = {
      info: (m: string) => {
        infos.push(m);
      },
      warn: () => {},
      error: () => {},
    };

    const api: OpenClawPluginApi = {
      pluginConfig: {
        collectorBaseUrl: "http://127.0.0.1:9999",
      },
      logger,
      on: () => {},
      registerService: (svc) => {
        const ctx: PluginServiceContext = {
          stateDir: "/tmp/crabagent-plugin-smoke-state",
          logger,
        };
        svc.start(ctx);
      },
    };

    plugin.register(api);

    assert.ok(infos.some((w) => w.includes("[CrabagentTrace] Plugin activated")));
    assert.ok(infos.some((w) => w.includes("[CrabagentTrace] Flush service started")));
  });
});
