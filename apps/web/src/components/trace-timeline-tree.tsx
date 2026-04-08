"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { JsonHighlightedBlock } from "@/components/json-highlighted-block";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { MessageHint } from "@/components/message-hint";
import { TraceCrabagentLayersPanel } from "@/components/trace-crabagent-layers-panel";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { eventRunId } from "@/lib/trace-event-run-id";
import { parseCrabagentPayload } from "@/lib/trace-crabagent-layers";
import { cn, formatShortId } from "@/lib/utils";

export type TraceTimelineEvent = {
  id?: number;
  event_id?: string;
  trace_root_id?: string | null;
  /** `opik_traces.thread_id`（子 agent 会话与主会话可能不同）。 */
  thread_id?: string | null;
  session_id?: string | null;
  session_key?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  chat_title?: string | null;
  run_id?: string | null;
  /** Same id on message_received and correlated hooks (plugin). */
  msg_id?: string | null;
  /** Collector 从 trace metadata 拷贝，用于 subagent / 异步等判别（不必依赖 message_received payload）。 */
  run_kind?: string | null;
  /** `opik_traces.trace_type`（system / external / subagent / async_command 等），与 run_kind 互补。 */
  trace_type?: string | null;
  /** 异步跟进 trace（如钉钉）：会话列表合并到主命令展示。 */
  async_command?: boolean | null;
  channel?: string | null;
  /** 服务端可能为 ISO 字符串、epoch 毫秒数字、或数字字符串 */
  client_ts?: string | number | null;
  type?: string;
  payload?: unknown;
  created_at?: string | number | null;
  started_at_ms?: number | null;
  ended_at_ms?: number | null;
  updated_at_ms?: number | null;
  duration_ms?: number | null;
};

function rowNumericId(e: TraceTimelineEvent): number {
  const n = e.id;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  return Number.MAX_SAFE_INTEGER;
}

function sortChronological(events: TraceTimelineEvent[]): TraceTimelineEvent[] {
  return [...events].sort((a, b) => {
    const da = rowNumericId(a);
    const db = rowNumericId(b);
    if (da !== db) {
      return da - db;
    }
    const ta = String(a.client_ts ?? a.created_at ?? "");
    const tb = String(b.client_ts ?? b.created_at ?? "");
    return ta.localeCompare(tb);
  });
}

function firstEventId(list: TraceTimelineEvent[]): number {
  let m = Number.MAX_SAFE_INTEGER;
  for (const e of list) {
    m = Math.min(m, rowNumericId(e));
  }
  return m;
}

function shortRunLabel(runId: string): string {
  return formatShortId(runId);
}

function shortKeyLabel(s: string): string {
  return formatShortId(s);
}

function formatRoleCounts(roles: Record<string, number>): string {
  const entries = Object.entries(roles).sort(([a], [b]) => a.localeCompare(b));
  return entries.length > 0 ? entries.map(([k, v]) => `${k}:${v}`).join(", ") : "—";
}

