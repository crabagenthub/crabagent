import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  OpenClawPluginApi,
  OpenClawPluginServiceContext,
  PluginLogger,
} from "openclaw/plugin-sdk/plugin-entry";
import plugin from "./index.js";

describe("openclaw-trace-plugin register()", () => {
  it("flush service start 打 logger.info（含插件 id）", () => {
    const infos: string[] = [];
    const logger: PluginLogger = {
      info: (m: string) => {
        infos.push(m);
      },
      warn: () => {},
      error: () => {},
    };

    const api = {
      pluginConfig: {
        collectorBaseUrl: "http://127.0.0.1:9999",
      },
      logger,
      on: () => {},
      registerService: (svc: {
        start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
      }) => {
        const ctx: OpenClawPluginServiceContext = {
          stateDir: "/tmp/crabagent-plugin-smoke-state",
          logger,
        };
        svc.start(ctx);
      },
    } satisfies Pick<OpenClawPluginApi, "pluginConfig" | "logger" | "on" | "registerService">;

    plugin.register(api as OpenClawPluginApi);

    assert.ok(infos.some((w) => w.includes("[CrabagentTrace] Plugin activated")));
    assert.ok(infos.some((w) => w.includes("openclaw-trace-plugin: flush service started")));
  });
});
