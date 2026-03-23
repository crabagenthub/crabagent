import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi, PluginServiceContext } from "openclaw/plugin-sdk/core";
import { defaultCacheTracePath, startCacheTraceTail } from "./cache-trace-tail.js";
import { resolvePluginConfig, type CrabagentTracePluginConfig } from "./config.js";
import { EventQueue } from "./event-queue.js";
import { deriveChatTitleFromMessageMetadata } from "./chat-title.js";
import { buildEvent, inferAgentIdFromSessionKey } from "./envelope.js";
import { postIngest } from "./flush.js";
import { appendOutboxFile, drainOutboxFile, ensureDirForFile } from "./outbox.js";
import { buildContextPruneTracePayload } from "./context-prune-payload.js";
import {
  buildMemoryLayerFromHookContribution,
  buildReasoningContextBeforePrompt,
  buildReasoningContextPruneRef,
  buildReasoningLayerFromLlmInput,
  buildReasoningLayerFromLlmOutput,
  buildStateLayerFromAgentEnd,
  buildStateLayerFromToolError,
  buildTaskLayerFromMessage,
  buildTaskLayerFromSessionStart,
  buildToolLayerAfter,
  buildToolLayerBefore,
  wrapCrabagentLayers,
} from "./crabagent-layers.js";
import { MessageReceivedDeduper } from "./message-received-dedupe.js";
import { TraceState, conversationCorrelationKey } from "./trace-state.js";
import type {
  AgentCtx,
  AgentEndEvent,
  AfterToolEvent,
  BeforeModelResolveEvent,
  BeforePromptBuildEvent,
  BeforeToolEvent,
  HookContributionEvent,
  CompactionAfterEvent,
  CompactionBeforeEvent,
  LlmInputEvent,
  LlmOutputEvent,
  MessageReceivedEvent,
  SessionStartEvent,
  SubagentCtx,
  SubagentEndedEvent,
  SubagentSpawnedEvent,
} from "./types/hooks.js";

/** Must match openclaw.plugin.json id (same as npm unscoped name idHint). Avoid `openclaw/plugin-sdk/core` import — jiti can break interop. */
const PLUGIN_ID = "openclaw-trace-plugin";

const MAX_MESSAGE_TRACE_CHARS = 16_384;

