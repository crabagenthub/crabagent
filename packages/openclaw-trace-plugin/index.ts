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
import { deepSanitizeStrings } from "./vault-pipeline.js";
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
    const vaultStoresByRoot = new Map<string, EncryptedVaultStore>();

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
              interceptMode: typeof p.intercept_mode === "string" ? p.intercept_mode : undefined,
            });
          }
          cachedRedactionRules = rules;
          getRuntime().updateRedactionRules(rules);
          void reportPolicyPullToCollector(pulledAtMs);
        }
      } catch (err) {
        /* silent fail; Collector may be down or unauth */
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

    const pushIfAny = (b: OpikBatchPayload | null | undefined, source: string) => {
      if (b && batchNonEmpty(b)) {
        const redacted = getRuntime().redactBatch(b);
        if (serviceStartedInThisProcess) {
          getQueue().push(redacted);
        } else {
          const cfg = getCfg();
          if (cfg.collectorBaseUrl) {
            // hook 与 flush 分进程时，内存队列不可见；当前进程直接上报 collector。
            void postOpikBatch(cfg.collectorBaseUrl, cfg.collectorApiKey, redacted).catch(() => {});
          }
        }
        traceDbg("queue_push", {
          node: "memory_queue",
          source,
          ...summarizeOpikBatch(redacted),
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

    api.on("session_start", (ev: unknown) => {
      const event = ev as SessionStartEvent;
      mergePendingForCtx(
        { sessionId: event.sessionId, sessionKey: event.sessionKey },
        {
          session_start: { resumedFrom: event.resumedFrom },
        },
      );
    });

    api.on("message_received", (ev: unknown, c: unknown) => {
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

    api.on("before_model_resolve", (ev: unknown, c: unknown) => {
      const event = ev as BeforeModelResolveEvent;
      const ctx = c as AgentCtx;
      const p = typeof event.prompt === "string" ? event.prompt : "";
      mergePendingWithInboundMirror(ctx, {
        before_model_resolve: {
          promptCharCount: p.length,
          promptPreview: p.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS),
        },
      });
    });

    api.on("before_prompt_build", (ev: unknown, c: unknown) => {
      const event = ev as BeforePromptBuildEvent;
      const ctx = c as AgentCtx;
      const p = typeof event.prompt === "string" ? event.prompt : "";
      mergePendingWithInboundMirror(ctx, {
        before_prompt_build: {
          promptCharCount: p.length,
          promptPreview: p.slice(0, TRACE_PROMPT_PREVIEW_MAX_CHARS),
          historyMessageCount: Array.isArray(event.messages) ? event.messages.length : 0,
        },
      });
    });

    api.on("before_agent_start", (ev: unknown, c: unknown) => {
      const event = ev as BeforeAgentStartEvent;
      const ctx = c as AgentCtx;
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
      const sk = String(event.sessionKey ?? ctx.sessionKey ?? ctx.sessionId ?? "").trim();
      const vault = getVaultStore();
      const pro = getCfg().productTier === "pro" || process.env.CRABAGENT_PRODUCT_TIER?.trim().toLowerCase() === "pro";
      const vaultEnabled = Boolean(pro && vault && process.env.CRABAGENT_VAULT_KEY?.trim());
      const out = deepSanitizeStrings(event.message, rules as import("./vault-pipeline.js").ExtendedRedactionRule[], {
        vault,
        vaultEnabled,
      });
      if (out.block) {
        return { block: true };
      }
      if (out.shadowHits > 0) {
        getRuntime().recordShadowWouldLeak(sk || effectiveSk(ctx), out.shadowHits);
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
          prompt: event.prompt,
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
        assistantTexts: event.assistantTexts,
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
      getRuntime().onAfterTool(effectiveSk(ctx), {
        toolCallId: event.toolCallId,
        error: event.error,
        durationMs: event.durationMs,
        result: (event as Record<string, unknown>).result,
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
          `${PLUGIN_ID}: flush service started; collectorHost=${cfgAtStart.collectorBaseUrl ? collectorHostLabel(cfgAtStart.collectorBaseUrl) : "(empty — set plugins.entries config or env CRABAGENT_COLLECTOR_URL)"}; apiKey=${cfgAtStart.collectorApiKey ? "set" : "empty"}; debugHooks=${cfgAtStart.debugLogHooks}`,
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
            const toSend = getRuntime().redactBatch(merged);
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
        }, 300_000); // 5 mins
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
