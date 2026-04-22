import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  definePluginEntry,
  type OpenClawPluginApi,
  type OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { resolvePluginConfig } from "./config.js";
import { BatchQueue } from "./event-queue.js";
import { mergeOpikBatches, postOpikBatch } from "./flush.js";
import {
  OpikOpenClawRuntime,
  TRACE_PROMPT_PREVIEW_MAX_CHARS,
  traceThreadChannelLabel,
} from "./opik-runtime.js";
import type { OpikBatchPayload } from "./opik-types.js";
import {
  extractRoutedAgentIdFromMessageMetadata,
  extractTraceBridgeKeysFromInboundMetadata,
  mirrorInboundPendingForAgents,
} from "./inbound-mirror.js";
import { stripLeadingBracketDatePrefixes } from "./strip-leading-bracket-date.js";
import {
  extractLlmInputRoutingMeta,
  mergeOpenclawRoutingLayers,
  pickLlmInputModelParams,
} from "./llm-input-routing-meta.js";
import { pickLlmOutputUsage } from "./llm-output-usage.js";
import { appendOutboxFile, drainOutboxFile, ensureDirForFile } from "./outbox.js";
import type { RedactionRule } from "./redactor.js";
import { sortRulesByPolicyPriority } from "./policy-priority.js";
import { compileRules, deepSanitizeStrings } from "./vault-pipeline.js";
import { EncryptedVaultStore } from "./vault-store.js";
import {
  resolveOpenClawSessionsBasePathForAgent,
  sessionStoreKeysForSessionId,
} from "./session-store-bridge.js";
import { extractRoutingFromOpenClawSessionStore } from "./session-store-routing.js";
import {
  agentScopedTraceKey,
  extractAgentIdFromRoutingSessionKey,
  sessionKeyImpliesSubagentSessionKey,
  traceSessionKeyCandidates,
  traceSessionKeyCandidatesForInbound,
  traceSessionKeyCandidatesForPending,
} from "./trace-session-key.js";
import type { TraceAgentCtx } from "./trace-session-key.js";
import type {
  AgentCtx,
  AgentEndEvent,
  AfterToolEvent,
  BeforeAgentStartEvent,
  BeforeModelResolveEvent,
  BeforePromptBuildEvent,
  BeforeToolEvent,
  CompactionAfterEvent,
  CompactionBeforeEvent,
  HookContributionEvent,
  LlmInputEvent,
  LlmOutputEvent,
  MessageReceivedEvent,
  SessionStartEvent,
  SubagentCtx,
  SubagentEndedEvent,
  SubagentSpawnedEvent,
} from "./types/hooks.js";

const PLUGIN_ID = "openclaw-trace-plugin";
/** 与网关 [plugins] 日志对齐的展示名（重启时一行激活说明，类似 CozeloopTrace）。 */
const PLUGIN_LOG_NAME = "[CrabagentTrace]";

/** One pending deferred non-LLM flush per primary session key (user inbound with no llm_input/agent_end). */
const deferredUserMessageFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function withEventSessionId(ctx: AgentCtx, eventSessionId: string | undefined): AgentCtx {
  if (typeof eventSessionId === "string" && eventSessionId.trim().length > 0) {
    return { ...ctx, sessionId: ctx.sessionId ?? eventSessionId };
  }
  return ctx;
}

function pickStr(a: string | undefined, b: unknown): string | undefined {
  const t = a?.trim();
  if (t) {
    return t;
  }
  if (typeof b === "string" && b.trim()) {
    return b.trim();
  }
  return undefined;
}

/** 把 `agent_end` 等事件 payload 里的会话字段并入 ctx（与 CozeLoop 侧稀疏 hookCtx 对齐）。 */
function mergeAgentEndCtx(event: AgentEndEvent, c: unknown): AgentCtx {
  const base =
    c != null && typeof c === "object" && !Array.isArray(c) ? (c as AgentCtx) : ({} as AgentCtx);
  const e = event as Record<string, unknown>;
  return {
    ...base,
    sessionId: pickStr(base.sessionId, e.sessionId),
    sessionKey: pickStr(base.sessionKey, e.sessionKey),
    conversationId: pickStr(base.conversationId, e.conversationId),
    channelId: pickStr(base.channelId, e.channelId),
    messageProvider: pickStr(base.messageProvider, e.messageProvider),
    agentId: pickStr(base.agentId, e.agentId),
    agentName: pickStr(base.agentName, e.agentName),
  };
}

/** ActiveTurn / 工具 span 主键：含非 main agent 时在键上区分 thread，避免叠到 main。 */
function effectiveSk(ctx: AgentCtx, eventFrom?: string): string {
  return agentScopedTraceKey(ctx, eventFrom);
}

/**
 * `subagent_spawned` 父会话键：OpenClaw 核心在 ctx 上给 `requesterSessionKey`（规范父键），优先于 event 扩展字段；
 * 再在 `traceSessionKeyCandidates` 中取首个「非子会话且不等于 child」的键（不依赖进程级全局 map，可并发）。
 */
function resolveSubagentParentSessionKey(
  ctx: SubagentCtx,
  event: SubagentSpawnedEvent,
  childSk: string,
): string | undefined {
  const child = childSk.trim();
  if (!child) {
    return undefined;
  }
  const fromRequester = ctx.requesterSessionKey?.trim();
  if (fromRequester && fromRequester !== child) {
    return fromRequester;
  }
  const fromPayload = event.parentSessionKey?.trim();
  if (fromPayload && fromPayload !== child) {
    return fromPayload;
  }
  for (const c of traceSessionKeyCandidates(ctx as TraceAgentCtx)) {
    const t = c.trim();
    if (!t || t === child) {
      continue;
    }
    if (sessionKeyImpliesSubagentSessionKey(t)) {
      continue;
    }
    return t;
  }
  const eff = effectiveSk(ctx as AgentCtx).trim();
  if (eff && eff !== child && !sessionKeyImpliesSubagentSessionKey(eff)) {
    return eff;
  }
  return undefined;
}

function batchNonEmpty(b: OpikBatchPayload): boolean {
  return Boolean(
    b.threads?.length ||
      b.traces?.length ||
      b.spans?.length ||
      b.attachments?.length ||
      b.feedback?.length,
  );
}

