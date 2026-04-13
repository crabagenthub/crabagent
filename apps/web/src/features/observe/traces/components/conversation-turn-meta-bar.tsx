"use client";

import type { TraceTimelineEvent } from "@/features/observe/traces/components/trace-timeline-tree";
import { usageFromTracePayload } from "@/lib/trace-payload-usage";
import { cn } from "@/lib/utils";

function payloadOf(e: TraceTimelineEvent): Record<string, unknown> {
  const p = e.payload;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

function coalesceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim().replace(/%$/, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * OpenClaw `grouped-render.ts` fmtTokens：≥1M 用 `M`，≥1k 用 `k`。
 */
export function fmtTokensOpenClaw(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function explicitContextPercentFromPayload(p: Record<string, unknown>): number | null {
  const normalizePct = (n: number) => {
    const v = n >= 0 && n <= 1 ? n * 100 : n;
    return Math.max(0, Math.min(100, Math.round(v)));
  };

  const tryRecord = (o: Record<string, unknown>): number | null => {
    for (const k of [
      "context_percent",
      "contextPercent",
      "context_pct",
      "ctx_percent",
      "contextUtilization",
      "totalContextUsedPercent",
    ]) {
      const raw = o[k];
      const n = coalesceNumber(raw);
      if (n != null) {
        return normalizePct(n);
      }
    }
    return null;
  };

  for (const top of ["context_percent", "contextPercent", "ctx_percent"] as const) {
    const n = coalesceNumber(p[top]);
    if (n != null) {
      return normalizePct(n);
    }
  }

  const u = p.usage;
  if (u && typeof u === "object" && !Array.isArray(u)) {
    const hit = tryRecord(u as Record<string, unknown>);
    if (hit != null) {
      return hit;
    }
  }
  const um = p.usageMetadata;
  if (um && typeof um === "object" && !Array.isArray(um)) {
    const hit = tryRecord(um as Record<string, unknown>);
    if (hit != null) {
      return hit;
    }
  }
  return null;
}

/** OpenClaw UI：`session.contextTokens` 缺失时的兜底窗口（与 grouped-render 外缘一致）。 */
export function inferContextWindowTokens(modelRaw: string | null | undefined): number {
  const m = (modelRaw ?? "").toLowerCase();
  if (/minimax|m2\.|abab/.test(m)) {
    return 200_000;
  }
  if (/claude-3\.5|claude-3-7|claude-sonnet|claude-opus|claude-3-opus/.test(m)) {
    return 200_000;
  }
  if (/gpt-4o|gpt-4-turbo|o1|o3|o4|gpt-5/.test(m)) {
    return 128_000;
  }
  if (/gpt-3\.5|gpt-35/.test(m)) {
    return 16_385;
  }
  if (/gemini-1\.5|gemini-2|gemini-2\.5/.test(m)) {
    return 1_000_000;
  }
  if (/deepseek/.test(m)) {
    return 128_000;
  }
  return 200_000;
}

function pickContextWindowFromPayload(p: Record<string, unknown>): number | null {
  for (const k of ["context_window_tokens", "contextTokens", "context_tokens", "max_context_tokens"]) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.trunc(v);
    }
  }
  return null;
}

/**
 * OpenClaw `extractGroupMeta`: `contextPercent = contextWindow && input > 0 ? min(round(input/contextWindow*100),100) : null`
 */
function contextPercentOpenClaw(promptTokens: number, contextWindow: number | null): number | null {
  if (!contextWindow || contextWindow <= 0 || promptTokens <= 0) {
    return null;
  }
  return Math.min(Math.round((promptTokens / contextWindow) * 100), 100);
}

function shortModelLabel(modelRaw: string): string {
  const t = modelRaw.trim();
  if (!t) {
    return t;
  }
  return t.includes("/") ? (t.split("/").pop() ?? t) : t;
}

/** 与 OpenClaw `toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })` 一致。 */
export function formatTimeOpenClawStyle(isoOrMs: string | number | null | undefined): string {
  if (isoOrMs == null) {
    return "—";
  }
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(String(isoOrMs));
  if (!Number.isFinite(d.getTime())) {
    return "—";
  }
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * 会话详情对话列表：每条助手/tool 气泡下的一行（严格对齐 OpenClaw `grouped-render` footer）。
 * - `tool` 分组：固定 "Tool"
 * - `assistant` 分组：会话级 `sessionAssistantName`，缺省为 "Assistant"（与 `opts.assistantName ?? "Assistant"` 一致）
 */
export function ConversationTurnMetaBar({
  sourceEvent,
  modelLabel,
  footerGroupRole,
  sessionAssistantName,
  compact,
  className,
}: {
  sourceEvent: TraceTimelineEvent;
  modelLabel: string | null;
  /** OpenClaw `normalizeRoleForGrouping` 后的分组角色。 */
  footerGroupRole: "assistant" | "tool";
  /** 会话级展示名；仅 `footerGroupRole === "assistant"` 时使用。 */
  sessionAssistantName: string | null;
  compact?: boolean;
  className?: string;
}) {
  const p = payloadOf(sourceEvent);
  const u = usageFromTracePayload(p);
  const timeStr = formatTimeOpenClawStyle(sourceEvent.client_ts ?? sourceEvent.created_at ?? null);
  const rawModel =
    modelLabel?.trim() ||
    (typeof p.model === "string" && p.model.trim() ? p.model.trim() : null) ||
    null;
  const modelPill = rawModel && rawModel !== "gateway-injected" ? shortModelLabel(rawModel) : null;
  const who =
    footerGroupRole === "tool" ? "Tool" : (sessionAssistantName?.trim() || "Assistant");
  const ctxWindow = pickContextWindowFromPayload(p) ?? (modelPill ? inferContextWindowTokens(modelPill) : null);
  const ctxPct =
    explicitContextPercentFromPayload(p) ?? contextPercentOpenClaw(u.prompt, ctxWindow);
  const showTok = u.prompt > 0 || u.completion > 0;

  return (
    <div
      className={cn(
        "mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-neutral-500 dark:text-neutral-400",
        compact ? "text-[11px] leading-tight" : "text-xs leading-tight",
        className,
      )}
    >
      <span className="font-medium text-neutral-600 dark:text-neutral-300">{who}</span>
      <span>{timeStr}</span>
      {showTok ? (
        <>
          <span>↑{fmtTokensOpenClaw(u.prompt)}</span>
          <span>↓{fmtTokensOpenClaw(u.completion)}</span>
        </>
      ) : null}
      {ctxPct != null ? <span>{ctxPct}% ctx</span> : null}
      {modelPill ? (
        <span className="rounded-md bg-neutral-200/90 px-1.5 py-0.5 font-mono text-[10px] font-normal text-neutral-800 dark:bg-neutral-700/80 dark:text-neutral-100">
          {modelPill}
        </span>
      ) : null}
    </div>
  );
}
