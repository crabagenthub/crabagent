/** 防止配置成 `.../v1/opik/batch` 时与客户端拼接路径重复导致 404。 */
export function normalizeCollectorBaseUrl(url: string): string {
  const t = url.trim();
  if (!t) {
    return "";
  }
  let u = t.replace(/\/+$/, "");
  u = u.replace(/\/v1\/opik\/batch$/i, "");
  return u.replace(/\/+$/, "");
}

export type CrabagentTracePluginConfig = {
  collectorBaseUrl: string;
  collectorApiKey: string;
  flushIntervalMs: number;
  memoryQueueMax: number;
  sampleRateBps: number;
  /** Opik workspace（与 opik-openclaw 一致，默认 default）。 */
  opikWorkspaceName: string;
  /** Opik project（默认 openclaw）。 */
  opikProjectName: string;
  /**
   * 调试日志开关。**不要依赖 openclaw.json**：多数部署下该键无法传到插件或会被校验拒绝。
   * 请用环境变量 `CRABAGENT_TRACE_DEBUG_HOOKS=1`（或 `true` / `yes`）开启；若配置里能合并进 `debugLogHooks: true` 也会生效。
   * 开启后经 `api.logger.info` 打印 hook / queue / flush 等（见 openclaw.plugin.json）。
   */
  debugLogHooks: boolean;
  /**
   * 将未消费的 pending 写入插件 stateDir（`crabagent/pending/*.json`），网关崩溃或未触发 agent_end 时下次启动可恢复并上报。
   * 设为 false 可避免落盘敏感正文（仅内存队列）。
   */
  persistPendingToDisk: boolean;
  /**
   * 无可用用户正文 / before_* 时仍在 `agent_end` 写一条占位 trace（定时扫描、非逾期目标、纯系统回合等），与 CozeLoop 等 core 仍出 span 的行为对齐。
   * 设为 false 则仅在有 message_received / before_* / 可解析 transcript 时入库。
   */
  traceBareAgentEnds: boolean;
  /**
   * 为 false 时关闭 `session_start` / `message_received` 上固定的 `logger.info` 行（默认打开）。
   * 环境变量：`CRABAGENT_TRACE_NO_INBOUND_INFO=1` 等价于关闭。
   */
  inboundHookInfoLogs: boolean;
  /**
   * `message_received` 时除默认 ctx 外，再按这些 agent id 各 merge 一遍 pending（生成 `\\x1fagent:<id>` 别名）。
   * 解决 OpenClaw 入站 hook 不带 `agentId` 时子 agent 与 LLM 键不一致。环境变量：`CRABAGENT_TRACE_MIRROR_AGENT_IDS=id1,id2`。
   */
  mirrorInboundPendingAgentIds: string[];
};

export function resolvePluginConfig(raw: Record<string, unknown> | undefined): CrabagentTracePluginConfig {
  const c = raw ?? {};
  const baseCfg = typeof c.collectorBaseUrl === "string" ? c.collectorBaseUrl.trim() : "";
  const baseEnv = process.env.CRABAGENT_COLLECTOR_URL?.trim() ?? "";
  /** 配置优先；为空时用环境变量（网关未把 openclaw.json 合并进插件 config 时常见）。 */
  const base = normalizeCollectorBaseUrl(baseCfg || baseEnv);
  const keyCfg = typeof c.collectorApiKey === "string" ? c.collectorApiKey.trim() : "";
  const keyEnv = process.env.CRABAGENT_COLLECTOR_API_KEY?.trim() ?? "";
  const key = keyCfg || keyEnv;
  const flushIntervalMs =
    typeof c.flushIntervalMs === "number" && Number.isFinite(c.flushIntervalMs)
      ? Math.max(200, Math.floor(c.flushIntervalMs))
      : 1000;
  const memoryQueueMax =
    typeof c.memoryQueueMax === "number" && Number.isFinite(c.memoryQueueMax)
      ? Math.max(100, Math.floor(c.memoryQueueMax))
      : 10_000;
  const sampleRateBps =
    typeof c.sampleRateBps === "number" && Number.isFinite(c.sampleRateBps)
      ? Math.min(10_000, Math.max(0, Math.floor(c.sampleRateBps)))
      : 10_000;
  const opikWorkspaceName =
    typeof c.opikWorkspaceName === "string" && c.opikWorkspaceName.trim().length > 0
      ? c.opikWorkspaceName.trim()
      : "default";
  const opikProjectName =
    typeof c.opikProjectName === "string" && c.opikProjectName.trim().length > 0
      ? c.opikProjectName.trim()
      : "openclaw";
  const debugFromEnv = (() => {
    const v = process.env.CRABAGENT_TRACE_DEBUG_HOOKS?.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") {
      return true;
    }
    // 与 @cozeloop/openclaw-cozeloop-trace 的 COZELOOP_DEBUG 类习惯对齐（可选）
    const v2 = process.env.CRABAGENT_TRACE_DEBUG?.trim().toLowerCase();
    return v2 === "1" || v2 === "true" || v2 === "yes";
  })();
  /**
   * `debugLogHooks` / `debug`（与 Cozeloop 插件的 `debug` 同名）任一为 true，或环境变量开启。
   * `c.debugLogHooks` 仅在网关把该项合并进插件 config 时有效（openclaw.json 常不可靠）。
   */
  const debugLogHooks =
    c.debugLogHooks === true || c.debug === true || debugFromEnv;
  const persistPendingToDisk = c.persistPendingToDisk !== false;
  const traceBareAgentEnds = c.traceBareAgentEnds !== false;
  const truthyEnv = (name: string) => {
    const v = process.env[name]?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  };
  const inboundHookInfoLogs =
    c.inboundHookInfoLogs !== false && !truthyEnv("CRABAGENT_TRACE_NO_INBOUND_INFO");
  const fromCfgMirror = Array.isArray(c.mirrorInboundPendingAgentIds)
    ? c.mirrorInboundPendingAgentIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const fromEnvMirror =
    process.env.CRABAGENT_TRACE_MIRROR_AGENT_IDS?.split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const mirrorInboundPendingAgentIds = [...new Set([...fromCfgMirror, ...fromEnvMirror])];
  return {
    collectorBaseUrl: base,
    collectorApiKey: key,
    flushIntervalMs,
    memoryQueueMax,
    sampleRateBps,
    opikWorkspaceName,
    opikProjectName,
    debugLogHooks,
    persistPendingToDisk,
    traceBareAgentEnds,
    inboundHookInfoLogs,
    mirrorInboundPendingAgentIds,
  };
}
