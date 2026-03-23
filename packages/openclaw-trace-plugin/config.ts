export type CrabagentTracePluginConfig = {
  collectorBaseUrl: string;
  collectorApiKey: string;
  flushIntervalMs: number;
  memoryQueueMax: number;
  sampleRateBps: number;
  cacheTracePath?: string;
  /** When true, tail OpenClaw cache-trace.jsonl for per-model stream:context lines. */
  enableCacheTraceTail: boolean;
  cacheTracePollMs: number;
};

export function resolvePluginConfig(raw: Record<string, unknown> | undefined): CrabagentTracePluginConfig {
  const c = raw ?? {};
  const base =
    typeof c.collectorBaseUrl === "string" ? c.collectorBaseUrl.trim() : "";
  const key =
    typeof c.collectorApiKey === "string" ? c.collectorApiKey.trim() : "";
  const flushIntervalMs =
    typeof c.flushIntervalMs === "number" && Number.isFinite(c.flushIntervalMs)
      ? Math.max(200, Math.floor(c.flushIntervalMs))
      : 2000;
  const memoryQueueMax =
    typeof c.memoryQueueMax === "number" && Number.isFinite(c.memoryQueueMax)
      ? Math.max(100, Math.floor(c.memoryQueueMax))
      : 10_000;
  const sampleRateBps =
    typeof c.sampleRateBps === "number" && Number.isFinite(c.sampleRateBps)
      ? Math.min(10_000, Math.max(0, Math.floor(c.sampleRateBps)))
      : 10_000;
  const cacheTracePath =
    typeof c.cacheTracePath === "string" && c.cacheTracePath.trim().length > 0
      ? c.cacheTracePath.trim()
      : undefined;
  const enableCacheTraceTail =
    typeof c.enableCacheTraceTail === "boolean" ? c.enableCacheTraceTail : true;
  const cacheTracePollMs =
    typeof c.cacheTracePollMs === "number" && Number.isFinite(c.cacheTracePollMs)
      ? Math.max(200, Math.floor(c.cacheTracePollMs))
      : 750;
  return {
    collectorBaseUrl: base,
    collectorApiKey: key,
    flushIntervalMs,
    memoryQueueMax,
    sampleRateBps,
    cacheTracePath,
    enableCacheTraceTail,
    cacheTracePollMs,
  };
}
