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
  /** 策略拉取轮询间隔（毫秒）。默认 30000；环境变量 `CRABAGENT_POLICY_SYNC_INTERVAL_MS` 可覆盖。 */
  policySyncIntervalMs: number;
  memoryQueueMax: number;
  sampleRateBps: number;
  /** Opik workspace（与 opik-openclaw 一致，默认 default）。 */
  opikWorkspaceName: string;
  /** Opik project（默认 openclaw）。 */
  opikProjectName: string;
  /**
   * 调试日志开关。默认开启；`debugLogHooks: false` 或 `CRABAGENT_TRACE_DEBUG_HOOKS=0`（或 `false` / `no`）可关闭。
   * 开启后经 `console.warn` 打印 `[openclaw-trace-plugin]` hook / queue / flush 等摘要。
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
  /**
   * 用户 `message_received` 有正文后，若此时间内仍未因 `llm_input` / `agent_end` 消费 pending，则补发一条 non-LLM trace（避免仅工具/早退路径零上报）。
   * `0` 关闭。默认 3000；环境变量 `CRABAGENT_TRACE_DEFERRED_USER_FLUSH_MS` 可覆盖（网关未合并 config 时可用）。
   */
  deferredUserMessageFlushMs: number;
  /**
   * 为 true（默认）时：延迟 flush 仅在 ctx 或候选键中已存在父级 `agent:…` OpenClaw 路由 sessionKey 时上报，并用 canonical 键作 `thread_id`；
   * 避免纯 `feishu/oc_…` 等与后续 LLM 的 `agent:…:feishu:group:oc_…` 重复成两条会话。
   * 设为 false 或环境变量 `CRABAGENT_TRACE_DEFERRED_FLUSH_ALLOW_WITHOUT_ROUTING=1` 可恢复旧行为。
   */
  deferredFlushRequiresOpenClawRoutingKey: boolean;
  /**
   * 读 OpenClaw `agents/main/sessions/sessions.json`，按 `ctx.sessionId` 把 pending 同步 merge 到 store 里的 `sessionKey`（对齐 coze-openclaw-plugin 会话路径）。
   * 缓解 `message_received` / LLM hook 使用不同键时 pending 取不到。环境变量 `CRABAGENT_TRACE_NO_SESSION_STORE_BRIDGE=1` 关闭。
   */
  bridgeOpenClawSessionStore: boolean;
  /**
   * 在 `llm_input` 时读 `agents/<agentId>/sessions/sessions.json`，把 SessionEntry 中的 label / 档位 / tokens 等并入 `openclaw_routing`（OpenClaw 未在 hook 载荷中带会话快照时仍可对齐控制台）。
   * 环境变量 `CRABAGENT_TRACE_NO_SESSION_STORE_ROUTING=1` 关闭。
   */
  sessionStoreRouting: boolean;
  /**
   * 产品档位：`basic` 无 Vault 可逆；`pro` 需配合环境变量 `CRABAGENT_VAULT_KEY` 启用 Vault。
   * 环境变量 `CRABAGENT_PRODUCT_TIER=pro|basic` 可覆盖。
   */
  productTier: "basic" | "pro";
  /**
   * 为 true 时在 POST Collector **之前**对 batch 做插件侧脱敏（旧行为）。默认 false：上报原文，由 Collector
   * 先跑 `security_audit_logs` 正则扫描再 `applyIngestPolicyRedaction` 落库；否则 Collector 收不到明文，审计表永远无命中。
   * 合规要求「出站即脱敏」时设为 true 或环境变量 `CRABAGENT_TRACE_REDACT_BEFORE_COLLECTOR=1`。
   */
  redactBeforeCollectorPost: boolean;
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
  const policySyncIntervalMs =
    typeof c.policySyncIntervalMs === "number" && Number.isFinite(c.policySyncIntervalMs)
      ? Math.max(5000, Math.floor(c.policySyncIntervalMs))
      : (() => {
          const raw = process.env.CRABAGENT_POLICY_SYNC_INTERVAL_MS?.trim();
          if (raw && Number.isFinite(Number(raw))) {
            return Math.max(5000, Math.floor(Number(raw)));
          }
          return 30_000;
        })();
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
  const envDebugTriState = (name: string): boolean | null => {
    const v = process.env[name]?.trim().toLowerCase();
    if (v === "0" || v === "false" || v === "no") {
      return false;
    }
    if (v === "1" || v === "true" || v === "yes") {
      return true;
    }
    return null;
  };
  const envHooks = envDebugTriState("CRABAGENT_TRACE_DEBUG_HOOKS");
  const envLegacy = envDebugTriState("CRABAGENT_TRACE_DEBUG");
  /** 环境显式指定优先；否则与 Cozeloop `debug` 习惯对齐。 */
  const debugFromEnv: boolean | null =
    envHooks !== null ? envHooks : envLegacy !== null ? envLegacy : null;
  /** 默认 true；仅配置或环境显式关闭时关。 */
  const debugLogHooks =
    c.debugLogHooks === false || c.debug === false
      ? false
      : c.debugLogHooks === true || c.debug === true
        ? true
        : debugFromEnv === false
          ? false
          : debugFromEnv === true
            ? true
            : true;
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
  const deferredEnvRaw = process.env.CRABAGENT_TRACE_DEFERRED_USER_FLUSH_MS?.trim();
  const deferredFromEnv =
    deferredEnvRaw !== undefined && deferredEnvRaw !== "" && Number.isFinite(Number(deferredEnvRaw))
      ? Math.max(0, Math.floor(Number(deferredEnvRaw)))
      : undefined;
  const deferredUserMessageFlushMs =
    typeof c.deferredUserMessageFlushMs === "number" && Number.isFinite(c.deferredUserMessageFlushMs)
      ? Math.max(0, Math.floor(c.deferredUserMessageFlushMs))
      : (deferredFromEnv ?? 3000);
  const deferredFlushRequiresOpenClawRoutingKey =
    typeof c.deferredFlushRequiresOpenClawRoutingKey === "boolean"
      ? c.deferredFlushRequiresOpenClawRoutingKey
      : !truthyEnv("CRABAGENT_TRACE_DEFERRED_FLUSH_ALLOW_WITHOUT_ROUTING");
  const bridgeOpenClawSessionStore =
    c.bridgeOpenClawSessionStore !== false && !truthyEnv("CRABAGENT_TRACE_NO_SESSION_STORE_BRIDGE");
  const sessionStoreRouting =
    c.sessionStoreRouting !== false && !truthyEnv("CRABAGENT_TRACE_NO_SESSION_STORE_ROUTING");
  const tierEnv = process.env.CRABAGENT_PRODUCT_TIER?.trim().toLowerCase();
  const productTier: "basic" | "pro" =
    tierEnv === "pro" || c.productTier === "pro"
      ? "pro"
      : "basic";
  const redactBeforeCollectorPost =
    c.redactBeforeCollectorPost === true || truthyEnv("CRABAGENT_TRACE_REDACT_BEFORE_COLLECTOR");
  return {
    collectorBaseUrl: base,
    collectorApiKey: key,
    flushIntervalMs,
    policySyncIntervalMs,
    memoryQueueMax,
    sampleRateBps,
    opikWorkspaceName,
    opikProjectName,
    debugLogHooks,
    persistPendingToDisk,
    traceBareAgentEnds,
    inboundHookInfoLogs,
    mirrorInboundPendingAgentIds,
    deferredUserMessageFlushMs,
    deferredFlushRequiresOpenClawRoutingKey,
    bridgeOpenClawSessionStore,
    sessionStoreRouting,
    productTier,
    redactBeforeCollectorPost,
  };
}
