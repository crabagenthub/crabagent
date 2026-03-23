/**
 * Build-time stub only. At runtime OpenClaw resolves `openclaw/plugin-sdk/core` from its own install.
 */

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
};

export type PluginServiceContext = {
  logger: PluginLogger;
  /** OpenClaw plugin state directory (per agent / install). */
  stateDir: string;
};

export type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  on: (hook: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
  registerService: (svc: {
    id: string;
    start: (ctx: PluginServiceContext) => void | Promise<void>;
    stop?: (ctx: PluginServiceContext) => void | Promise<void>;
  }) => void;
};

export type PluginEntry = {
  id: string;
  name: string;
  description?: string;
  register: (api: OpenClawPluginApi) => void | Promise<void>;
};

export function definePluginEntry(def: PluginEntry): PluginEntry {
  return def;
}