function truncateTraceText(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n…[truncated ${String(s.length - max)} chars]`;
}

/** OpenClaw hooks may use `runId` or `run_id` on the event object. */
function trimRunIdFromHookPayload(ev: { runId?: unknown; run_id?: unknown }): string | undefined {
  const a = ev.runId;
  if (typeof a === "string" && a.trim().length > 0) {
    return a.trim();
  }
  const b = ev.run_id;
  if (typeof b === "string" && b.trim().length > 0) {
    return b.trim();
  }
  return undefined;
}

/** Role histogram for session messages (OpenClaw `before_prompt_build`). */
function summarizeHistoryRoles(messages: unknown): Record<string, number> {
  const roles: Record<string, number> = {};
  if (!Array.isArray(messages)) {
    return roles;
  }
  for (const m of messages) {
    if (m && typeof m === "object" && "role" in m) {
      const r = String((m as { role?: unknown }).role ?? "?");
      roles[r] = (roles[r] ?? 0) + 1;
    }
  }
  return roles;
}

export default {
  id: PLUGIN_ID,
  name: "Crabagent Trace",
  description: "Send agent lifecycle events to Crabagent Collector.",
  register(api: OpenClawPluginApi) {
    const getCfg = (): CrabagentTracePluginConfig =>
      resolvePluginConfig(api.pluginConfig as Record<string, unknown> | undefined);

    const traceState = new TraceState();
    const messageReceivedDeduper = new MessageReceivedDeduper();
    let queue: EventQueue | null = null;
    let warnedNoBaseUrl = false;

    const getQueue = (): EventQueue => {
      if (!queue) {
        queue = new EventQueue(getCfg().memoryQueueMax);
      }
      return queue;
    };

    const hookRecordingCtx = (ctx: AgentCtx) => ({
      sessionId: ctx.sessionId,
      sessionKey: ctx.sessionKey,
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      messageProvider: ctx.messageProvider,
      agentId: ctx.agentId,
    });

    /** OpenClaw always puts sessionId on llm_* events; hook ctx sometimes omits it — merge for trace_root_id. */
    const withEventSessionId = (ctx: AgentCtx, eventSessionId: string | undefined): AgentCtx => {
      if (typeof eventSessionId === "string" && eventSessionId.trim().length > 0) {
        return { ...ctx, sessionId: ctx.sessionId ?? eventSessionId };
      }
      return ctx;
    };

    const enqueue = (
      type: string,
      ctx: {
        sessionId?: string;
        sessionKey?: string;
        channelId?: string;
        conversationId?: string;
        messageProvider?: string;
        agentId?: string;
      },
      runId: string | undefined,
      payload: Record<string, unknown>,
      opts?: {
        chatTitle?: string;
        agentName?: string;
        msgId?: string;
        /** When true with `msgId`, register that id for the conversation (from `message_received`). */
        pinMsgIdToConversation?: boolean;
      },
    ) => {
      const cfg = getCfg();
      if (!traceState.shouldRecord(ctx.sessionId, ctx.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      traceState.rememberSessionKeyMapping(ctx.sessionId, ctx.sessionKey);
      const sessionKeyForTrace = traceState.effectiveSessionKey(ctx.sessionId, ctx.sessionKey);
      const traceRootId = traceState.resolveTraceRoot({
        sessionKey: sessionKeyForTrace,
        sessionId: ctx.sessionId,
        runId,
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
      });
      traceState.bindRunToTraceRoot(runId, traceRootId);
      if (sessionKeyForTrace?.trim()) {
        traceState.bindSessionKey(sessionKeyForTrace, traceRootId);
      }
      const convKey = conversationCorrelationKey({
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        sessionKey: sessionKeyForTrace,
      });
      let msgId: string | undefined;
      if (opts?.pinMsgIdToConversation && opts.msgId?.trim()) {
        msgId = opts.msgId.trim();
        traceState.registerInboundMsgId(convKey, msgId);
      } else {
        msgId = opts?.msgId?.trim() || traceState.resolveMsgIdForEvent(type, runId, convKey);
      }
      getQueue().push(
        buildEvent({
          type,
          traceRootId,
          sessionId: ctx.sessionId,
          sessionKey: sessionKeyForTrace,
          agentId: ctx.agentId,
          channelId: ctx.channelId,
          messageProvider: ctx.messageProvider,
          runId,
          chatTitle: opts?.chatTitle,
          agentName: opts?.agentName,
          msgId,
          payload,
        }),
      );
    };

    api.on("session_start", (ev: unknown, c: unknown) => {
      const event = ev as SessionStartEvent;
      const sessCtx = c as { agentId?: string } | undefined;
      const cfg = getCfg();
      if (!traceState.shouldRecord(event.sessionId, event.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      // Do not allocate trace_root here: `message_received` may have run first with only
      // sessionKey; `enqueue` uses resolveTraceRoot so sessionKey + sessionId share one root.
      enqueue(
        "session_start",
        {
          sessionId: event.sessionId,
          sessionKey: event.sessionKey,
          agentId: sessCtx?.agentId,
        },
        undefined,
        {
          resumedFrom: event.resumedFrom,
          ...wrapCrabagentLayers({
            task: buildTaskLayerFromSessionStart({ resumedFrom: event.resumedFrom }),
          }),
        },
      );
    });

    api.on("message_received", (ev: unknown, c: unknown) => {
      const event = ev as MessageReceivedEvent;
      const ctx = c as {
        sessionId?: string;
        sessionKey?: string;
        channelId?: string;
        accountId?: string;
        conversationId?: string;
        agentId?: string;
        agentName?: string;
        messageProvider?: string;
      };
      const accountIdStr =
        typeof ctx.accountId === "string" && ctx.accountId.trim() ? ctx.accountId.trim() : undefined;
      const cfg = getCfg();
      if (!traceState.shouldRecord(ctx.sessionId, ctx.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      const md =
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};
      const messageId = typeof md.messageId === "string" ? md.messageId : undefined;
      const chatTitle = deriveChatTitleFromMessageMetadata(md);
      const channelIdForTrace =
        ctx.channelId?.trim().toLowerCase() ||
        (typeof md.channelId === "string" ? md.channelId.trim().toLowerCase() : undefined);
      const fromPeer = String(event.from ?? "").trim();
      const conversationIdForTrace =
        ctx.conversationId?.trim() ||
        (typeof md.conversationId === "string" ? md.conversationId.trim() : undefined) ||
        (fromPeer.length > 0 ? fromPeer : undefined);
      const contentStr = String(event.content ?? "");
      const now = Date.now();
      if (
        messageReceivedDeduper.isDuplicate({
          now,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
          from: String(event.from ?? ""),
          content: contentStr,
          timestamp: event.timestamp,
          messageId,
        })
      ) {
        return;
      }
      const traceOpts: {
        chatTitle?: string;
        agentName?: string;
        msgId: string;
        pinMsgIdToConversation: boolean;
      } = {
        msgId: randomUUID(),
        pinMsgIdToConversation: true,
      };
      if (chatTitle) {
        traceOpts.chatTitle = chatTitle;
      }
      const agentNameRaw = typeof ctx.agentName === "string" ? ctx.agentName.trim() : "";
      if (agentNameRaw) {
        traceOpts.agentName = agentNameRaw;
      }
      enqueue(
        "message_received",
        {
          sessionId: ctx.sessionId,
          sessionKey: ctx.sessionKey,
          channelId: channelIdForTrace ?? ctx.channelId,
          conversationId: conversationIdForTrace,
          messageProvider: ctx.messageProvider,
          agentId: ctx.agentId,
        },
        undefined,
        {
          from: event.from,
          content: truncateTraceText(contentStr, MAX_MESSAGE_TRACE_CHARS),
          timestamp: event.timestamp,
          messageId,
          threadId: md.threadId,
          ...wrapCrabagentLayers({
            task: buildTaskLayerFromMessage({
              content: contentStr,
              contentMaxChars: MAX_MESSAGE_TRACE_CHARS,
              metadata: md,
              channelLabel: channelIdForTrace ?? ctx.channelId,
              messageProvider: ctx.messageProvider,
              conversationId: conversationIdForTrace ?? (fromPeer.length > 0 ? fromPeer : undefined),
              accountId: accountIdStr,
              timestamp: event.timestamp,
            }),
            state:
              md.error || md.hallucinationFlag || md.hallucination_flag
                ? {
                    kind: "message_metadata_signal",
                    errorLog:
                      typeof md.error === "string" && md.error.trim()
                        ? { message: md.error.trim() }
                        : undefined,
                    flags: {
                      hallucination: Boolean(md.hallucinationFlag ?? md.hallucination_flag),
                    },
                  }
                : undefined,
          }),
        },
        traceOpts,
      );
    });

    /**
     * Pipeline: model/provider pick happens before session messages are attached.
     * Correlates with the same trace via sessionId/sessionKey (often no run_id yet).
     */
    api.on("before_model_resolve", (ev: unknown, c: unknown) => {
      const event = ev as BeforeModelResolveEvent;
      const ctx = c as AgentCtx;
      const cfg = getCfg();
      if (!traceState.shouldRecord(ctx.sessionId, ctx.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      const p = typeof event.prompt === "string" ? event.prompt : "";
      enqueue(
        "before_model_resolve",
        hookRecordingCtx(ctx),
        undefined,
        {
          promptCharCount: p.length,
          promptPreview: truncateTraceText(p, MAX_MESSAGE_TRACE_CHARS),
        },
      );
    });

    /**
     * Pipeline: transcript + user prompt immediately before plugins inject prependContext /
     * systemPrompt fragments (memory, personal context, etc.).
     */
    api.on("before_prompt_build", (ev: unknown, c: unknown) => {
      const event = ev as BeforePromptBuildEvent;
      const ctx = c as AgentCtx;
      const cfg = getCfg();
      if (!traceState.shouldRecord(ctx.sessionId, ctx.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      const p = typeof event.prompt === "string" ? event.prompt : "";
      const messages = event.messages;
      const historyCount = Array.isArray(messages) ? messages.length : 0;
      enqueue(
        "before_prompt_build",
        hookRecordingCtx(ctx),
        undefined,
        {
          promptCharCount: p.length,
          promptPreview: truncateTraceText(p, MAX_MESSAGE_TRACE_CHARS),
          historyMessageCount: historyCount,
          historyRoleCounts: summarizeHistoryRoles(messages),
          ...wrapCrabagentLayers({
            reasoning: buildReasoningContextBeforePrompt({
              messages,
              promptPreview: truncateTraceText(p, MAX_MESSAGE_TRACE_CHARS),
              promptCharCount: p.length,
            }),
          }),
        },
      );
    });

    /**
     * One event per plugin (or tool intercept) return from modifying hooks — prepend/model/params mutations.
     * Skills packaged as plugins appear under their `pluginId`.
     */
    api.on("context_prune_applied", (ev: unknown, c: unknown) => {
      const ctx = c as AgentCtx;
      const cfg = getCfg();
      if (!traceState.shouldRecord(ctx.sessionId, ctx.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      const prunePayload = buildContextPruneTracePayload(ev);
      enqueue(
        "context_prune_applied",
        hookRecordingCtx(ctx),
        undefined,
        {
          ...prunePayload,
          ...wrapCrabagentLayers({
            reasoning: buildReasoningContextPruneRef(prunePayload),
          }),
        },
      );
    });

    api.on("hook_contribution", (ev: unknown, c: unknown) => {
      const event = ev as HookContributionEvent;
      const ctx = c as AgentCtx & { runId?: string; toolName?: string };
      const cfg = getCfg();
      if (!traceState.shouldRecord(ctx.sessionId, ctx.sessionKey, cfg.sampleRateBps)) {
        return;
      }
      const runId =
        trimRunIdFromHookPayload(ctx) ??
        trimRunIdFromHookPayload(event as { runId?: unknown; run_id?: unknown });
      enqueue(
        "hook_contribution",
        hookRecordingCtx(ctx),
        runId,
        {
          sourceHook: event.sourceHook,
          contributingPluginId: event.pluginId,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          contribution: event.contribution,
          ...wrapCrabagentLayers({
            memory: buildMemoryLayerFromHookContribution({
              sourceHook: event.sourceHook,
              pluginId: event.pluginId,
              contribution: event.contribution,
              toolName: event.toolName,
            }),
          }),
        },
      );
    });

    api.on("llm_input", (ev: unknown, c: unknown) => {
      const event = ev as LlmInputEvent;
      const eventRec = ev as Record<string, unknown>;
      const ctx = withEventSessionId(c as AgentCtx, event.sessionId);
      const beforeHook =
        typeof event.promptBeforeHookPrepend === "string" ? event.promptBeforeHookPrepend : undefined;
      const pluginPrependDeltaChars =
        beforeHook !== undefined ? Math.max(0, event.prompt.length - beforeHook.length) : 0;
      const histCount = Array.isArray(event.historyMessages) ? event.historyMessages.length : 0;
      const histRoles = summarizeHistoryRoles(event.historyMessages);
      enqueue(
        "llm_input",
        hookRecordingCtx(ctx),
        trimRunIdFromHookPayload(event),
        {
          provider: event.provider,
          model: event.model,
          prompt: truncateTraceText(event.prompt, MAX_MESSAGE_TRACE_CHARS),
          systemPrompt: event.systemPrompt
            ? truncateTraceText(event.systemPrompt, MAX_MESSAGE_TRACE_CHARS)
            : undefined,
          promptBeforeHookPrepend: beforeHook
            ? truncateTraceText(beforeHook, MAX_MESSAGE_TRACE_CHARS)
            : undefined,
          promptCharCount: event.prompt.length,
          promptBeforeHookCharCount: beforeHook?.length ?? event.prompt.length,
          pluginPrependDeltaChars,
          imagesCount: event.imagesCount,
          historyMessageCount: histCount,
          historyRoleCounts: histRoles,
          ...wrapCrabagentLayers({
            reasoning: buildReasoningLayerFromLlmInput({
              event: eventRec,
              promptTruncated: truncateTraceText(event.prompt, MAX_MESSAGE_TRACE_CHARS),
              systemPromptTruncated: event.systemPrompt
                ? truncateTraceText(event.systemPrompt, MAX_MESSAGE_TRACE_CHARS)
                : undefined,
              promptBeforeHookTruncated: beforeHook
                ? truncateTraceText(beforeHook, MAX_MESSAGE_TRACE_CHARS)
                : undefined,
              historyMessageCount: histCount,
              historyRoleCounts: histRoles,
            }),
          }),
        },
      );
    });

    api.on("llm_output", (ev: unknown, c: unknown) => {
      const event = ev as LlmOutputEvent;
      const eventRec = ev as Record<string, unknown>;
      const ctx = withEventSessionId(c as AgentCtx, event.sessionId);
      enqueue(
        "llm_output",
        hookRecordingCtx(ctx),
        trimRunIdFromHookPayload(event),
        {
          provider: event.provider,
          model: event.model,
          assistantTexts: event.assistantTexts,
          usage: event.usage,
          ...wrapCrabagentLayers({
            reasoning: buildReasoningLayerFromLlmOutput({
              event: eventRec,
              assistantTexts: Array.isArray(event.assistantTexts) ? event.assistantTexts : [],
            }),
          }),
        },
      );
    });

    api.on("agent_end", (ev: unknown, c: unknown) => {
      const event = ev as AgentEndEvent;
      const ctx = c as AgentCtx;
      enqueue(
        "agent_end",
        hookRecordingCtx(ctx),
        undefined,
        {
          success: event.success,
          error: event.error,
          durationMs: event.durationMs,
          messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
          ...wrapCrabagentLayers({
            state: buildStateLayerFromAgentEnd({
              success: event.success,
              error: typeof event.error === "string" ? event.error : undefined,
              durationMs: event.durationMs,
              messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
            }),
          }),
        },
      );
    });

    api.on("before_tool_call", (ev: unknown, c: unknown) => {
      const event = ev as BeforeToolEvent;
      const ctx = c as AgentCtx;
      enqueue(
        "before_tool_call",
        hookRecordingCtx(ctx),
        trimRunIdFromHookPayload(event),
        {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          params: event.params,
          ...wrapCrabagentLayers({
            tools: buildToolLayerBefore({
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              params: event.params,
            }),
          }),
        },
      );
    });

    api.on("after_tool_call", (ev: unknown, c: unknown) => {
      const event = ev as AfterToolEvent;
      const eventRec = ev as Record<string, unknown>;
      const ctx = c as AgentCtx;
      const errStr = typeof event.error === "string" ? event.error : undefined;
      const retryRaw = eventRec.retryCount ?? eventRec.retry_count ?? eventRec.attempt;
      const retryCount = typeof retryRaw === "number" && Number.isFinite(retryRaw) ? retryRaw : undefined;
      enqueue(
        "after_tool_call",
        hookRecordingCtx(ctx),
        trimRunIdFromHookPayload(event),
        {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          hasError: Boolean(event.error),
          durationMs: event.durationMs,
          ...wrapCrabagentLayers({
            tools: buildToolLayerAfter({
              event: eventRec,
              toolName: event.toolName,
              toolCallId: event.toolCallId,
            }),
            ...(errStr
              ? {
                  state: buildStateLayerFromToolError({
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    error: errStr,
                    durationMs: event.durationMs,
                    retryCount,
                  }),
                }
              : {}),
          }),
        },
      );
    });

    api.on("before_compaction", (ev: unknown, c: unknown) => {
      const event = ev as CompactionBeforeEvent;
      const ctx = c as AgentCtx;
      enqueue(
        "before_compaction",
        hookRecordingCtx(ctx),
        undefined,
        {
          messageCount: event.messageCount,
          compactingCount: event.compactingCount,
          sessionFile: event.sessionFile,
        },
      );
    });

    api.on("after_compaction", (ev: unknown, c: unknown) => {
      const event = ev as CompactionAfterEvent;
      const ctx = c as AgentCtx;
      enqueue(
        "after_compaction",
        hookRecordingCtx(ctx),
        undefined,
        {
          messageCount: event.messageCount,
          compactedCount: event.compactedCount,
          sessionFile: event.sessionFile,
        },
      );
    });

    api.on("subagent_spawned", (ev: unknown, c: unknown) => {
      const event = ev as SubagentSpawnedEvent;
      const ctx = c as SubagentCtx;
      const parentRoot = traceState.parentTraceRootForSubagent(ctx.requesterSessionKey, ctx.runId);
      traceState.linkChildSessionKey(event.childSessionKey, parentRoot);
      const childAgent =
        event.agentId?.trim() || inferAgentIdFromSessionKey(event.childSessionKey);
      enqueue(
        "subagent_spawned",
        { ...hookRecordingCtx(ctx), agentId: childAgent },
        trimRunIdFromHookPayload(event),
        {
          childSessionKey: event.childSessionKey,
          parentTraceRootId: parentRoot,
          label: event.label,
          mode: event.mode,
        },
      );
    });

    api.on("subagent_ended", (ev: unknown, c: unknown) => {
      const event = ev as SubagentEndedEvent;
      const ctx = c as AgentCtx;
      enqueue(
        "subagent_ended",
        hookRecordingCtx(ctx),
        trimRunIdFromHookPayload(event),
        {
          targetSessionKey: event.targetSessionKey,
          targetKind: event.targetKind,
          reason: event.reason,
          outcome: event.outcome,
        },
      );
    });

    let flushTimer: ReturnType<typeof setInterval> | undefined;
    let stopCacheTail: (() => void) | undefined;
    let serviceStopped = false;

    const handleCacheTraceLine = (obj: Record<string, unknown>) => {
      if (obj.stage !== "stream:context") {
        return;
      }
      const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : undefined;
      const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey : undefined;
      const runId = typeof obj.runId === "string" ? obj.runId : undefined;
      const cfg = getCfg();
      if (!traceState.shouldRecord(sessionId, sessionKey, cfg.sampleRateBps)) {
        return;
      }
      const model =
        obj.model && typeof obj.model === "object"
          ? (obj.model as Record<string, unknown>)
          : {};
      enqueue(
        "model_stream_context",
        { sessionId, sessionKey },
        runId,
        {
          seq: obj.seq,
          provider: obj.provider ?? model.provider,
          modelId: obj.modelId ?? model.id,
          messageCount: obj.messageCount,
          messagesDigest: obj.messagesDigest,
          systemDigest: obj.systemDigest,
          note: obj.note,
          ...wrapCrabagentLayers({
            reasoning: {
              phase: "model_stream_context",
              seq: obj.seq,
              provider: obj.provider ?? model.provider,
              modelId: obj.modelId ?? model.id,
              messageCount: obj.messageCount,
              messagesDigest: obj.messagesDigest,
              systemDigest: obj.systemDigest,
              note: obj.note,
            },
          }),
        },
      );
    };

    api.registerService({
      id: `${PLUGIN_ID}-flush`,
      start(serviceCtx: PluginServiceContext) {
        serviceStopped = false;
        const outboxPath = path.join(serviceCtx.stateDir, "crabagent", "outbox.jsonl");
        ensureDirForFile(outboxPath);

        const cfg0 = getCfg();
        if (cfg0.enableCacheTraceTail) {
          const tracePath = cfg0.cacheTracePath ?? defaultCacheTracePath(serviceCtx.stateDir);
          stopCacheTail = startCacheTraceTail({
            filePath: tracePath,
            intervalMs: cfg0.cacheTracePollMs,
            onLine: handleCacheTraceLine,
            shouldStop: () => serviceStopped,
          });
          serviceCtx.logger.info(`${PLUGIN_ID}: cache-trace tail on ${tracePath}`);
        }

        const tick = async () => {
          const cfg = getCfg();
          if (!cfg.collectorBaseUrl) {
            if (!warnedNoBaseUrl) {
              warnedNoBaseUrl = true;
              serviceCtx.logger.warn(
                `${PLUGIN_ID}: collectorBaseUrl empty; trace events are queued until configured.`,
              );
            }
            return;
          }
          const fromOutbox = drainOutboxFile(outboxPath);
          const room = Math.max(0, 200 - fromOutbox.length);
          const fromQueue = getQueue().drainBatch(room);
          const batch = [...fromOutbox, ...fromQueue] as Record<string, unknown>[];
          if (batch.length === 0) {
            return;
          }
          const result = await postIngest(cfg.collectorBaseUrl, cfg.collectorApiKey, batch);
          if (!result.ok) {
            serviceCtx.logger.warn(
              `${PLUGIN_ID}: ingest failed status=${result.status} body=${result.body.slice(0, 200)}`,
            );
            appendOutboxFile(outboxPath, batch);
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
        stopCacheTail?.();
        stopCacheTail = undefined;
        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = undefined;
        }
      },
    });
  },
};