/** 上报 batch 行数与 trace 抽样（无大段 JSON）。 */
function summarizeOpikBatch(b: OpikBatchPayload): Record<string, unknown> {
  const traces = b.traces ?? [];
  const traceSample = traces.slice(0, 12).map((t) => ({
    trace_id: t.trace_id,
    thread_id: t.thread_id,
    name: t.name,
  }));
  return {
    threadRows: b.threads?.length ?? 0,
    traceRows: traces.length,
    spanRows: b.spans?.length ?? 0,
    attachmentRows: b.attachments?.length ?? 0,
    feedbackRows: b.feedback?.length ?? 0,
    traces: traceSample,
  };
}

function collectorHostLabel(baseUrl: string): string {
  try {
    const u = new URL(baseUrl.trim());
    return u.host || baseUrl.slice(0, 64);
  } catch {
    return baseUrl.slice(0, 64);
  }
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Crabagent Trace (Opik layout)",
  description: "OpenClaw hooks → opik-openclaw-shaped batches → Collector POST /v1/opik/batch.",
  register(api: OpenClawPluginApi) {
    const getCfg = () => resolvePluginConfig(api.pluginConfig as Record<string, unknown> | undefined);
    {
      const c0 = getCfg();
      const collectorEp = c0.collectorBaseUrl
        ? `${c0.collectorBaseUrl.replace(/\/+$/, "")}/v1/opik/batch`
        : "(unset — config or CRABAGENT_COLLECTOR_URL)";
      const msg = `${PLUGIN_LOG_NAME} Plugin activated (endpoint: ${collectorEp}, workspace: ${c0.opikWorkspaceName}, project: ${c0.opikProjectName}, apiKey: ${c0.collectorApiKey ? "set" : "empty"})`;
      if (api.logger?.info) {
        api.logger.info(msg);
      } else {
        console.info(`[plugins] ${msg}`);
      }
    }
    let queue: BatchQueue | null = null;
    let runtime: OpikOpenClawRuntime | null = null;
    let cachedWs = "";
    let cachedProj = "";
    /** 插件 stateDir 下的 `crabagent`，在服务 start 时赋值，用于 pending 落盘。 */
    let persistPendingRoot: string | undefined;
    let cachedPersistKey = "";
    let cachedTraceBare = true;
    let cachedDeferredRouting = true;
    let warnedNoBaseUrl = false;
    let policySyncTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * 上次从 Collector 拉取成功的脱敏规则；`OpikOpenClawRuntime` 重建时必须传入，否则 `Redactor` 会清空，
     * 在下一轮 `syncPolicies`（最多 5 分钟）之前脱敏一直不生效。
     */
    let cachedRedactionRules: RedactionRule[] = [];
    let lastPolicyWarmupAttemptMs = 0;
    const inboundHardBlocks = new Map<
      string,
      { atMs: number; replyText: string; policyIds: string[]; policyNames: string[] }
    >();
    const vaultStoresByRoot = new Map<string, EncryptedVaultStore>();

    let compiledRegexByRuleId = new Map<string, RegExp>();
    let compiledInboundHardBlockRules: Array<{
      id: string;
      name: string;
      regex: RegExp;
    }> = [];

    const rebuildCompiledPolicyCaches = (rules: readonly RedactionRule[]) => {
      const sanitizeRules = rules as import("./vault-pipeline.js").ExtendedRedactionRule[];
      compiledRegexByRuleId = compileRules(sanitizeRules);
      const hard: Array<{ id: string; name: string; regex: RegExp }> = [];
      for (const r of rules) {
        if (!r.enabled) {
          continue;
        }
        const rr = r as { policyAction?: unknown; redactType?: unknown; redact_type?: unknown };
        const redactTypeRaw = typeof rr.redactType === "string" ? rr.redactType : rr.redact_type;
        const fallbackAction =
          String(redactTypeRaw ?? "")
            .trim()
            .toLowerCase() === "block"
            ? "abort_run"
            : "data_mask";
        const action = String(rr.policyAction ?? fallbackAction)
          .trim()
          .toLowerCase();
        if (action !== "abort_run") {
          continue;
        }
        const re = compiledRegexByRuleId.get(r.id);
        if (!re) {
          continue;
        }
        hard.push({ id: r.id, name: r.name || r.id, regex: re });
      }
      compiledInboundHardBlockRules = hard;
    };

    const scanInboundForHardBlock = (
      text: string,
      rules: readonly {
        id: string;
        name: string;
        regex: RegExp;
      }[],
    ): { policyIds: string[]; policyNames: string[] } | null => {
      const t = text.trim();
      if (!t) {
        return null;
      }
      const ids: string[] = [];
      const names: string[] = [];
      for (const r of rules) {
        const re = r.regex;
        try {
          re.lastIndex = 0;
          const hit = re.test(t);
          if (hit) {
            ids.push(r.id);
            names.push(r.name);
          }
        } catch (err) {
          console.error(`[Crabagent policy] inbound hard-block scan failed rule=${r.id} name=${r.name}`, err);
        } finally {
          try {
            re.lastIndex = 0;
          } catch {
            /* ignore */
          }
        }
      }
      if (ids.length <= 0) {
        return null;
      }
      return { policyIds: ids, policyNames: names };
    };

    const setInboundHardBlock = (
      keys: readonly string[],
      payload: { replyText: string; policyIds: string[]; policyNames: string[] },
    ) => {
      const now = Date.now();
      for (const raw of keys) {
        const k = raw.trim();
        if (!k) {
          continue;
        }
        inboundHardBlocks.set(k, { atMs: now, ...payload });
      }
    };

    const pickInboundHardBlock = (keys: readonly string[]): { replyText: string; policyIds: string[]; policyNames: string[] } | null => {
      const now = Date.now();
      for (const raw of keys) {
        const k = raw.trim();
        if (!k) {
          continue;
        }
        const hit = inboundHardBlocks.get(k);
        if (!hit) {
          continue;
        }
        if (now - hit.atMs > 60_000) {
          inboundHardBlocks.delete(k);
          continue;
        }
        return { replyText: hit.replyText, policyIds: hit.policyIds, policyNames: hit.policyNames };
      }
      return null;
    };

    const resolveVaultRootDir = (): string => {
      if (persistPendingRoot?.trim()) {
        return path.join(persistPendingRoot.trim(), "vault");
      }
      const e = process.env.CRABAGENT_VAULT_STATE_DIR?.trim();
      if (e) {
        return path.join(e, "vault");
      }
      return path.join(process.cwd(), "crabagent", "vault");
    };

    const getVaultStore = (): EncryptedVaultStore | null => {
      const cfg = getCfg();
      const pro = cfg.productTier === "pro" || process.env.CRABAGENT_PRODUCT_TIER?.trim().toLowerCase() === "pro";
      if (!pro || !process.env.CRABAGENT_VAULT_KEY?.trim()) {
        return null;
      }
      const root = resolveVaultRootDir();
      let s = vaultStoresByRoot.get(root);
      if (!s) {
        s = new EncryptedVaultStore(root);
        vaultStoresByRoot.set(root, s);
      }
      return s;
    };

    const reportPolicyPullToCollector = async (pulledAtMs: number) => {
      const c = getCfg();
      if (!c.collectorBaseUrl) {
        return;
      }
      try {
        const url = `${c.collectorBaseUrl.replace(/\/+$/, "")}/v1/policies/pull-report`;
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Content-Type": "application/json",
        };
        if (c.collectorApiKey) {
          headers["X-API-Key"] = c.collectorApiKey;
          headers["Authorization"] = `Bearer ${c.collectorApiKey}`;
        }
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ pulled_at_ms: pulledAtMs }),
        });
      } catch {
        /* 与拉取列表一致：Collector 不可达时不阻塞插件 */
      }
    };

    const syncPolicies = async () => {
      const c = getCfg();
      if (!c.collectorBaseUrl) return;
      try {
        const url = `${c.collectorBaseUrl.replace(/\/+$/, "")}/v1/policies`;
        const headers: Record<string, string> = {
          "Accept": "application/json",
        };
        if (c.collectorApiKey) {
          headers["X-API-Key"] = c.collectorApiKey;
          headers["Authorization"] = `Bearer ${c.collectorApiKey}`;
        }
        const resp = await fetch(url, { headers });
        if (resp.ok) {
          const pulledAtMs = Date.now();
          const policies = (await resp.json()) as Record<string, unknown>[];
          const rules: RedactionRule[] = [];
          for (const p of policies) {
            let targets: string[] = [];
            try {
              const raw = p.targets_json;
              targets =
                typeof raw === "string" && raw.trim()
                  ? (JSON.parse(raw) as string[])
                  : Array.isArray(raw)
                    ? (raw as string[])
                    : [];
            } catch {
              targets = [];
            }
            const id = String(p.id ?? "");
            const pattern = String(p.pattern ?? "");
            if (!id || !pattern) {
              continue;
            }
            const rt = p.redact_type;
            const redactType =
              rt === "mask" || rt === "hash" || rt === "block" ? rt : "mask";
            rules.push({
              id,
              name: String(p.name ?? id),
              pattern,
              redactType,
              targets,
              enabled: p.enabled === 1 || p.enabled === true,
              severity: typeof p.severity === "string" ? p.severity : undefined,
              policyAction: typeof p.policy_action === "string" ? p.policy_action : undefined,
            });
          }
          const sortedRules = sortRulesByPolicyPriority(rules);
          cachedRedactionRules = sortedRules;
          rebuildCompiledPolicyCaches(sortedRules);
          getRuntime().updateRedactionRules(sortedRules);
          void reportPolicyPullToCollector(pulledAtMs);
        }
      } catch (err) {
        /* silent fail; Collector may be down or unauth */
      }
    };

    const ensurePoliciesWarm = async () => {
      const now = Date.now();
      if (cachedRedactionRules.length > 0) {
        return;
      }
      if (now - lastPolicyWarmupAttemptMs < 3_000) {
        return;
      }
      lastPolicyWarmupAttemptMs = now;
      try {
        await syncPolicies();
      } catch {
        /* ignore warmup failure */
      }
    };

    const getQueue = (): BatchQueue => {
      if (!queue) {
        queue = new BatchQueue(getCfg().memoryQueueMax);
      }
      return queue;
    };

    const getRuntime = (): OpikOpenClawRuntime => {
      const c = getCfg();
      const diskRoot =
        c.persistPendingToDisk !== false && persistPendingRoot?.trim() ? persistPendingRoot.trim() : undefined;
      const pkey = diskRoot ?? "";
      const traceBare = c.traceBareAgentEnds !== false;
      const defRouting = c.deferredFlushRequiresOpenClawRoutingKey;
      if (
        !runtime ||
        cachedWs !== c.opikWorkspaceName ||
        cachedProj !== c.opikProjectName ||
        cachedPersistKey !== pkey ||
        cachedTraceBare !== traceBare ||
        cachedDeferredRouting !== defRouting
      ) {
        cachedWs = c.opikWorkspaceName;
        cachedProj = c.opikProjectName;
        cachedPersistKey = pkey;
        cachedTraceBare = traceBare;
        cachedDeferredRouting = defRouting;
        runtime = new OpikOpenClawRuntime(
          cachedWs,
          cachedProj,
          {
            ...(diskRoot ? { persistPendingDir: diskRoot } : {}),
            traceBareAgentEnds: traceBare,
            deferredFlushRequiresOpenClawRoutingKey: defRouting,
            redactionRules: cachedRedactionRules,
          },
        );
      }
      return runtime;
    };

    const mergePendingForCtx = (ctx: AgentCtx, payload: Record<string, unknown>, eventFrom?: string) => {
      const rt = getRuntime();
      for (const k of traceSessionKeyCandidates(ctx, eventFrom)) {
        rt.mergePendingContext(k, payload);
      }
      if (getCfg().bridgeOpenClawSessionStore) {
        const sid = ctx.sessionId?.trim();
        if (sid) {
          const base = resolveOpenClawSessionsBasePathForAgent(api, ctx.agentId);
          if (base) {
            const fromStore = sessionStoreKeysForSessionId(base, sid);
            for (const sk of fromStore) {
              rt.mergePendingContext(sk, payload);
            }
            if (fromStore.length > 0) {
              traceDbg("session_store_bridge", {
                node: "merge_pending_session_store_keys",
                sessionId: sid,
                storeKeys: fromStore.slice(0, 8),
                storeKeyCount: fromStore.length,
              });
            }
          }
        }
      }
    };

    /** 入站往往无 agentId；子 agent LLM 走 `\\x1fagent:` 或 agent: 路由键，需镜像 pending 并靠 trace 别名对齐 feishu id。 */
    const mergePendingWithInboundMirror = (
      ctx: AgentCtx,
      payload: Record<string, unknown>,
      eventFrom?: string,
      metadata?: Record<string, unknown>,
    ) => {
      mergePendingForCtx(ctx, payload, eventFrom);
      const cfg = getCfg();
      const ids = new Set<string>(cfg.mirrorInboundPendingAgentIds);
      const inferred =
        extractAgentIdFromRoutingSessionKey(ctx.sessionKey) ??
        extractAgentIdFromRoutingSessionKey(ctx.channelId);
      if (inferred) {
        ids.add(inferred);
      }
      if (metadata) {
        const routed = extractRoutedAgentIdFromMessageMetadata(metadata);
        if (routed) {
          ids.add(routed);
        }
      }
      if (ids.size > 0) {
        mirrorInboundPendingForAgents(mergePendingForCtx, ctx, payload, eventFrom, [...ids]);
      }
    };

    const traceDbg = (phase: string, data: Record<string, unknown>) => {
      if (!getCfg().debugLogHooks) {
        return;
      }
      console.warn(`[${PLUGIN_ID}] ${phase}`, JSON.stringify(data));
    };

    /** NDJSON 诊断：`CRABAGENT_TRACE_DIAG_FILE=/abs/path/trace.ndjson`（勿提交含隐私的日志）。 */
    const appendDiag = (payload: Record<string, unknown>) => {
      const fp = process.env.CRABAGENT_TRACE_DIAG_FILE?.trim();
      if (!fp) {
        return;
      }
      try {
        mkdirSync(path.dirname(fp), { recursive: true });
        appendFileSync(fp, `${JSON.stringify({ ts: Date.now(), plugin: PLUGIN_ID, ...payload })}\n`);
      } catch {
        /* ignore */
      }
    };

    /** Collector 默认收原文以便写 security_audit_logs；`redactBeforeCollectorPost` 时与旧行为一致先脱敏再 POST。 */
    const batchForCollector = (batch: OpikBatchPayload): OpikBatchPayload => {
      if (getCfg().redactBeforeCollectorPost) {
        return getRuntime().redactBatch(batch);
      }
      return batch;
    };

    const pushIfAny = (b: OpikBatchPayload | null | undefined, source: string) => {
      if (b && batchNonEmpty(b)) {
        const payload = batchForCollector(b);
        if (serviceStartedInThisProcess) {
          getQueue().push(payload);
        } else {
          const cfg = getCfg();
          if (cfg.collectorBaseUrl) {
            // hook 与 flush 分进程时，内存队列不可见；当前进程直接上报 collector。
            void postOpikBatch(cfg.collectorBaseUrl, cfg.collectorApiKey, payload).catch(() => {});
          }
        }
        traceDbg("queue_push", {
          node: "memory_queue",
          source,
          ...summarizeOpikBatch(payload),
        });
      }
    };

    const hookCtx = (ctx: AgentCtx) => ({
      sessionId: ctx.sessionId,
      sessionKey: ctx.sessionKey,
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      messageProvider: ctx.messageProvider,
      agentId: ctx.agentId,
      agentName: ctx.agentName,
    });

    const applyInputGuardForText = (text: string): string => {
      const guardRules = (cachedRedactionRules as import("./vault-pipeline.js").ExtendedRedactionRule[]).filter(
        (r) =>
          r.enabled &&
          String(r.policyAction ?? "")
            .trim()
            .toLowerCase() === "input_guard",
      );
      if (guardRules.length <= 0 || !text.trim()) {
        return text;
      }
      const out = deepSanitizeStrings(
        text,
        guardRules,
        { vault: null, vaultEnabled: false },
        compiledRegexByRuleId,
      );
      return typeof out.value === "string" ? out.value : text;
    };

    const sanitizeToolOutput = (value: unknown): unknown => {
      const rules = (cachedRedactionRules as import("./vault-pipeline.js").ExtendedRedactionRule[]).filter((r) => {
        if (!r.enabled) {
          return false;
        }
        const targets = Array.isArray(r.targets) ? r.targets : [];
        if (!targets.includes("tool_output")) {
          return false;
        }
        const action = String(r.policyAction ?? "data_mask")
          .trim()
          .toLowerCase();
        return action !== "audit_only";
      });
      if (rules.length <= 0) {
        return value;
      }
      const out = deepSanitizeStrings(
        value,
        rules,
        { vault: getVaultStore(), vaultEnabled: false },
        compiledRegexByRuleId,
      );
      return out.value;
    };

    const sanitizeLlmOutputAssistantTexts = (value: unknown): unknown => {
      const rules = (cachedRedactionRules as import("./vault-pipeline.js").ExtendedRedactionRule[]).filter((r) => {
        if (!r.enabled) {
          return false;
        }
        const action = String(r.policyAction ?? "data_mask")
          .trim()
          .toLowerCase();
        if (action === "audit_only") {
          return false;
        }
        const targets = Array.isArray(r.targets) ? r.targets : [];
        return (
          action === "input_guard" ||
          targets.includes("assistantTexts") ||
          targets.includes("llm_output")
        );
      });
      if (rules.length <= 0) {
        return value;
      }
      const out = deepSanitizeStrings(
        value,
        rules,
        { vault: getVaultStore(), vaultEnabled: false },
        compiledRegexByRuleId,
      );
      return out.value;
    };

    const hardBlockContribution = (replyText: string, source: string, policyIds: string[], policyNames: string[]) => ({
      block: true,
      reply: replyText,
      message: replyText,
      content: replyText,
      error: `blocked_by_policy:${source}`,
      crabagent_blocked: {
        source,
        policyIds,
        policyNames,
      },
    });

    api.on("session_start", (ev: unknown) => {
      const event = ev as SessionStartEvent;
      mergePendingForCtx(
        { sessionId: event.sessionId, sessionKey: event.sessionKey },
        {
          session_start: { resumedFrom: event.resumedFrom },
        },
      );
    });

    (api as { on: (name: string, fn: (...args: unknown[]) => unknown) => void }).on("message_received", async (ev: unknown, c: unknown) => {
      const event = ev as MessageReceivedEvent;
      const ctx = c as AgentCtx;
      const md =
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};
      const inboundPayload = {
        message_received: {
          from: event.from,
          content: stripLeadingBracketDatePrefixes(String(event.content ?? "")).slice(0, 16_384),
          timestamp: event.timestamp,
          metadata: md,
        },
      };
      mergePendingWithInboundMirror(ctx, inboundPayload, event.from, md);
      for (const ek of extractTraceBridgeKeysFromInboundMetadata(md)) {
        mergePendingForCtx({ ...ctx, sessionKey: ek, sessionId: ctx.sessionId?.trim() || ek }, inboundPayload, event.from);
      }
      traceDbg("message_received", {
        node: "hook_message_received",
        agentId: ctx.agentId,
        sessionKey: effectiveSk(ctx, event.from),
        keys: traceSessionKeyCandidates(ctx, event.from),
        contentLen: String(event.content ?? "").length,
        preview: String(event.content ?? "").slice(0, 160),
      });
      const cfgNow = getCfg();
      if (cfgNow.hardBlockOnInboundMatch && cachedRedactionRules.length === 0) {
        await ensurePoliciesWarm();
      }
      if (cfgNow.hardBlockOnInboundMatch) {
        const checked = scanInboundForHardBlock(String(event.content ?? ""), compiledInboundHardBlockRules);
        if (checked) {
          const blockKeys = traceSessionKeyCandidatesForInbound(ctx, event.from);
          setInboundHardBlock(blockKeys, {
            replyText: cfgNow.hardBlockReplyText,
            policyIds: checked.policyIds,
            policyNames: checked.policyNames,
          });
          traceDbg("message_blocked", {
            node: "hook_message_received_blocked",
            sessionKey: effectiveSk(ctx, event.from),
            keys: blockKeys,
            policyIds: checked.policyIds,
            policyNames: checked.policyNames,
          });
          // message_received return contribution is observational only in current runtime.
        }
      }
      const deferKeys = traceSessionKeyCandidatesForInbound(ctx, event.from);
      const deferPrimary = effectiveSk(ctx, event.from);
      const deferMs = getCfg().deferredUserMessageFlushMs;
      if (deferMs > 0 && String(event.content ?? "").trim().length > 0) {
        const prevT = deferredUserMessageFlushTimers.get(deferPrimary);
        if (prevT) {
          clearTimeout(prevT);
        }
        const t = setTimeout(() => {
          deferredUserMessageFlushTimers.delete(deferPrimary);
          try {
            const batch = getRuntime().tryDeferredNonLlmFlush(deferKeys, hookCtx(ctx));
            pushIfAny(batch, "deferred_user_message_flush");
          } catch (err) {
            const msg = err instanceof Error ? err.stack ?? err.message : String(err);
            console.error(`[${PLUGIN_ID}] deferred_user_message_flush error: ${msg}`);
          }
        }, deferMs);
        deferredUserMessageFlushTimers.set(deferPrimary, t);
      }
    });

    (api as { on: (name: string, fn: (...args: unknown[]) => unknown) => void }).on("before_model_resolve", async (ev: unknown, c: unknown) => {
      const event = ev as BeforeModelResolveEvent;
      const ctx = c as AgentCtx;
      if (cachedRedactionRules.length === 0) {
        await ensurePoliciesWarm();
      }
      const blocked = pickInboundHardBlock(traceSessionKeyCandidates(ctx));
      void blocked;
      const p = typeof event.prompt === "string" ? event.prompt : "";
      mergePendingWithInboundMirror(ctx, {
        before_model_resolve: {
          promptCharCount: p.length,
          promptPreview: p.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS),
        },
      });
      const rewritten = applyInputGuardForText(p);
      if (rewritten !== p) {
        (event as { prompt?: unknown }).prompt = rewritten;
        return { ...event, prompt: rewritten };
      }
      return undefined;
    });

    (api as { on: (name: string, fn: (...args: unknown[]) => unknown) => void }).on("before_prompt_build", (ev: unknown, c: unknown) => {
      const event = ev as BeforePromptBuildEvent;
      const ctx = c as AgentCtx;
      const blocked = pickInboundHardBlock(traceSessionKeyCandidates(ctx));
      void blocked;
      const p = typeof event.prompt === "string" ? event.prompt : "";
      mergePendingWithInboundMirror(ctx, {
        before_prompt_build: {
          promptCharCount: p.length,
          promptPreview: p.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS),
          historyMessageCount: Array.isArray(event.messages) ? event.messages.length : 0,
        },
      });
      const rewritten = applyInputGuardForText(p);
      if (rewritten !== p) {
        (event as { prompt?: unknown }).prompt = rewritten;
        return { ...event, prompt: rewritten };
      }
      return undefined;
    });

    (api as { on: (name: string, fn: (...args: unknown[]) => unknown) => void }).on("before_agent_start", (ev: unknown, c: unknown) => {
      const event = ev as BeforeAgentStartEvent;
      const ctx = c as AgentCtx;
      const blocked = pickInboundHardBlock(traceSessionKeyCandidates(ctx));
      void blocked;
      const p = typeof event.prompt === "string" ? event.prompt : "";
      mergePendingWithInboundMirror(ctx, {
        before_agent_start: {
          promptCharCount: p.length,
          promptPreview: p.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS),
          historyMessageCount: Array.isArray(event.messages) ? event.messages.length : 0,
        },
      });
    });

    api.on("context_prune_applied", (ev: unknown, c: unknown) => {
      const ctx = c as AgentCtx;
      getRuntime().addGeneralSpan(effectiveSk(ctx), "context_prune_applied", {
        event: ev,
      });
    });

    api.on("hook_contribution", (ev: unknown, c: unknown) => {
      const event = ev as HookContributionEvent;
      const ctx = c as AgentCtx;
      getRuntime().addGeneralSpan(effectiveSk(ctx), `hook_contribution:${event.sourceHook ?? "?"}` , {
        pluginId: event.pluginId,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
      });
    });

    // OpenClaw 实际类型为同步返回 `{ message?, block? }`；stub 的 `on` 仅标注 void。
    (api as { on: (name: string, fn: (...args: unknown[]) => unknown) => void }).on(
      "before_message_write",
      (ev: unknown, c: unknown) => {
      const rules = cachedRedactionRules;
      if (!rules.length) {
        return undefined;
      }
      const event = ev as { message?: unknown; sessionKey?: string; agentId?: string };
      const ctx = c as AgentCtx & { sessionKey?: string };
      /** 必须与 `llm_input` 的 `effectiveSk(ctx)` 一致，否则影子只记在别名字段，`takeShadowWouldLeakForSession` 仍可对齐；此处优先 canonical。 */
      const sk =
        effectiveSk(ctx).trim() || String(event.sessionKey ?? ctx.sessionKey ?? ctx.sessionId ?? "").trim();
      const hardBlocked = pickInboundHardBlock([sk, ...traceSessionKeyCandidates(ctx)]);
      if (hardBlocked) {
        return hardBlockContribution(hardBlocked.replyText, "before_message_write", hardBlocked.policyIds, hardBlocked.policyNames);
      }
      // 兜底：某些通道/时序下上游钩子未先命中时，这里直接对待写消息再做一次硬拦截扫描。
      const msgText = (() => {
        const msg = event.message;
        if (typeof msg === "string") {
          return msg;
        }
        if (msg == null) {
          return "";
        }
        try {
          return JSON.stringify(msg);
        } catch {
          return String(msg);
        }
      })();
      const fallbackMatched = scanInboundForHardBlock(msgText, compiledInboundHardBlockRules);
      if (fallbackMatched) {
        const cfgNow = getCfg();
        const keys = [sk, ...traceSessionKeyCandidates(ctx)];
        setInboundHardBlock(keys, {
          replyText: cfgNow.hardBlockReplyText,
          policyIds: fallbackMatched.policyIds,
          policyNames: fallbackMatched.policyNames,
        });
        return hardBlockContribution(
          cfgNow.hardBlockReplyText,
          "before_message_write",
          fallbackMatched.policyIds,
          fallbackMatched.policyNames,
        );
      }
      const vault = getVaultStore();
      const pro = getCfg().productTier === "pro" || process.env.CRABAGENT_PRODUCT_TIER?.trim().toLowerCase() === "pro";
      const vaultEnabled = Boolean(pro && vault && process.env.CRABAGENT_VAULT_KEY?.trim());
      const out = deepSanitizeStrings(event.message, rules as import("./vault-pipeline.js").ExtendedRedactionRule[], {
        vault,
        vaultEnabled,
      }, compiledRegexByRuleId);
      if (out.block) {
        const cfgNow = getCfg();
        return hardBlockContribution(cfgNow.hardBlockReplyText, "before_message_write", [], []);
      }
      if (out.shadowHits > 0) {
        getRuntime().recordShadowWouldLeak(sk, out.shadowHits);
      }
      if (out.replacements > 0) {
        return { message: out.value };
      }
      return undefined;
    },
    );

    api.on("llm_input", (ev: unknown, c: unknown) => {
      const event = ev as LlmInputEvent;
      const ctx = withEventSessionId(c as AgentCtx, event.sessionId);
      const promptRaw = typeof event.prompt === "string" ? event.prompt : "";
      const promptSanitized = applyInputGuardForText(promptRaw);
      if (promptSanitized !== promptRaw) {
        (event as { prompt?: unknown }).prompt = promptSanitized;
      }
      const cfg = getCfg();
      const sk = effectiveSk(ctx);
      const pendingAliases = traceSessionKeyCandidatesForPending(ctx);
      const deferCancel = new Set([sk, ...pendingAliases]);
      for (const k of deferCancel) {
        const tm = deferredUserMessageFlushTimers.get(k);
        if (tm) {
          clearTimeout(tm);
          deferredUserMessageFlushTimers.delete(k);
        }
      }
      let diskRouting: Record<string, unknown> | undefined;
      if (cfg.sessionStoreRouting) {
        const bp = resolveOpenClawSessionsBasePathForAgent(api, ctx.agentId);
        const cands: string[] = [];
        const skRaw = ctx.sessionKey?.trim();
        if (skRaw) {
          cands.push(skRaw);
        }
        const ch = ctx.channelId?.trim();
        if (ch) {
          cands.push(ch);
        }
        const sid = ctx.sessionId?.trim();
        if (sid && bp) {
          cands.push(...sessionStoreKeysForSessionId(bp, sid));
        }
        diskRouting = extractRoutingFromOpenClawSessionStore(bp, cands);
      }
      const prev = getRuntime().onLlmInput(
        sk,
        {
          provider: event.provider,
          model: event.model,
          prompt: typeof event.prompt === "string" ? event.prompt : promptSanitized,
          systemPrompt: event.systemPrompt,
          imagesCount: event.imagesCount,
          sessionId: event.sessionId,
          runId: event.runId,
        },
        hookCtx(ctx),
        cfg.sampleRateBps,
        pendingAliases,
        {
          routingFromEvent: mergeOpenclawRoutingLayers(
            extractLlmInputRoutingMeta(ctx as unknown),
            diskRouting,
            extractLlmInputRoutingMeta(event as unknown),
          ),
          modelParams: pickLlmInputModelParams(event as unknown),
        },
      );
      traceDbg("llm_input", {
        node: "hook_llm_input",
        sessionKey: sk,
        pendingAliasKeys: pendingAliases,
        provider: event.provider,
        model: event.model,
        promptChars: typeof event.prompt === "string" ? event.prompt.length : 0,
        closedPriorTurnBatch: Boolean(prev && batchNonEmpty(prev)),
      });
      pushIfAny(prev, "llm_input_close_prior_turn");
    });

    api.on("llm_output", (ev: unknown, c: unknown) => {
      const event = ev as LlmOutputEvent;
      const ctx = withEventSessionId(c as AgentCtx, event.sessionId);
      const sk = effectiveSk(ctx);
      const sanitizedAssistantTexts = sanitizeLlmOutputAssistantTexts(event.assistantTexts);
      let usage: Record<string, unknown> | undefined;
      try {
        usage = pickLlmOutputUsage(event);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${PLUGIN_ID}] pickLlmOutputUsage failed: ${msg}`);
        usage = undefined;
      }
      const payload: Record<string, unknown> = {
        provider: event.provider,
        model: event.model,
        assistantTexts: sanitizedAssistantTexts,
        usage,
      };
      const um = event.usageMetadata;
      if (um && typeof um === "object" && !Array.isArray(um)) {
        payload.usageMetadata = um;
      }
      /** 延后到微任务，避免部分通道在同步 hook 链里被阻塞；逻辑仍在单线程内顺序执行。 */
      const skAliasList = traceSessionKeyCandidatesForPending(ctx);
      queueMicrotask(() => {
        try {
          traceDbg("llm_output", {
            node: "hook_llm_output",
            sessionKey: sk,
            skAliasCount: skAliasList.length,
            provider: payload.provider,
            model: payload.model,
            assistantChunks: Array.isArray(payload.assistantTexts) ? payload.assistantTexts.length : 0,
          });
          const latePatch = getRuntime().onLlmOutput(sk, payload, skAliasList);
          pushIfAny(latePatch, "llm_output_late_patch");
        } catch (err) {
          const msg = err instanceof Error ? err.stack ?? err.message : String(err);
          console.error(`[${PLUGIN_ID}] llm_output handler error: ${msg}`);
        }
      });
    });

    api.on("before_tool_call", (ev: unknown, c: unknown) => {
      const event = ev as BeforeToolEvent;
      const ctx = c as AgentCtx;
      getRuntime().onBeforeTool(effectiveSk(ctx), {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        params: event.params,
        tool_execution_mode: event.tool_execution_mode,
        toolExecution: event.toolExecution,
      });
    });

    api.on("after_tool_call", (ev: unknown, c: unknown) => {
      const event = ev as AfterToolEvent;
      const ctx = c as AgentCtx;
      const sanitizedResult = sanitizeToolOutput((event as Record<string, unknown>).result);
      getRuntime().onAfterTool(effectiveSk(ctx), {
        toolCallId: event.toolCallId,
        error: event.error,
        durationMs: event.durationMs,
        result: sanitizedResult,
      });
    });

    api.on("agent_end", (ev: unknown, c: unknown) => {
      const event = ev as AgentEndEvent;
      const ctx = mergeAgentEndCtx(event, c);
      const pendingKeys = traceSessionKeyCandidatesForPending(ctx);
      const batch = getRuntime().onAgentEnd(
        effectiveSk(ctx),
        {
          success: event.success,
          error: event.error,
          durationMs: event.durationMs,
          messages: event.messages,
        },
        hookCtx(ctx),
        pendingKeys,
      );
      traceDbg("agent_end", {
        node: "hook_agent_end",
        agentId: ctx.agentId,
        sessionKey: effectiveSk(ctx),
        keys: pendingKeys,
        messagesLen: Array.isArray(event.messages) ? event.messages.length : -1,
        message0Keys:
          Array.isArray(event.messages) &&
          event.messages[0] != null &&
          typeof event.messages[0] === "object" &&
          !Array.isArray(event.messages[0])
            ? Object.keys(event.messages[0] as object).slice(0, 16)
            : [],
        queuedNonEmptyBatch: Boolean(batch && batchNonEmpty(batch)),
      });
      pushIfAny(batch, "agent_end");
    });

    api.on("before_compaction", (ev: unknown, c: unknown) => {
      const event = ev as CompactionBeforeEvent;
      const ctx = c as AgentCtx;
      getRuntime().addGeneralSpan(effectiveSk(ctx), "before_compaction", {
        messageCount: event.messageCount,
        compactingCount: event.compactingCount,
      });
    });

    api.on("after_compaction", (ev: unknown, c: unknown) => {
      const event = ev as CompactionAfterEvent;
      const ctx = c as AgentCtx;
      getRuntime().addGeneralSpan(effectiveSk(ctx), "after_compaction", {
        messageCount: event.messageCount,
        compactedCount: event.compactedCount,
      });
    });

    api.on("subagent_spawned", (ev: unknown, c: unknown) => {
      const event = ev as SubagentSpawnedEvent;
      const ctx = c as SubagentCtx;
      const rawChildSk = event.childSessionKey?.trim();
      const childCtx: AgentCtx = {
        ...ctx,
        sessionKey: rawChildSk || ctx.sessionKey,
        agentId: event.agentId ?? ctx.agentId,
      };
      const childThreadSk = effectiveSk(childCtx).trim();
      const parentSk = childThreadSk
        ? resolveSubagentParentSessionKey(ctx, event, childThreadSk)
        : undefined;
      traceDbg("subagent_spawned", {
        rawChildSessionKey: rawChildSk ?? null,
        childThreadSk: childThreadSk || null,
        requesterSessionKey: ctx.requesterSessionKey?.trim() ?? null,
        eventParentSessionKey: event.parentSessionKey?.trim() ?? null,
        resolvedParentSessionKey: parentSk ?? null,
        anchorRegistered: Boolean(childThreadSk && parentSk),
      });
      if (childThreadSk && parentSk) {
        getRuntime().registerSubagentChildAnchor(
          parentSk,
          childThreadSk,
          traceThreadChannelLabel(ctx as AgentCtx),
        );
      } else if (childThreadSk && !parentSk) {
        traceDbg("subagent_spawned_anchor_miss", {
          childThreadSk,
          requesterSessionKey: ctx.requesterSessionKey?.trim() ?? null,
        });
      }
      getRuntime().addGeneralSpan(childThreadSk || effectiveSk(childCtx), "subagent_spawned", {
        childSessionKey: event.childSessionKey,
        label: event.label,
        mode: event.mode,
      });
    });

    api.on("subagent_ended", (ev: unknown, c: unknown) => {
      const event = ev as SubagentEndedEvent;
      const ctx = c as AgentCtx;
      const targetSk = event.targetSessionKey?.trim();
      const targetCtx: AgentCtx = {
        ...ctx,
        sessionKey: targetSk || ctx.sessionKey,
      };
      const targetThreadSk = effectiveSk(targetCtx).trim();
      if (targetThreadSk) {
        getRuntime().clearSubagentChildAnchor(targetThreadSk);
      }
      if (targetSk && targetSk !== targetThreadSk) {
        getRuntime().clearSubagentChildAnchor(targetSk);
      }
      getRuntime().addGeneralSpan(targetThreadSk || effectiveSk(targetCtx), "subagent_ended", {
        targetSessionKey: event.targetSessionKey,
        targetKind: event.targetKind,
        reason: event.reason,
        outcome: event.outcome,
      });
    });

    let flushTimer: ReturnType<typeof setInterval> | undefined;
    let serviceStopped = false;
    let serviceStartedInThisProcess = false;
    /** `gateway_start` 可能早于 flush service `start`，先记标志再补跑一次。 */
    let runFlushTick: (() => void) | undefined;
    let pendingGatewayFlush = false;

    api.on("gateway_start", () => {
      traceDbg("gateway_start", { node: "gateway_start_hook" });
      appendDiag({ event: "gateway_start" });
      if (runFlushTick) {
        runFlushTick();
      } else {
        pendingGatewayFlush = true;
      }
    });

    (api as { on: (name: string, fn: (...args: unknown[]) => unknown) => void }).on("before_agent_reply", async (ev: unknown, c: unknown) => {
      const event = ev as { cleanedBody?: unknown };
      const ctx = c as AgentCtx;
      const cfg = getCfg();
      if (cfg.hardBlockOnInboundMatch && cachedRedactionRules.length === 0) {
        await ensurePoliciesWarm();
      }
      const body = typeof event.cleanedBody === "string" ? event.cleanedBody : "";
      const matched = cfg.hardBlockOnInboundMatch ? scanInboundForHardBlock(body, compiledInboundHardBlockRules) : null;
      if (!matched) {
        return undefined;
      }
      const keys = traceSessionKeyCandidates(ctx);
      setInboundHardBlock(keys, {
        replyText: cfg.hardBlockReplyText,
        policyIds: matched.policyIds,
        policyNames: matched.policyNames,
      });
      const blockedSk = effectiveSk(ctx);
      mergePendingWithInboundMirror(ctx, {
        security_intercept_blocked: {
          source: "before_agent_reply",
          policy_ids: matched.policyIds,
          policy_names: matched.policyNames,
          handled: true,
          reply: cfg.hardBlockReplyText,
        },
      });
      getRuntime().addGeneralSpan(blockedSk, "security_intercept_blocked", {
        source: "before_agent_reply",
        policyIds: matched.policyIds,
        policyNames: matched.policyNames,
        handled: true,
      });
      const blockedBatch = getRuntime().onAgentEnd(
        blockedSk,
        {
          success: false,
          error: { code: "blocked_by_policy", policy_ids: matched.policyIds },
          durationMs: 0,
          messages: [{ role: "assistant", content: cfg.hardBlockReplyText }],
        },
        hookCtx(ctx),
        traceSessionKeyCandidatesForPending(ctx),
      );
      pushIfAny(blockedBatch, "before_agent_reply_blocked");
      return {
        handled: true,
        reply: { text: cfg.hardBlockReplyText },
        reason: `crabagent_policy_block:${matched.policyIds.join(",")}`,
      };
    });

    api.registerService({
      id: `${PLUGIN_ID}-flush`,
      start(serviceCtx: OpenClawPluginServiceContext) {
        serviceStopped = false;
        serviceStartedInThisProcess = true;
        persistPendingRoot = path.join(serviceCtx.stateDir, "crabagent");
        runtime = null;
        void getRuntime();
        const outboxPath = path.join(serviceCtx.stateDir, "crabagent", "opik-outbox.jsonl");
        ensureDirForFile(outboxPath);

        const cfgAtStart = getCfg();
        serviceCtx.logger.info(
          `${PLUGIN_ID}: flush service started; collectorHost=${cfgAtStart.collectorBaseUrl ? collectorHostLabel(cfgAtStart.collectorBaseUrl) : "(empty — set plugins.entries config or env CRABAGENT_COLLECTOR_URL)"}; apiKey=${cfgAtStart.collectorApiKey ? "set" : "empty"}; debugHooks=${cfgAtStart.debugLogHooks}; preRedactToCollector=${cfgAtStart.redactBeforeCollectorPost}`,
        );
        appendDiag({
          event: "service_start",
          collectorConfigured: Boolean(cfgAtStart.collectorBaseUrl),
          hasCollectorApiKey: Boolean(cfgAtStart.collectorApiKey),
        });

        const tick = async () => {
          try {
            const cfg = getCfg();
            if (!cfg.collectorBaseUrl) {
              if (!warnedNoBaseUrl) {
                warnedNoBaseUrl = true;
                serviceCtx.logger.warn(
                  `${PLUGIN_ID}: collectorBaseUrl empty; set openclaw.json plugins.entries.${PLUGIN_ID}.config.collectorBaseUrl or env CRABAGENT_COLLECTOR_URL. Batches stay in memory until set.`,
                );
              }
              return;
            }
            const fromOutbox = drainOutboxFile(outboxPath);
            const room = Math.max(0, 50 - fromOutbox.length);
            const fromQueue = getQueue().drainBatch(room);
            const merged = mergeOpikBatches([...fromOutbox, ...fromQueue]);
            const toSend = batchForCollector(merged);
            if (!batchNonEmpty(toSend)) {
              return;
            }
            traceDbg("flush_merge", {
              node: "pre_post_collector",
              collectorHost: collectorHostLabel(cfg.collectorBaseUrl),
              outboxBatches: fromOutbox.length,
              memQueueBatches: fromQueue.length,
              ...summarizeOpikBatch(toSend),
            });
            let result: { ok: boolean; status: number; body: string };
            try {
              result = await postOpikBatch(cfg.collectorBaseUrl, cfg.collectorApiKey, toSend);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              serviceCtx.logger.error(
                `${PLUGIN_ID}: POST /v1/opik/batch failed (network): ${msg} — writing merged batch to outbox`,
              );
              appendOutboxFile(outboxPath, [toSend]);
              traceDbg("outbox_append", {
                node: "disk_outbox_network_error",
                path: outboxPath,
                error: msg,
                ...summarizeOpikBatch(toSend),
              });
              return;
            }
            traceDbg(result.ok ? "flush_ok" : "flush_fail", {
              node: result.ok ? "collector_ingest_ok" : "collector_ingest_fail",
              httpStatus: result.status,
              collectorHost: collectorHostLabel(cfg.collectorBaseUrl),
              ...summarizeOpikBatch(toSend),
              responsePreview: result.body.slice(0, 500),
            });
            appendDiag({
              event: "flush_post",
              ok: result.ok,
              httpStatus: result.status,
              traceRows: toSend.traces?.length ?? 0,
              spanRows: toSend.spans?.length ?? 0,
            });
            if (result.ok && process.env.CRABAGENT_TRACE_FLUSH_SUMMARY?.trim() === "1") {
              serviceCtx.logger.info(
                `${PLUGIN_ID}: opik/batch ok traces=${toSend.traces?.length ?? 0} spans=${toSend.spans?.length ?? 0}`,
              );
            }
            if (!result.ok) {
              if (result.status === 401) {
                serviceCtx.logger.warn(
                  `${PLUGIN_ID}: HTTP 401 — 核对 Collector 环境变量 CRABAGENT_API_KEY 与网关 CRABAGENT_COLLECTOR_API_KEY 是否一致（Bearer）`,
                );
              }
              serviceCtx.logger.warn(
                `${PLUGIN_ID}: opik/batch failed status=${result.status} body=${result.body.slice(0, 200)}`,
              );
              appendOutboxFile(outboxPath, [toSend]);
              traceDbg("outbox_append", {
                node: "disk_outbox_retry",
                path: outboxPath,
                ...summarizeOpikBatch(toSend),
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.stack ?? err.message : String(err);
            serviceCtx.logger.error(`${PLUGIN_ID}: flush tick error: ${msg}`);
          }
        };

        runFlushTick = () => {
          void tick();
        };
        if (pendingGatewayFlush) {
          pendingGatewayFlush = false;
          void tick();
        }

        const cfg = getCfg();
        flushTimer = setInterval(() => {
          void tick();
        }, cfg.flushIntervalMs);
        void (async () => {
          await syncPolicies();
          await tick();
        })();

        policySyncTimer = setInterval(() => {
          void syncPolicies();
        }, cfg.policySyncIntervalMs);
      },
      stop() {
        serviceStopped = true;
        serviceStartedInThisProcess = false;
        void serviceStopped;
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = undefined;
        }
        if (policySyncTimer) {
          clearInterval(policySyncTimer);
          policySyncTimer = null;
        }
      },
    });
  },
});
