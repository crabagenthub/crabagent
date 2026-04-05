"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { JsonHighlightedBlock } from "@/components/json-highlighted-block";
import { MessageHint } from "@/components/message-hint";
import type { ParsedCrabagentPayload } from "@/lib/trace-crabagent-layers";

function dash(v: unknown): string {
  if (v === null || v === undefined) {
    return "—";
  }
  if (typeof v === "string") {
    return v.trim() || "—";
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false";
  }
  return "—";
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-1.5 border-b border-border/60 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ca-muted">
      {children}
    </h4>
  );
}

function DlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,30%)_1fr] gap-x-2 gap-y-0.5 text-[11px] leading-snug">
      <dt className="text-ca-muted">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-neutral-800">{value}</dd>
    </div>
  );
}

function JsonSnippet({ value, maxHeightClass }: { value: string; maxHeightClass?: string }) {
  if (!value.trim()) {
    return <span className="text-[11px] text-ca-muted">—</span>;
  }
  return (
    <JsonHighlightedBlock
      text={value}
      query=""
      className={`ca-code-block overflow-auto rounded-md border border-border/60 bg-white/80 p-2 text-[10px] leading-relaxed dark:bg-neutral-950/40 ${maxHeightClass ?? "max-h-40"}`}
    />
  );
}

function KeyValueGrid({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1 rounded-md border border-border/50 bg-white/60 p-2">
      {entries.map(([k, v]) => (
        <DlRow
          key={k}
          label={k}
          value={
            typeof v === "object"
              ? JSON.stringify(v).length > 200
                ? `${JSON.stringify(v).slice(0, 200)}…`
                : JSON.stringify(v)
              : dash(v)
          }
        />
      ))}
    </div>
  );
}

function TaskBlock({ task }: { task: Record<string, unknown> }) {
  const t = useTranslations("Traces");
  const uc =
    task.userContext && typeof task.userContext === "object" && !Array.isArray(task.userContext)
      ? (task.userContext as Record<string, unknown>)
      : null;
  const feedback =
    task.userFeedback && typeof task.userFeedback === "object" && !Array.isArray(task.userFeedback)
      ? (task.userFeedback as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-2">
      <SectionTitle>{t("layersTaskTitle")}</SectionTitle>
      <div className="space-y-1.5">
        <DlRow label={t("layersFieldUserId")} value={dash(task.userId)} />
        <DlRow label={t("layersFieldEntryPoint")} value={dash(task.entryPoint)} />
        <DlRow label={t("layersFieldMessageProvider")} value={dash(task.messageProvider)} />
        <DlRow label={t("layersFieldReceivedAt")} value={dash(task.receivedAtMs)} />
        {typeof task.initialIntentText === "string" && task.initialIntentText.trim() ? (
          <MessageHint
            className="mt-1"
            textClassName="text-[11px] leading-snug text-neutral-800"
            clampClass="line-clamp-6"
            text={task.initialIntentText}
          />
        ) : null}
        {uc ? (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] font-medium text-ca-muted">{t("layersUserContextTitle")}</div>
            <DlRow label={t("layersFieldDevice")} value={dash(uc.device)} />
            <DlRow label={t("layersFieldLocale")} value={dash(uc.locale)} />
            <DlRow label={t("layersFieldGeo")} value={dash(uc.geo)} />
            <DlRow label={t("layersFieldConversationId")} value={dash(uc.conversationId)} />
          </div>
        ) : null}
        {feedback ? (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] font-medium text-ca-muted">{t("layersUserFeedbackTitle")}</div>
            <DlRow label={t("layersFieldRating")} value={dash(feedback.rating)} />
            <DlRow label={t("layersFieldThumbsUp")} value={dash(feedback.thumbsUp)} />
            <DlRow label={t("layersFieldThumbsDown")} value={dash(feedback.thumbsDown)} />
          </div>
        ) : null}
        {typeof task.resumedFrom === "string" && task.resumedFrom.trim() ? (
          <DlRow label={t("layersFieldResumedFrom")} value={task.resumedFrom} />
        ) : null}
        {typeof task.kind === "string" ? <DlRow label={t("layersFieldKind")} value={task.kind} /> : null}
      </div>
    </div>
  );
}

