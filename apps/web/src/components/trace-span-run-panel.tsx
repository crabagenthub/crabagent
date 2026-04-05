"use client";

import { IconRight, IconSearch } from "@arco-design/web-react/icon";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageHint } from "@/components/message-hint";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import {
  LARGE_TOOL_RESULT_CHARS,
  estimatePayloadChars,
  toolResultChars,
} from "@/lib/span-insights";
import { extractRunChatBlocks, type ChatRole } from "@/lib/span-messages";
import { cn } from "@/lib/utils";
import {
  extractPromptStagesFromMetadata,
  PromptStagesMultiCompare,
} from "@/components/prompt-context-compare";
import { TraceInspectBasicHeader } from "@/components/trace-inspect-basic-header";
import { HighlightedBlockWithOptionalJson } from "@/components/json-highlighted-block";

type MainTab = "run" | "metadata" | "feedback";

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return String(obj);
  }
}

function formatErrorBody(error: string): string {
  const raw = error.trim();
  if (!raw) {
    return "";
  }
  try {
    if (raw.startsWith("{") || raw.startsWith("[")) {
      return JSON.stringify(JSON.parse(raw), null, 2);
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

function roleLabel(t: ReturnType<typeof useTranslations>, role: ChatRole): string {
  switch (role) {
    case "system":
      return t("detailRoleSystem");
    case "user":
      return t("detailRoleUser");
    case "assistant":
      return t("detailRoleAssistant");
    case "tool":
      return t("detailRoleTool");
    default:
      return role;
  }
}

function SpanInspectSection(props: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  copyPayload: string;
  prettyLabel: string;
  showPrettyBadge?: boolean;
  t: ReturnType<typeof useTranslations>;
  children: React.ReactNode;
}) {
  const {
    title,
    isOpen,
    onToggle,
    search,
    onSearchChange,
    copyPayload,
    prettyLabel,
    showPrettyBadge = true,
    t,
    children,
  } = props;
  return (
    <div className="border-b border-border">
      <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/15 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 text-left text-sm font-medium text-foreground"
        >
          <IconRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <span className="truncate">{title}</span>
        </button>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {showPrettyBadge ? (
            <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {prettyLabel}
            </span>
          ) : null}
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("inspectorSearchPlaceholder")}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[11px] text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-36 sm:flex-initial"
            aria-label={t("spanInspectSearchAria")}
            onClick={(e) => e.stopPropagation()}
          />
          <TraceCopyIconButton
            text={copyPayload}
            ariaLabel={t("spanInspectCopyAria")}
            tooltipLabel={t("copy")}
            successLabel={t("copySuccessToast")}
            className="size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            iconClassName="size-4"
          />
        </div>
      </div>
      {isOpen ? <div className="max-h-[min(55vh,28rem)] overflow-auto bg-background px-3 py-3 sm:px-4">{children}</div> : null}
    </div>
  );
}

export function TraceSpanRunPanel({
  span,
  chrome = "full",
  /** Trace-level `input_json`; `systemPrompt` is merged into input display only for `type === "LLM"` spans. */
  traceInput = null,
}: {
  span: SemanticSpanRow | null;
  /** `embedded`: no span summary header, only Details + Feedback tabs (Opik-style inspector). */
  chrome?: "full" | "embedded";
  traceInput?: Record<string, unknown> | null;
}) {
  const t = useTranslations("Traces");
  const embedded = chrome === "embedded";
  const [mainTab, setMainTab] = useState<MainTab>("run");
  const [viewMode, setViewMode] = useState<"text" | "json">("text");
  const [rawMode, setRawMode] = useState(false);
  const [search, setSearch] = useState("");
  const [openErr, setOpenErr] = useState(true);
  const [openIn, setOpenIn] = useState(true);
  const [openOut, setOpenOut] = useState(true);
  const [openMeta, setOpenMeta] = useState(true);
  const [sErr, setSErr] = useState("");
  const [sIn, setSIn] = useState("");
  const [sOut, setSOut] = useState("");
  const [sMeta, setSMeta] = useState("");

  useEffect(() => {
    setMainTab("run");
    setViewMode("text");
    setRawMode(false);
    setSearch("");
    setOpenErr(true);
    setOpenIn(true);
    setOpenOut(true);
    setOpenMeta(true);
    setSErr("");
    setSIn("");
    setSOut("");
    setSMeta("");
  }, [span?.span_id]);

  useEffect(() => {
    if (embedded && mainTab === "metadata") {
      setMainTab("run");
    }
    if (embedded && mainTab === "feedback") {
      setMainTab("run");
    }
  }, [embedded, mainTab]);

  const tabDefs = embedded ? (["run"] as const) : (["run", "metadata", "feedback"] as const);

  const effectiveSpanInput = useMemo(() => {
    if (!span) {
      return {} as Record<string, unknown>;
    }
    const base = span.input && typeof span.input === "object" ? { ...span.input } : {};
    if (span.type !== "LLM") {
      return base;
    }
    const sysRaw = traceInput?.systemPrompt;
    if (typeof sysRaw === "string" && sysRaw.trim().length > 0) {
      return { ...base, systemPrompt: sysRaw.trim() };
    }
    return base;
  }, [span, traceInput]);

  const inputJson = useMemo(() => formatJson(span ? effectiveSpanInput : {}), [span, effectiveSpanInput]);
  const outputJson = useMemo(() => formatJson(span?.output), [span?.output]);
  const metadataJson = useMemo(() => formatJson(span?.metadata), [span?.metadata]);

  const metaForPromptStages = useMemo(() => {
    if (!span) {
      return {};
    }
    return {
      ...span.metadata,
      ...(span.context_full != null ? { context_full: span.context_full } : {}),
      ...(span.context_sent != null ? { context_sent: span.context_sent } : {}),
    } as Record<string, unknown>;
  }, [span]);

  const promptStages = useMemo(
    () => (span ? extractPromptStagesFromMetadata(metaForPromptStages) : []),
    [span, metaForPromptStages],
  );

  const hasPromptCompare = promptStages.length >= 2;
  const llmInputStageText = useMemo(() => {
    if (promptStages.length === 0) {
      return null;
    }
    const norm = (s: string) => s.trim().toLowerCase();
    const picked =
      promptStages.find((s) => {
        const id = norm(s.id ?? "");
        const label = norm(s.label ?? "");
        return (
          id === "phasellminput" ||
          label === "phasellminput" ||
          id.includes("llm_input") ||
          label.includes("llm_input") ||
          label.includes("llminput") ||
          label.includes("进入模型") ||
          label.includes("llm input")
        );
      }) ??
      // Fallback: if we only have 1 stage, it's very likely the llm input stage.
      (promptStages.length === 1 ? promptStages[0]! : null);
    return picked?.text?.trim().length ? picked.text : null;
  }, [promptStages]);

  const { input: rawInputBlocks, output: outputBlocks } = useMemo(
    () => (span ? extractRunChatBlocks(span) : { input: [], output: [] }),
    [span],
  );

  const inputBlocks = useMemo(() => {
    if (llmInputStageText) {
      return [{ role: "system" as const, content: llmInputStageText }];
    }
    return rawInputBlocks;
  }, [llmInputStageText, rawInputBlocks]);

  const traceSystemPromptText = useMemo(() => {
    if (!span || span.type !== "LLM") {
      return "";
    }
    const sysRaw = traceInput?.systemPrompt;
    return typeof sysRaw === "string" && sysRaw.trim().length > 0 ? sysRaw.trim() : "";
  }, [span, traceInput]);

  const displayInputStr = useMemo(() => {
    if (!span) {
      return "";
    }
    if (llmInputStageText) {
      if (traceSystemPromptText) {
        return `${roleLabel(t, "system")}:\n${traceSystemPromptText}\n\n---\n\n${llmInputStageText}`;
      }
      return llmInputStageText;
    }
    if (inputBlocks.length > 0) {
      const hasSys = inputBlocks.some((b) => b.role === "system");
      const blocks =
        traceSystemPromptText && !hasSys
          ? ([{ role: "system" as const, content: traceSystemPromptText }, ...inputBlocks] as const)
          : inputBlocks;
      return blocks.map((b) => `${roleLabel(t, b.role)}:\n${b.content}`).join("\n\n---\n\n");
    }
    return inputJson;
  }, [span, inputBlocks, inputJson, t, llmInputStageText, traceSystemPromptText]);

  const displayOutputStr = useMemo(() => {
    if (!span) {
      return "";
    }
    if (outputBlocks.length > 0) {
      return outputBlocks.map((b) => `${roleLabel(t, b.role)}:\n${b.content}`).join("\n\n---\n\n");
    }
    return outputJson;
  }, [span, outputBlocks, outputJson, t]);

  const errorBody = span?.error ? formatErrorBody(span.error) : "";

  const canTextView = inputBlocks.length > 0 || outputBlocks.length > 0;

  useEffect(() => {
    if (viewMode === "text" && !canTextView && span) {
      setViewMode("json");
    }
  }, [viewMode, canTextView, span]);

  const durationMs =
    span && span.end_time != null && Number.isFinite(span.start_time) && Number.isFinite(span.end_time)
      ? Math.max(0, span.end_time - span.start_time)
      : null;

  const resultChars = span ? toolResultChars(span.output) : 0;
  const showToolHint =
    span &&
    (span.type === "TOOL" || span.type === "IO" || span.type === "MEMORY") &&
    resultChars >= LARGE_TOOL_RESULT_CHARS;

  if (!span) {
    return (
      <div className="flex h-full min-h-[200px] flex-col justify-center border-t border-border bg-white p-6 text-center lg:border-t-0">
        <p className="text-sm text-ca-muted">{t("inspectorEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t border-border bg-white lg:border-t-0">
      {!embedded ? (
        <TraceInspectBasicHeader
          variant="panel"
          selectedSpan={span}
          traceId={span.trace_id}
          chipTags={span.module ? [span.module] : []}
          rowTokens={null}
          rowDurationMs={durationMs}
        />
      ) : null}

      {!embedded || tabDefs.length > 1 ? (
        <div
          className={
            embedded
              ? "flex shrink-0 gap-6 border-b border-border bg-background px-4"
              : "flex shrink-0 gap-1 border-b border-border bg-neutral-50 px-2 py-1.5"
          }
        >
          {tabDefs.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMainTab(k)}
              className={[
                embedded
                  ? "relative pb-3 pt-3 text-sm font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5"
                  : "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                embedded
                  ? mainTab === k
                    ? "text-blue-600 after:bg-blue-600"
                    : "text-neutral-500 after:bg-transparent hover:text-neutral-800"
                  : mainTab === k
                    ? "bg-white text-primary shadow-sm ring-1 ring-border"
                    : "text-neutral-600 hover:text-neutral-900",
              ].join(" ")}
            >
              {k === "run"
                ? embedded
                  ? t("traceInspectTabDetails")
                  : t("detailRunTab")
                : k === "metadata"
                  ? t("detailMetadataTab")
                  : t("detailFeedbackTab")}
            </button>
          ))}
        </div>
      ) : null}

      {mainTab === "run" ? (
        embedded ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            {errorBody ? (
              <SpanInspectSection
                title={t("spanInspectSectionError")}
                isOpen={openErr}
                onToggle={() => setOpenErr((v) => !v)}
                search={sErr}
                onSearchChange={setSErr}
                copyPayload={errorBody}
                prettyLabel={t("spanInspectPretty")}
                showPrettyBadge={false}
                t={t}
              >
                <HighlightedBlockWithOptionalJson text={errorBody} query={sErr} json />
              </SpanInspectSection>
            ) : null}
            <SpanInspectSection
              title={t("detailInputSection")}
              isOpen={openIn}
              onToggle={() => setOpenIn((v) => !v)}
              search={sIn}
              onSearchChange={setSIn}
              copyPayload={displayInputStr}
              prettyLabel={t("spanInspectPretty")}
              showPrettyBadge={false}
              t={t}
            >
              <HighlightedBlockWithOptionalJson
                text={displayInputStr || "—"}
                query={sIn}
                json={!llmInputStageText && inputBlocks.length === 0}
              />
            </SpanInspectSection>
            <SpanInspectSection
              title={t("detailOutputSection")}
              isOpen={openOut}
              onToggle={() => setOpenOut((v) => !v)}
              search={sOut}
              onSearchChange={setSOut}
              copyPayload={displayOutputStr}
              prettyLabel={t("spanInspectPretty")}
              showPrettyBadge={false}
              t={t}
            >
              <HighlightedBlockWithOptionalJson
                text={displayOutputStr || "—"}
                query={sOut}
                json={outputBlocks.length === 0}
              />
            </SpanInspectSection>
            <SpanInspectSection
              title={t("spanInspectSectionMetadata")}
              isOpen={openMeta}
              onToggle={() => setOpenMeta((v) => !v)}
              search={sMeta}
              onSearchChange={setSMeta}
              copyPayload={metadataJson}
              prettyLabel={t("spanInspectPretty")}
              showPrettyBadge={false}
              t={t}
            >
              <HighlightedBlockWithOptionalJson text={metadataJson} query={sMeta} json />
            </SpanInspectSection>
            {showToolHint ? (
              <div className="border-b border-border px-3 py-2 sm:px-4">
                <MessageHint
                  text={t("inspectorToolPayloadHint", { kb: String(Math.round(resultChars / 1024)) })}
                  textClassName="text-[11px] leading-snug text-amber-900"
                  clampClass="line-clamp-5"
                />
              </div>
            ) : null}
            {estimatePayloadChars(span.output.result ?? span.output.resultForLlm) > 0 && resultChars < LARGE_TOOL_RESULT_CHARS ? (
              <p className="px-3 py-2 text-[10px] text-ca-muted sm:px-4">
                {t("inspectorToolResultSize", { chars: String(resultChars) })}
              </p>
            ) : null}
            {hasPromptCompare ? (
              <div className="border-t border-border px-3 py-3 sm:px-4">
                <p className="mb-2 text-xs font-semibold text-neutral-800">{t("inspectorTabContext")}</p>
                <PromptStagesMultiCompare key={span.span_id} stages={promptStages} />
              </div>
            ) : null}
          </div>
        ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-neutral-50/90 px-3 py-2">
            <span className="text-xs font-semibold text-neutral-700">{t("detailInputSection")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border border-input accent-primary shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  checked={rawMode}
                  onChange={(e) => setRawMode(e.target.checked)}
                />
                {t("detailRawToggle")}
              </label>
              <div className="flex rounded-lg bg-neutral-200/80 p-0.5">
                <button
                  type="button"
                  disabled={!canTextView}
                  onClick={() => setViewMode("text")}
                  className={[
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold",
                    viewMode === "text" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600",
                    !canTextView ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                >
                  {t("detailViewText")}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("json")}
                  className={[
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold",
                    viewMode === "json" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600",
                  ].join(" ")}
                >
                  {t("detailViewJson")}
                </button>
              </div>
            </div>
          </div>
          <div className="shrink-0 border-b border-border bg-neutral-50/80 px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inspectorSearchPlaceholder")}
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 font-mono text-[11px] text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50/30 p-3">
            {rawMode ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-neutral-500">{t("inspectorTabInput")}</p>
                  <HighlightedBlockWithOptionalJson
                    text={llmInputStageText ?? inputJson}
                    query={search}
                    json={!llmInputStageText}
                  />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-neutral-500">{t("inspectorTabOutput")}</p>
                  <HighlightedBlockWithOptionalJson text={outputJson} query={search} json />
                </div>
              </div>
            ) : viewMode === "json" ? (
              <div className="space-y-0">
                <HighlightedBlockWithOptionalJson text={inputJson} query={search} json />
                <div className="select-none py-2 text-center font-mono text-[10px] text-muted-foreground">
                  ---
                </div>
                <HighlightedBlockWithOptionalJson text={outputJson} query={search} json />
              </div>
            ) : (
              <div className="space-y-3">
                {inputBlocks.map((b, i) => (
                  <div key={`in-${i}`} className="rounded-xl border border-neutral-200/90 bg-neutral-100/80 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{roleLabel(t, b.role)}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900">{b.content}</p>
                  </div>
                ))}
                {outputBlocks.length > 0 ? (
                  <>
                    <p className="pt-1 text-[11px] font-semibold text-neutral-600">{t("detailOutputSection")}</p>
                    {outputBlocks.map((b, i) => (
                      <div key={`out-${i}`} className="rounded-xl border border-neutral-200/90 bg-neutral-100/80 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{roleLabel(t, b.role)}</p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900">{b.content}</p>
                      </div>
                    ))}
                  </>
                ) : null}
                {inputBlocks.length === 0 && outputBlocks.length === 0 ? (
                  <HighlightedBlockWithOptionalJson text={inputJson} query={search} json />
                ) : null}
              </div>
            )}
            {showToolHint ? (
              <div className="mt-4">
                <MessageHint
                  text={t("inspectorToolPayloadHint", { kb: String(Math.round(resultChars / 1024)) })}
                  textClassName="text-[11px] leading-snug text-amber-900"
                  clampClass="line-clamp-5"
                />
              </div>
            ) : null}
            {estimatePayloadChars(span.output.result ?? span.output.resultForLlm) > 0 && resultChars < LARGE_TOOL_RESULT_CHARS ? (
              <p className="mt-3 text-[10px] text-ca-muted">
                {t("inspectorToolResultSize", { chars: String(resultChars) })}
              </p>
            ) : null}
          </div>
        </>
        )
      ) : null}

      {mainTab === "metadata" ? (
        <>
          <div className="shrink-0 border-b border-border bg-neutral-50/80 px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inspectorSearchPlaceholder")}
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 font-mono text-[11px] text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <HighlightedBlockWithOptionalJson text={metadataJson} query={search} json />
          {hasPromptCompare ? (
            <div className="mt-6 border-t border-border pt-4">
              <p className="mb-2 text-xs font-semibold text-neutral-800">{t("inspectorTabContext")}</p>
              <PromptStagesMultiCompare key={span.span_id} stages={promptStages} />
            </div>
          ) : null}
          </div>
        </>
      ) : null}

      {mainTab === "feedback" ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="max-w-sm text-sm text-ca-muted">{t("detailFeedbackPlaceholder")}</p>
        </div>
      ) : null}
    </div>
  );
}
