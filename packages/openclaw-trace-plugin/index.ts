import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi, PluginServiceContext } from "openclaw/plugin-sdk/core";
import { resolvePluginConfig } from "./config.js";
import { BatchQueue } from "./event-queue.js";
import { mergeOpikBatches, postOpikBatch } from "./flush.js";
import { OpikOpenClawRuntime, TRACE_PROMPT_PREVIEW_MAX_CHARS } from "./opik-runtime.js";
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
import {
  resolveOpenClawSessionsBasePathForAgent,
  sessionStoreKeysForSessionId,
} from "./session-store-bridge.js";
import { extractRoutingFromOpenClawSessionStore } from "./session-store-routing.js";
import {
  agentScopedTraceKey,
  extractAgentIdFromRoutingSessionKey,
  traceSessionKeyCandidates,
  traceSessionKeyCandidatesForInbound,
  traceSessionKeyCandidatesForPending,
} from "./trace-session-key.js";
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

function batchNonEmpty(b: OpikBatchPayload): boolean {
  return Boolean(
    b.threads?.length ||
      b.traces?.length ||
      b.spans?.length ||
      b.attachments?.length ||
      b.feedback?.length,
  );
}

/** 调试：上报体摘要（不含大段 JSON）。 */
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

function batchContainsDailyDigest(b: OpikBatchPayload): boolean {
  const traces = b.traces ?? [];
  for (const t of traces) {
    const tid = String(t.thread_id ?? "").toLowerCase();
    const md = t.metadata && typeof t.metadata === "object" ? JSON.stringify(t.metadata).toLowerCase() : "";
    if (tid.includes("daily_reddit_digest") || md.includes("daily_reddit_digest")) {
      return true;
    }
  }
  return false;
}

let lastDailyDigestProbeAt = 0;