function ReasoningBlock({ reasoning }: { reasoning: Record<string, unknown> }) {
  const t = useTranslations("Traces");
  const cw =
    reasoning.contextWindow && typeof reasoning.contextWindow === "object" && !Array.isArray(reasoning.contextWindow)
      ? (reasoning.contextWindow as Record<string, unknown>)
      : null;
  const fed =
    cw && cw.fedToModel && typeof cw.fedToModel === "object" && !Array.isArray(cw.fedToModel)
      ? (cw.fedToModel as Record<string, unknown>)
      : null;
  const tm =
    reasoning.tokenMetrics && typeof reasoning.tokenMetrics === "object" && !Array.isArray(reasoning.tokenMetrics)
      ? (reasoning.tokenMetrics as Record<string, unknown>)
      : null;

  const modelParams =
    reasoning.modelParams && typeof reasoning.modelParams === "object" && !Array.isArray(reasoning.modelParams)
      ? (reasoning.modelParams as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-2">
      <SectionTitle>{t("layersReasoningTitle")}</SectionTitle>
      <div className="space-y-1.5">
        <DlRow label={t("layersFieldPhase")} value={dash(reasoning.phase)} />
        <DlRow label={t("layersFieldProvider")} value={dash(reasoning.provider)} />
        <DlRow label={t("layersFieldModel")} value={dash(reasoning.model)} />
        {typeof reasoning.contextCompressionRatio === "number" ? (
          <DlRow
            label={t("layersFieldCompressionRatio")}
            value={reasoning.contextCompressionRatio.toFixed(4)}
          />
        ) : null}
        {typeof reasoning.messageCountBefore === "number" ? (
          <DlRow label={t("layersFieldMsgBeforeAfter")} value={`${dash(reasoning.messageCountBefore)} → ${dash(reasoning.messageCountAfter)}`} />
        ) : null}
        {typeof reasoning.estimatedCharsBefore === "number" ? (
          <DlRow
            label={t("layersFieldCharsBeforeAfter")}
            value={`${dash(reasoning.estimatedCharsBefore)} → ${dash(reasoning.estimatedCharsAfter)}`}
          />
        ) : null}
      </div>
      {modelParams && Object.keys(modelParams).length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersModelParamsTitle")}</div>
          <KeyValueGrid obj={modelParams} />
        </div>
      ) : null}
      {tm ? (
        <div className="mt-2 space-y-1">
          <div className="text-[10px] font-medium text-ca-muted">{t("layersTokenMetricsTitle")}</div>
          <DlRow label={t("layersFieldPromptTokens")} value={dash(tm.prompt_tokens)} />
          <DlRow label={t("layersFieldCompletionTokens")} value={dash(tm.completion_tokens)} />
          <DlRow label={t("layersFieldTotalTokens")} value={dash(tm.total_tokens)} />
        </div>
      ) : null}
      {typeof reasoning.systemPromptMirror === "string" && reasoning.systemPromptMirror.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersSystemPromptTitle")}</div>
          <MessageHint
            textClassName="text-[11px] leading-snug text-neutral-800"
            clampClass="line-clamp-5"
            text={reasoning.systemPromptMirror}
          />
        </div>
      ) : null}
      {fed && typeof fed.promptText === "string" && fed.promptText.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersFedPromptTitle")}</div>
          <MessageHint
            textClassName="text-[11px] leading-snug text-neutral-800"
            clampClass="line-clamp-4"
            text={fed.promptText}
          />
        </div>
      ) : null}
      {typeof fed?.historyMessagesTruncatedJson === "string" && fed.historyMessagesTruncatedJson.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersHistoryJsonTitle")}</div>
          <JsonSnippet value={fed.historyMessagesTruncatedJson} maxHeightClass="max-h-32" />
        </div>
      ) : null}
      {typeof reasoning.historySerializedTruncated === "string" && reasoning.historySerializedTruncated.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersHistoryBeforeBuildTitle")}</div>
          <JsonSnippet value={reasoning.historySerializedTruncated} maxHeightClass="max-h-32" />
        </div>
      ) : null}
      {typeof reasoning.rawOutputText === "string" && reasoning.rawOutputText.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersRawOutputTitle")}</div>
          <MessageHint
            textClassName="text-[11px] leading-snug text-neutral-800"
            clampClass="line-clamp-6"
            text={reasoning.rawOutputText}
          />
        </div>
      ) : null}
      {typeof reasoning.messagesDigest === "string" || typeof reasoning.systemDigest === "string" ? (
        <div className="mt-2 space-y-1 text-[10px]">
          {typeof reasoning.messagesDigest === "string" ? (
            <DlRow label={t("layersFieldMessagesDigest")} value={reasoning.messagesDigest} />
          ) : null}
          {typeof reasoning.systemDigest === "string" ? (
            <DlRow label={t("layersFieldSystemDigest")} value={reasoning.systemDigest} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MemoryBlock({ memory }: { memory: Record<string, unknown> }) {
  const t = useTranslations("Traces");
  const hits = memory.memoryHits;

  return (
    <div className="space-y-2">
      <SectionTitle>{t("layersMemoryTitle")}</SectionTitle>
      <div className="space-y-1.5">
        <DlRow label={t("layersFieldSourceHook")} value={dash(memory.sourceHook)} />
        <DlRow label={t("layersFieldPluginId")} value={dash(memory.contributingPluginId)} />
        <DlRow label={t("layersFieldToolName")} value={dash(memory.toolName)} />
        {typeof memory.contextCompressionRatio === "number" ? (
          <DlRow label={t("layersFieldCompressionRatio")} value={String(memory.contextCompressionRatio)} />
        ) : null}
      </div>
      {Array.isArray(memory.searchQueries) && memory.searchQueries.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersSearchQueriesTitle")}</div>
          <ul className="list-inside list-disc text-[11px] text-neutral-800">
            {memory.searchQueries.slice(0, 12).map((q, i) => (
              <li key={i} className="break-words">
                {String(q)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Array.isArray(hits) && hits.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersMemoryHitsTitle")}</div>
          <ul className="space-y-1 text-[11px] text-neutral-800">
            {hits.slice(0, 8).map((h, i) => (
              <li key={i} className="rounded border border-border/40 bg-white/70 p-1.5 font-mono text-[10px] break-words">
                {typeof h === "string" ? h : JSON.stringify(h).slice(0, 500)}
                {typeof h === "object" && JSON.stringify(h).length > 500 ? "…" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {memory.relevanceScores !== undefined ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersRelevanceTitle")}</div>
          <JsonSnippet value={JSON.stringify(memory.relevanceScores, null, 2)} maxHeightClass="max-h-24" />
        </div>
      ) : null}
      {typeof memory.contributionJsonTruncated === "string" && memory.contributionJsonTruncated.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersContributionJsonTitle")}</div>
          <JsonSnippet value={memory.contributionJsonTruncated} />
        </div>
      ) : null}
    </div>
  );
}

function ToolsBlock({ tools }: { tools: Record<string, unknown> }) {
  const t = useTranslations("Traces");
  const args = tools.args;
  const params =
    args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null;

  return (
    <div className="space-y-2">
      <SectionTitle>{t("layersToolsTitle")}</SectionTitle>
      <div className="space-y-1.5">
        <DlRow label={t("layersFieldPhase")} value={dash(tools.phase)} />
        <DlRow label={t("layersFieldToolName")} value={dash(tools.toolName)} />
        <DlRow label={t("layersFieldToolCallId")} value={dash(tools.toolCallId)} />
        <DlRow label={t("layersFieldDurationMs")} value={dash(tools.durationMs ?? tools.executionLatencyMs)} />
        <DlRow label={t("layersFieldRetryCount")} value={dash(tools.retryCount)} />
        <DlRow label={t("layersFieldParentCall")} value={dash(tools.parentToolCallId)} />
        <DlRow label={t("layersFieldHasError")} value={dash(tools.hasError)} />
      </div>
      {params && Object.keys(params).length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersToolArgsTitle")}</div>
          <JsonSnippet value={JSON.stringify(params, null, 2)} maxHeightClass="max-h-36" />
        </div>
      ) : null}
      {typeof tools.resultRawTruncated === "string" && tools.resultRawTruncated.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersToolResultRawTitle")}</div>
          <MessageHint
            textClassName="text-[11px] leading-snug text-neutral-800"
            clampClass="line-clamp-6"
            text={tools.resultRawTruncated}
          />
        </div>
      ) : null}
      {typeof tools.resultForLlmTruncated === "string" && tools.resultForLlmTruncated.trim() ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersToolResultLlmTitle")}</div>
          <MessageHint
            textClassName="text-[11px] leading-snug text-neutral-800"
            clampClass="line-clamp-6"
            text={tools.resultForLlmTruncated}
          />
        </div>
      ) : null}
      {typeof tools.error === "string" && tools.error.trim() ? (
        <MessageHint
          className="mt-2"
          textClassName="text-[11px] leading-snug text-rose-800"
          clampClass="line-clamp-4"
          text={tools.error}
        />
      ) : null}
    </div>
  );
}

function StateBlock({ state }: { state: Record<string, unknown> }) {
  const t = useTranslations("Traces");
  const err = state.errorLog && typeof state.errorLog === "object" && !Array.isArray(state.errorLog)
    ? (state.errorLog as Record<string, unknown>)
    : null;

  return (
    <div className="space-y-2">
      <SectionTitle>{t("layersStateTitle")}</SectionTitle>
      <div className="space-y-1.5">
        <DlRow label={t("layersFieldKind")} value={dash(state.kind)} />
        <DlRow label={t("layersFieldStatus")} value={dash(state.status)} />
        <DlRow label={t("layersFieldDurationMs")} value={dash(state.durationMs)} />
        <DlRow label={t("layersFieldMessageCount")} value={dash(state.messageCount)} />
        <DlRow label={t("layersFieldRetryCount")} value={dash(state.retryCount)} />
      </div>
      {err && typeof err.message === "string" ? (
        <MessageHint
          className="mt-2"
          textClassName="text-[11px] leading-snug text-rose-800"
          clampClass="line-clamp-5"
          text={err.message}
        />
      ) : null}
      {state.flags && typeof state.flags === "object" && !Array.isArray(state.flags) ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-medium text-ca-muted">{t("layersFlagsTitle")}</div>
          <JsonSnippet value={JSON.stringify(state.flags, null, 2)} maxHeightClass="max-h-20" />
        </div>
      ) : null}
    </div>
  );
}

export function TraceCrabagentLayersPanel({ data }: { data: ParsedCrabagentPayload }) {
  const t = useTranslations("Traces");
  return (
    <details className="rounded-lg border border-violet-200/90 bg-violet-50/40 text-neutral-900">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-violet-950 hover:bg-violet-100/50">
        {t("layersPanelTitle")}
        {typeof data.schema === "number" ? (
          <span className="ml-2 font-mono text-[10px] font-normal text-ca-muted">v{data.schema}</span>
        ) : null}
      </summary>
      <div className="space-y-4 border-t border-violet-200/80 px-3 py-3">
        {data.task ? <TaskBlock task={data.task} /> : null}
        {data.reasoning ? <ReasoningBlock reasoning={data.reasoning} /> : null}
        {data.memory ? <MemoryBlock memory={data.memory} /> : null}
        {data.tools ? <ToolsBlock tools={data.tools} /> : null}
        {data.state ? <StateBlock state={data.state} /> : null}
      </div>
    </details>
  );
}