function numStr(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

type ParsedPruneChange = {
  index: number;
  role: string;
  toolName?: string;
  charsBefore: number;
  charsAfter: number;
  charDelta: number;
  phase: string;
};

function parseContextPruneMessageChanges(raw: unknown): ParsedPruneChange[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ParsedPruneChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const o = item as Record<string, unknown>;
    const index = o.index;
    if (typeof index !== "number" || !Number.isFinite(index)) {
      continue;
    }
    const role = typeof o.role === "string" && o.role.trim() ? o.role.trim() : "?";
    const toolName =
      typeof o.toolName === "string" && o.toolName.trim() ? o.toolName.trim() : undefined;
    const charsBefore =
      typeof o.charsBefore === "number" && Number.isFinite(o.charsBefore) ? o.charsBefore : 0;
    const charsAfter =
      typeof o.charsAfter === "number" && Number.isFinite(o.charsAfter) ? o.charsAfter : 0;
    const charDelta =
      typeof o.charDelta === "number" && Number.isFinite(o.charDelta) ? o.charDelta : charsAfter - charsBefore;
    const phaseRaw = typeof o.phase === "string" && o.phase.trim() ? o.phase.trim() : "unknown";
    out.push({ index, role, toolName, charsBefore, charsAfter, charDelta, phase: phaseRaw });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

function formatCharDelta(d: number): string {
  if (!Number.isFinite(d)) {
    return "—";
  }
  if (d > 0) {
    return `+${d}`;
  }
  return String(d);
}

const CONTEXT_PRUNE_DETAILS_EXPAND_THRESHOLD = 8;

function contextPruneDetailLevel(p: Record<string, unknown>): string | undefined {
  const tp = p.tracePlugin;
  if (!tp || typeof tp !== "object" || Array.isArray(tp)) {
    return undefined;
  }
  const level = (tp as Record<string, unknown>).detailLevel;
  return typeof level === "string" ? level : undefined;
}

function ContextPruneAppliedPipelineBlock({ p }: { p: Record<string, unknown> }) {
  const t = useTranslations("Traces");
  const changes = useMemo(() => parseContextPruneMessageChanges(p.messageChanges), [p.messageChanges]);
  const truncated = p.messageChangesTruncated === true;
  const aggregateOnly = contextPruneDetailLevel(p) === "aggregate_only";
  const [detailsOpen, setDetailsOpen] = useState(() => changes.length <= CONTEXT_PRUNE_DETAILS_EXPAND_THRESHOLD);

  const phaseLabel = (phase: string) => {
    if (phase === "soft_trim") {
      return t("contextPrunePhaseSoftTrim");
    }
    if (phase === "hard_clear") {
      return t("contextPrunePhaseHardClear");
    }
    return t("contextPrunePhaseUnknown");
  };

  return (
    <div className="mt-1 space-y-2">
      <MessageHint
        className="text-xs"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-4"
        text={t("pipelineContextPrune", {
          mode: String(p.mode ?? "—"),
          before: numStr(p.messageCountBefore),
          after: numStr(p.messageCountAfter),
          cBefore: numStr(p.estimatedCharsBefore),
          cAfter: numStr(p.estimatedCharsAfter),
          delta: numStr(p.charDelta),
        })}
      />
      {changes.length === 0 && aggregateOnly ? (
        <MessageHint
          className="text-[11px]"
          textClassName="text-[11px] leading-snug text-ca-muted/90"
          clampClass="line-clamp-3"
          text={t("pipelineContextPruneAggregateHint")}
        />
      ) : null}
      {changes.length > 0 ? (
        <details
          className="rounded-lg border border-border/80 bg-neutral-50/60 text-xs text-neutral-800"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none px-2 py-1.5 font-medium text-ca-muted hover:bg-neutral-100/80">
            {t("pipelineContextPruneChangesTitle", { count: String(changes.length) })}
            {truncated ? <span className="ml-2 font-normal text-amber-700">· …</span> : null}
          </summary>
          <div className="border-t border-border/60 px-1 pb-2 pt-1">
            {truncated ? (
              <div className="mb-2 px-1">
                <MessageHint
                  textClassName="text-[11px] leading-snug text-amber-800"
                  clampClass="line-clamp-3"
                  text={t("pipelineContextPruneChangesTruncated")}
                />
              </div>
            ) : null}
            <div className="max-h-[min(14rem,35vh)] overflow-auto rounded-md border border-border/50 bg-white/90">
              <table className="w-full border-collapse text-left text-[10px] leading-tight">
                <thead className="sticky top-0 z-[1] bg-neutral-100/95 text-[9px] uppercase tracking-wide text-ca-muted">
                  <tr>
                    <th className="whitespace-nowrap px-1.5 py-1 font-semibold">{t("contextPruneColIndex")}</th>
                    <th className="whitespace-nowrap px-1.5 py-1 font-semibold">{t("contextPruneColRole")}</th>
                    <th className="whitespace-nowrap px-1.5 py-1 font-semibold">{t("contextPruneColTool")}</th>
                    <th className="whitespace-nowrap px-1.5 py-1 font-semibold">{t("contextPruneColPhase")}</th>
                    <th className="whitespace-nowrap px-1.5 py-1 text-right font-semibold">
                      {t("contextPruneColBefore")}
                    </th>
                    <th className="whitespace-nowrap px-1.5 py-1 text-right font-semibold">
                      {t("contextPruneColAfter")}
                    </th>
                    <th className="whitespace-nowrap px-1.5 py-1 text-right font-semibold">
                      {t("contextPruneColDelta")}
                    </th>
                  </tr>
                </thead>
                <tbody className="text-neutral-800">
                  {changes.map((row) => (
                    <tr
                      key={`${row.index}-${row.role}-${row.toolName ?? ""}`}
                      className="border-t border-border/40 odd:bg-neutral-50/50"
                    >
                      <td className="whitespace-nowrap px-1.5 py-1 tabular-nums">{row.index}</td>
                      <td className="max-w-[5rem] truncate px-1.5 py-1" title={row.role}>
                        {row.role}
                      </td>
                      <td className="max-w-[6rem] truncate px-1.5 py-1" title={row.toolName ?? ""}>
                        {row.toolName ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1">{phaseLabel(row.phase)}</td>
                      <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{row.charsBefore}</td>
                      <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{row.charsAfter}</td>
                      <td
                        className={`whitespace-nowrap px-1.5 py-1 text-right tabular-nums ${
                          row.charDelta < 0 ? "text-emerald-800" : row.charDelta > 0 ? "text-rose-800" : ""
                        }`}
                      >
                        {formatCharDelta(row.charDelta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

const PIPELINE_PHASE_KEYS = {
  message_received: "phaseUserMessage",
  session_start: "phaseSessionStart",
  before_model_resolve: "phaseBeforeModelResolve",
  before_prompt_build: "phaseBeforePromptBuild",
  hook_contribution: "phaseHookContribution",
  context_prune_applied: "phaseContextPrune",
  model_stream_context: "phaseModelStreamContext",
  llm_input: "phaseLlmInput",
  llm_output: "phaseLlmOutput",
  before_tool_call: "phaseToolCall",
  after_tool_call: "phaseToolResult",
  agent_end: "phaseAgentEnd",
  before_compaction: "phaseCompactionBefore",
  after_compaction: "phaseCompactionAfter",
  subagent_spawned: "phaseSubagentSpawned",
  subagent_ended: "phaseSubagentEnded",
} as const;

type PipelinePhaseMsgKey = (typeof PIPELINE_PHASE_KEYS)[keyof typeof PIPELINE_PHASE_KEYS];

function pipelinePhaseKey(eventType: string | undefined): PipelinePhaseMsgKey | null {
  if (!eventType) {
    return null;
  }
  return (PIPELINE_PHASE_KEYS as Record<string, PipelinePhaseMsgKey>)[eventType] ?? null;
}

function TraceEventPipelineSummary({
  eventType,
  payload,
}: {
  eventType?: string;
  payload: unknown;
}) {
  const t = useTranslations("Traces");
  if (!eventType) {
    return null;
  }
  const p =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  if (eventType === "model_stream_context") {
    return (
      <MessageHint
        className="mt-1"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-4"
        text={t("pipelineModelStreamContext", {
          seq: numStr(p.seq),
          msgs: numStr(p.messageCount),
          provider: String(p.provider ?? "—"),
          model: String(p.modelId ?? "—"),
        })}
      />
    );
  }

  if (eventType === "before_model_resolve") {
    return (
      <MessageHint
        className="mt-1"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-4"
        text={t("pipelineBeforeModelResolve", { chars: numStr(p.promptCharCount) })}
      />
    );
  }
  if (eventType === "before_prompt_build") {
    const rc = p.historyRoleCounts;
    const rolesStr =
      rc && typeof rc === "object" && !Array.isArray(rc)
        ? formatRoleCounts(rc as Record<string, number>)
        : "—";
    return (
      <MessageHint
        className="mt-1"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-4"
        text={t("pipelineBeforePromptBuild", {
          history: numStr(p.historyMessageCount),
          promptChars: numStr(p.promptCharCount),
          roles: rolesStr,
        })}
      />
    );
  }
  if (eventType === "llm_input") {
    return (
      <MessageHint
        className="mt-1"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-4"
        text={t("pipelineLlmInput", {
          provider: String(p.provider ?? "—"),
          model: String(p.model ?? "—"),
          history: numStr(p.historyMessageCount),
          images: numStr(p.imagesCount),
          delta: numStr(p.pluginPrependDeltaChars),
        })}
      />
    );
  }
  if (eventType === "llm_output") {
    const texts = p.assistantTexts;
    const n = Array.isArray(texts) ? texts.length : 0;
    return (
      <MessageHint
        className="mt-1"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-3"
        text={t("pipelineLlmOutput", { count: String(n) })}
      />
    );
  }
  if (eventType === "context_prune_applied") {
    return <ContextPruneAppliedPipelineBlock p={p} />;
  }
  if (eventType === "hook_contribution") {
    const source = String(p.sourceHook ?? "—");
    const plugin = String(p.contributingPluginId ?? "—");
    const tool = typeof p.toolName === "string" && p.toolName.trim() ? p.toolName.trim() : "";
    const line =
      t("pipelineHookContribution", { source, plugin }) +
      (tool ? ` · ${t("pipelineHookContributionTool", { tool })}` : "");
    return (
      <MessageHint
        className="mt-1"
        textClassName="text-xs leading-snug text-ca-muted"
        clampClass="line-clamp-4"
        text={line}
      />
    );
  }
  return null;
}

function unescapeForCopy(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\t/g, "\t");
}

function TraceEventPayloadFoldout({
  defaultExpanded,
  payload,
}: {
  defaultExpanded: boolean;
  payload: unknown;
}) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(defaultExpanded);
  const jsonStr = useMemo(() => {
    if (payload == null) return "{}";
    if (typeof payload === "string") {
      const s = payload.trim();
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try {
          return JSON.stringify(JSON.parse(s), null, 2);
        } catch {
          // ignore
        }
      }
      return payload;
    }
    return JSON.stringify(payload, null, 2);
  }, [payload]);

  return (
    <details
      className="rounded-b-xl border-t border-border/70 bg-neutral-50/30"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[11px] font-medium text-ca-muted hover:bg-neutral-100/80">
        <span>{t("layersFullPayloadSummary")}</span>
        <TraceCopyIconButton
          text={unescapeForCopy(jsonStr)}
          ariaLabel={t("detailCopy")}
          tooltipLabel={t("copy")}
          successLabel={t("copySuccessToast")}
          className="size-6 items-center justify-center p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          iconClassName="size-3.5"
          stopPropagation
        />
      </summary>
      <JsonHighlightedBlock
        text={jsonStr}
        query=""
        className="ca-code-block m-0 max-h-[min(20rem,45vh)] overflow-auto border-0 px-3 pb-3 text-[11px] leading-relaxed"
      />
    </details>
  );
}

function buildRunGroups(events: TraceTimelineEvent[]): { key: string; items: TraceTimelineEvent[] }[] {
  const sorted = sortChronological(events);
  const map = new Map<string, TraceTimelineEvent[]>();
  for (const ev of sorted) {
    const rid = eventRunId(ev);
    const key = rid || "__session__";
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(ev);
  }
  const pairs = [...map.entries()];
  pairs.sort(([ka, a], [kb, b]) => {
    if (ka === "__session__") {
      return -1;
    }
    if (kb === "__session__") {
      return 1;
    }
    return firstEventId(a) - firstEventId(b);
  });
  return pairs.map(([key, items]) => ({ key, items }));
}

export function TraceTimelineTree({ events }: { events: TraceTimelineEvent[] }) {
  const t = useTranslations("Traces");
  const groups = useMemo(() => buildRunGroups(events), [events]);

  return (
    <div className="ca-tree space-y-3">
      <MessageHint
        className="text-xs"
        textClassName="text-xs text-ca-muted"
        clampClass="line-clamp-4"
        text={t("treeHint")}
      />
      {groups.map((g) => (
        <details key={g.key} open className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-neutral-50/90 px-4 py-3 text-sm font-semibold text-neutral-900">
            <span className="ca-tree-chevron select-none" aria-hidden>
              ▸
            </span>
            <span className="min-w-0 flex-1">
              {g.key === "__session__" ? (
                <span>{t("treeSessionWide")}</span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0">{t("treeRun")}</span>
                  <IdLabeledCopy
                    kind="run_id"
                    value={g.key}
                    displayText={shortRunLabel(g.key)}
                    variant="compact"
                  />
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs font-normal text-ca-muted">
              {t("treeEventCount", { count: g.items.length })}
            </span>
          </summary>
          <div className="space-y-3 border-l-2 border-border/70 py-3 pl-4 ml-5 mr-2 border-t border-border">
            {g.items.map((row) => {
              const rawWhen = row.client_ts ?? row.created_at;
              const when =
                rawWhen == null
                  ? formatTraceDateTimeLocal(undefined)
                  : formatTraceDateTimeLocal(typeof rawWhen === "number" ? String(rawWhen) : rawWhen);
              const rowRunId = eventRunId(row);
              const key = String(row.event_id ?? row.id ?? `${g.key}-${when}-${row.type}`);
              const crabagent = parseCrabagentPayload(row.payload);
              return (
                <div
                  key={key}
                  className="rounded-xl border border-border/90 bg-neutral-50/40 shadow-sm"
                >
                  <div className="space-y-2 border-b border-border/80 bg-white/90 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-ca-muted">{when}</span>
                      {(() => {
                        const pk = pipelinePhaseKey(row.type);
                        return pk ? (
                          <span
                            className="max-w-[min(100%,14rem)] truncate rounded-full bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-950"
                            title={row.type}
                          >
                            {t(pk)}
                          </span>
                        ) : null;
                      })()}
                      {row.channel ? (
                        <span className="ca-pill-muted text-[10px]">{row.channel}</span>
                      ) : null}
                      {row.agent_name?.trim() || row.agent_id?.trim() ? (
                        <span
                          className="rounded-full bg-violet-100/90 px-2 py-0.5 text-[10px] font-semibold text-violet-950"
                          title={row.agent_id?.trim() && row.agent_id.trim() !== (row.agent_name ?? "").trim() ? row.agent_id.trim() : undefined}
                        >
                          {row.agent_name?.trim() || row.agent_id?.trim()}
                        </span>
                      ) : null}
                      <span className="ca-pill-muted text-[11px] font-semibold">
                        {row.type ?? "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {typeof row.id === "number" ? (
                        <IdLabeledCopy kind="row_id" value={row.id} variant="compact" />
                      ) : null}
                      {row.event_id ? (
                        <IdLabeledCopy
                          kind="event_id"
                          value={row.event_id}
                          displayText={formatShortId(row.event_id)}
                          variant="compact"
                        />
                      ) : null}
                      {rowRunId ? (
                        <IdLabeledCopy
                          kind="run_id"
                          value={rowRunId}
                          displayText={shortRunLabel(rowRunId)}
                          variant="compact"
                        />
                      ) : null}
                      {typeof row.msg_id === "string" && row.msg_id.trim() ? (
                        <IdLabeledCopy
                          kind="msg_id"
                          value={row.msg_id.trim()}
                          displayText={shortKeyLabel(row.msg_id.trim())}
                          variant="compact"
                        />
                      ) : null}
                      {row.session_key ? (
                        <IdLabeledCopy
                          kind="session_key"
                          value={row.session_key}
                          displayText={shortKeyLabel(row.session_key)}
                          variant="compact"
                        />
                      ) : null}
                      {row.session_id ? (
                        <IdLabeledCopy
                          kind="session_id"
                          value={row.session_id}
                          displayText={formatShortId(row.session_id)}
                          variant="compact"
                        />
                      ) : null}
                      {row.trace_root_id ? (
                        <IdLabeledCopy
                          kind="trace_root"
                          value={row.trace_root_id}
                          displayText={shortRunLabel(row.trace_root_id)}
                          variant="compact"
                        />
                      ) : null}
                    </div>
                    <TraceEventPipelineSummary eventType={row.type} payload={row.payload} />
                    {crabagent ? (
                      <div className="mt-2">
                        <TraceCrabagentLayersPanel data={crabagent} />
                      </div>
                    ) : null}
                  </div>
                  <TraceEventPayloadFoldout defaultExpanded={!crabagent} payload={row.payload} />
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