function probeDailyDigest(data: Record<string, unknown>): void {
  const sid = "24bc8e";
  const marker = "daily_reddit_digest";
  const vals = [
    data.agentId,
    data.agentName,
    data.sessionKey,
    data.sessionId,
    data.threadKey,
    data.eventFrom,
  ]
    .map((v) => (typeof v === "string" ? v : ""))
    .join(" ");
  if (!vals.toLowerCase().includes(marker)) {
    return;
  }
  lastDailyDigestProbeAt = Date.now();
  // #region agent log
  fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:sid,runId:"pre-fix",hypothesisId:"D1",location:"packages/openclaw-trace-plugin/index.ts:145",message:"daily_digest_hook_probe",data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

export default {
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
    let warnedNoBaseUrl = false;

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
      if (
        !runtime ||
        cachedWs !== c.opikWorkspaceName ||
        cachedProj !== c.opikProjectName ||
        cachedPersistKey !== pkey ||
        cachedTraceBare !== traceBare
      ) {
        cachedWs = c.opikWorkspaceName;
        cachedProj = c.opikProjectName;
        cachedPersistKey = pkey;
        cachedTraceBare = traceBare;
        runtime = new OpikOpenClawRuntime(
          cachedWs,
          cachedProj,
          {
            ...(diskRoot ? { persistPendingDir: diskRoot } : {}),
            traceBareAgentEnds: traceBare,
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
        if (serviceStartedInThisProcess) {
          getQueue().push(b);
        } else {
          const cfg = getCfg();
          if (cfg.collectorBaseUrl) {
            // hook 与 flush 分进程时，内存队列不可见；当前进程直接上报 collector。
            void postOpikBatch(cfg.collectorBaseUrl, cfg.collectorApiKey, b).catch(() => {});
          }
        }
        if (batchContainsDailyDigest(b)) {
          probeDailyDigest({
            hook: "queue_push",
            source,
            traceRows: b.traces?.length ?? 0,
            spanRows: b.spans?.length ?? 0,
            threadKeys: (b.traces ?? []).slice(0, 8).map((t) => String(t.thread_id ?? "")),
          });
        }
        traceDbg("queue_push", {
          node: "memory_queue",
          source,
          ...summarizeOpikBatch(b),
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
      probeDailyDigest({
        hook: "message_received",
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        sessionId: ctx.sessionId,
        sessionKey: effectiveSk(ctx, event.from),
        eventFrom: event.from,
        contentLen: String(event.content ?? "").length,
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
      probeDailyDigest({
        hook: "llm_input",
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        sessionId: ctx.sessionId,
        sessionKey: sk,
        runId: event.runId,
        provider: event.provider,
        model: event.model,
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
      const payload = {
        provider: event.provider,
        model: event.model,
        assistantTexts: event.assistantTexts,
        usage,
      };
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
      probeDailyDigest({
        hook: "agent_end",
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        sessionId: ctx.sessionId,
        sessionKey: effectiveSk(ctx),
        queuedBatch: Boolean(batch && batchNonEmpty(batch)),
        success: event.success !== false,
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
      const childSk = event.childSessionKey?.trim();
      const childCtx: AgentCtx = {
        ...ctx,
        sessionKey: childSk || ctx.sessionKey,
        agentId: event.agentId ?? ctx.agentId,
      };
      getRuntime().addGeneralSpan(effectiveSk(childCtx), "subagent_spawned", {
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
      getRuntime().addGeneralSpan(effectiveSk(targetCtx), "subagent_ended", {
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
      start(serviceCtx: PluginServiceContext) {
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
            if (Date.now() - lastDailyDigestProbeAt <= 120_000) {
              // #region agent log
              fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"D3",location:"packages/openclaw-trace-plugin/index.ts:703",message:"flush_tick_start_near_daily_window",data:{collectorBaseUrlSet:Boolean(cfg.collectorBaseUrl),collectorHost:cfg.collectorBaseUrl?collectorHostLabel(cfg.collectorBaseUrl):"",apiKeySet:Boolean(cfg.collectorApiKey)},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
            }
            if (!cfg.collectorBaseUrl) {
              probeDailyDigest({
                hook: "flush_tick_skip",
                reason: "collector_base_url_empty",
              });
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
            if (Date.now() - lastDailyDigestProbeAt <= 120_000) {
              const qHasDaily = fromQueue.some((b) => batchContainsDailyDigest(b));
              const mHasDaily = batchContainsDailyDigest(merged);
              // #region agent log
              fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"D4",location:"packages/openclaw-trace-plugin/index.ts:719",message:"flush_drain_snapshot_near_daily_window",data:{outboxBatches:fromOutbox.length,room,queueBatches:fromQueue.length,queueHasDaily:qHasDaily,mergedTraceRows:merged.traces?.length??0,mergedSpanRows:merged.spans?.length??0,mergedHasDaily:mHasDaily},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
            }
            if (!batchNonEmpty(merged)) {
              return;
            }
            const nearDailyDigest = Date.now() - lastDailyDigestProbeAt <= 120_000;
            if (batchContainsDailyDigest(merged)) {
              probeDailyDigest({
                hook: "flush_merge",
                outboxBatches: fromOutbox.length,
                memQueueBatches: fromQueue.length,
                traceRows: merged.traces?.length ?? 0,
                spanRows: merged.spans?.length ?? 0,
                collectorHost: collectorHostLabel(cfg.collectorBaseUrl),
              });
            }
            if (nearDailyDigest) {
              // #region agent log
              fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"D2",location:"packages/openclaw-trace-plugin/index.ts:724",message:"flush_merge_near_daily_window",data:{traceRows:merged.traces?.length??0,spanRows:merged.spans?.length??0,collectorHost:collectorHostLabel(cfg.collectorBaseUrl),apiKeySet:Boolean(cfg.collectorApiKey)},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
            }
            traceDbg("flush_merge", {
              node: "pre_post_collector",
              collectorHost: collectorHostLabel(cfg.collectorBaseUrl),
              outboxBatches: fromOutbox.length,
              memQueueBatches: fromQueue.length,
              ...summarizeOpikBatch(merged),
            });
            let result: { ok: boolean; status: number; body: string };
            try {
              result = await postOpikBatch(cfg.collectorBaseUrl, cfg.collectorApiKey, merged);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              serviceCtx.logger.error(
                `${PLUGIN_ID}: POST /v1/opik/batch failed (network): ${msg} — writing merged batch to outbox`,
              );
              appendOutboxFile(outboxPath, [merged]);
              traceDbg("outbox_append", {
                node: "disk_outbox_network_error",
                path: outboxPath,
                error: msg,
                ...summarizeOpikBatch(merged),
              });
              return;
            }
            if (batchContainsDailyDigest(merged)) {
              probeDailyDigest({
                hook: "flush_post_result",
                ok: result.ok,
                status: result.status,
                bodyPreview: result.body.slice(0, 180),
              });
            }
            if (nearDailyDigest) {
              // #region agent log
              fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"24bc8e"},body:JSON.stringify({sessionId:"24bc8e",runId:"pre-fix",hypothesisId:"D2",location:"packages/openclaw-trace-plugin/index.ts:760",message:"flush_post_near_daily_window",data:{ok:result.ok,status:result.status,bodyPreview:result.body.slice(0,220)},timestamp:Date.now()})}).catch(()=>{});
              // #endregion
            }
            traceDbg(result.ok ? "flush_ok" : "flush_fail", {
              node: result.ok ? "collector_ingest_ok" : "collector_ingest_fail",
              httpStatus: result.status,
              collectorHost: collectorHostLabel(cfg.collectorBaseUrl),
              ...summarizeOpikBatch(merged),
              responsePreview: result.body.slice(0, 500),
            });
            appendDiag({
              event: "flush_post",
              ok: result.ok,
              httpStatus: result.status,
              traceRows: merged.traces?.length ?? 0,
              spanRows: merged.spans?.length ?? 0,
            });
            if (result.ok && process.env.CRABAGENT_TRACE_FLUSH_SUMMARY?.trim() === "1") {
              serviceCtx.logger.info(
                `${PLUGIN_ID}: opik/batch ok traces=${merged.traces?.length ?? 0} spans=${merged.spans?.length ?? 0}`,
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
              appendOutboxFile(outboxPath, [merged]);
              traceDbg("outbox_append", {
                node: "disk_outbox_retry",
                path: outboxPath,
                ...summarizeOpikBatch(merged),
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
        void tick();
      },
      stop() {
        serviceStopped = true;
        serviceStartedInThisProcess = false;
        void serviceStopped;
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = undefined;
        }
      },
    });
  },
};
