import type { AgentCtx } from "./types/hooks.js";

/**
 * OpenClaw `message_received` 的 plugin ctx 往往只有 channelId/conversationId，没有 sessionKey/agentId；
 * 子 agent 的 `llm_input` 却带 `agentId` + `agent:<id>:…` sessionKey。仅在「渠道基键」上 merge pending 时，
 * `traceSessionKeyCandidates` 不会生成与 LLM 侧一致的 `\x1fagent:<id>` 别名，导致 pending 对不上、整轮零上报。
 *
 * 在每条入站消息上，按配置的 agent id 列表（及 metadata 里可能携带的路由 id）再 merge 一遍相同 payload，
 * 使 `deriveTraceAgentId` 生效，从同一组 channel 基键展开出 agent 作用域别名。
 */
export function mirrorInboundPendingForAgents(
  mergePendingForCtx: (ctx: AgentCtx, payload: Record<string, unknown>, eventFrom?: string) => void,
  ctx: AgentCtx,
  payload: Record<string, unknown>,
  eventFrom: string | undefined,
  agentIds: string[],
): void {
  const seen = new Set<string>();
  for (const raw of agentIds) {
    const a = raw.trim();
    if (!a || a.toLowerCase() === "main" || seen.has(a)) {
      continue;
    }
    seen.add(a);
    mergePendingForCtx({ ...ctx, agentId: a }, payload, eventFrom);
  }
}

/** 从 OpenClaw 或通道塞进的 metadata 里猜路由 agent（向前兼容，字段名随版本可能变化）。 */
export function extractRoutedAgentIdFromMessageMetadata(md: Record<string, unknown>): string | undefined {
  const pick = (k: string) => {
    const v = md[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const nested = md.openclaw ?? md.openClaw;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const o = nested as Record<string, unknown>;
    const fromNested =
      (typeof o.agentId === "string" && o.agentId.trim() ? o.agentId.trim() : undefined) ??
      (typeof o.agent_id === "string" && o.agent_id.trim() ? o.agent_id.trim() : undefined);
    if (fromNested) {
      return fromNested;
    }
  }
  return (
    pick("agentId") ??
    pick("openclawAgentId") ??
    pick("routingAgentId") ??
    pick("targetAgentId") ??
    pick("sessionAgentId") ??
    pick("defaultAgentId") ??
    pick("resolvedAgentId")
  );
}

/** 把 metadata 里的会话相关字符串并入 pending 键，缓解 message_received 早于完整 ctx、仅 feishu 桶有数而 llm 只有 sessionId 的情况。 */
export function extractTraceBridgeKeysFromInboundMetadata(md: Record<string, unknown>): string[] {
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const cand: Array<string | undefined> = [
    pick(md.sessionKey),
    pick(md.session_key),
    pick(md.sessionId),
    pick(md.session_id),
    pick(md.conversationId),
    pick(md.conversation_id),
    pick(md.channelId),
    pick(md.channel_id),
    pick(md.threadId),
    pick(md.thread_id),
  ];
  const nested = md.openclaw ?? md.openClaw;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const o = nested as Record<string, unknown>;
    cand.push(
      pick(o.sessionKey),
      pick(o.session_key),
      pick(o.sessionId),
      pick(o.session_id),
      pick(o.channelId),
      pick(o.channel_id),
    );
  }
  return [...new Set(cand.filter((x): x is string => Boolean(x)))];
}
