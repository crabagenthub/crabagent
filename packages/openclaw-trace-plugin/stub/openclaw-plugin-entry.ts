/**
 * Build-time stub for `openclaw/plugin-sdk/plugin-entry`.
 * At runtime OpenClaw resolves the real module from its install.
 * Keep this surface aligned with OpenClaw ≥2026.4 `plugin-entry` exports used by this plugin.
 */

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type OpenClawPluginServiceContext = {
  logger: PluginLogger;
  stateDir: string;
};

/** Subset of host-injected API sufficient for hook + service registration (see OpenClaw `OpenClawPluginApi`). */
export type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger?: PluginLogger;
  on: (hook: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
  registerService: (svc: {
    id: string;
    start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
    stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  }) => void;
  runtime?: { resolvePath?: (rel: string) => string };
  config?: { agents?: { defaults?: { workspace?: string } } };
};

type DefinePluginEntryOptions = {
  id: string;
  name: string;
  description: string;
  register: (api: OpenClawPluginApi) => void | Promise<void>;
};

export function definePluginEntry(def: DefinePluginEntryOptions): DefinePluginEntryOptions {
  return def;
}
