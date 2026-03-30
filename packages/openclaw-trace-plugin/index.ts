import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi, PluginServiceContext } from "openclaw/plugin-sdk/core";
import { resolvePluginConfig } from "./config.js";
import { BatchQueue } from "./event-queue.js";
import { mergeOpikBatches, postOpikBatch } from "./flush.js";
import { OpikOpenClawRuntime, TRACE_PROMPT_PREVIEW_MAX_CHARS } from "./opik-runtime.js";
import type { OpikBatchPayload } from "./opik-types.js";
import { extractRoutedAgentIdFromMessageMetadata, mirrorInboundPendingForAgents } from "./inbound-mirror.js";
import { pickLlmOutputUsage } from "./llm-output-usage.js";
import { appendOutboxFile, drainOutboxFile, ensureDirForFile } from "./outbox.js";
import {
  agentScopedTraceKey,
  extractAgentIdFromRoutingSessionKey,
  traceSessionKeyCandidates,
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

export default {
  id: PLUGIN_ID,
  name: "Crabagent Trace (Opik layout)",
  description: "OpenClaw hooks → opik-openclaw-shaped batches → Collector POST /v1/opik/batch.",
  register(api: OpenClawPluginApi) {
    const getCfg = () => resolvePluginConfig(api.pluginConfig as Record<string, unknown> | undefined);
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
        getQueue().push(b);
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
      mergePendingWithInboundMirror(
        ctx,
        {
          message_received: {
            from: event.from,
            content: String(event.content ?? "").slice(0, 16_384),
            timestamp: event.timestamp,
            metadata: md,
          },
        },
        event.from,
        md,
      );
      traceDbg("message_received", {
        node: "hook_message_received",
        agentId: ctx.agentId,
        sessionKey: effectiveSk(ctx, event.from),
        keys: traceSessionKeyCandidates(ctx, event.from),
        contentLen: String(event.content ?? "").length,
        preview: String(event.content ?? "").slice(0, 160),
      });
      // #region agent log
      fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "24bc8e" },
        body: JSON.stringify({
          sessionId: "24bc8e",
          hypothesisId: "H4",
          location: "openclaw-trace-plugin/index.ts:message_received",
          message: "hook message_received fired",
          data: {
            agentId: ctx.agentId,
            agentName: ctx.agentName,
            from: event.from,
            sessionKeyHead: effectiveSk(ctx, event.from).slice(0, 64),
            contentLen: String(event.content ?? "").length,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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
      // #region agent log
      fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "24bc8e" },
        body: JSON.stringify({
          sessionId: "24bc8e",
          hypothesisId: "H7",
          location: "openclaw-trace-plugin/index.ts:llm_input entry",
          message: "hook llm_input invoked (before onLlmInput)",
          data: {
            agentId: ctx.agentId,
            agentName: ctx.agentName,
            sessionKeyHead: sk.slice(0, 64),
            sampleRateBps: cfg.sampleRateBps,
            provider: event.provider,
            model: event.model,
            promptChars: typeof event.prompt === "string" ? event.prompt.length : 0,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const prev = getRuntime().onLlmInput(
        sk,
        {
          provider: event.provider,
          model: event.model,
          prompt: event.prompt,
          systemPrompt: event.systemPrompt,
          imagesCount: event.imagesCount,
          sessionId: event.sessionId,
        },
        hookCtx(ctx),
        cfg.sampleRateBps,
        traceSessionKeyCandidates(ctx),
      );
      traceDbg("llm_input", {
        node: "hook_llm_input",
        sessionKey: sk,
        pendingAliasKeys: traceSessionKeyCandidates(ctx),
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
      const payload = {
        provider: event.provider,
        model: event.model,
        assistantTexts: event.assistantTexts,
        usage,
      };
      /** 延后到微任务，避免部分通道在同步 hook 链里被阻塞；逻辑仍在单线程内顺序执行。 */
      const skAliasList = traceSessionKeyCandidates(ctx);
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
          // #region agent log
          fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "24bc8e" },
            body: JSON.stringify({
              sessionId: "24bc8e",
              runId: "llm-output-alias-lookup",
              hypothesisId: "H6",
              location: "openclaw-trace-plugin/index.ts:llm_output",
              message: "llm_output after onLlmOutput",
              data: {
                primarySkHead: sk.slice(0, 48),
                aliasCount: skAliasList.length,
                latePatchQueued: Boolean(latePatch && batchNonEmpty(latePatch)),
                hasUsage: payload.usage != null,
                assistantN: Array.isArray(payload.assistantTexts) ? payload.assistantTexts.length : -1,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
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
      const pendingKeys = traceSessionKeyCandidates(ctx);
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
      // #region agent log
      fetch("http://127.0.0.1:7342/ingest/45ba6de0-4f15-4d47-9000-fc5a8d9d6812", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "24bc8e" },
        body: JSON.stringify({
          sessionId: "24bc8e",
          hypothesisId: "H7",
          location: "openclaw-trace-plugin/index.ts:agent_end",
          message: "hook agent_end",
          data: {
            agentId: ctx.agentId,
            agentName: ctx.agentName,
            sessionKeyHead: effectiveSk(ctx).slice(0, 64),
            success: event.success,
            messagesLen: Array.isArray(event.messages) ? event.messages.length : -1,
            queuedNonEmptyBatch: Boolean(batch && batchNonEmpty(batch)),
            traceRows: batch?.traces?.length ?? 0,
            spanRows: batch?.spans?.length ?? 0,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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

    api.registerService({
      id: `${PLUGIN_ID}-flush`,
      start(serviceCtx: PluginServiceContext) {
        serviceStopped = false;
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
            if (!batchNonEmpty(merged)) {
              return;
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

        const cfg = getCfg();
        flushTimer = setInterval(() => {
          void tick();
        }, cfg.flushIntervalMs);
        void tick();
      },
      stop() {
        serviceStopped = true;
        void serviceStopped;
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = undefined;
        }
      },
    });
  },
};
