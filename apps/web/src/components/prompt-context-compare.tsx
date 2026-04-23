"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { computeWordDiff } from "@/lib/word-diff";
import { MessageHint } from "@/components/message-hint";
import { cn } from "@/lib/utils";

export type PromptStage = { id: string; label: string; text: string };

function lineDiffRows(
  full: string,
  sent: string,
): Array<{ line: string; removed: boolean }> {
  const f = full.split("\n");
  const sset = new Set(sent.split("\n"));
  return f.map((line) => ({
    line,
    removed: line.length > 0 && !sset.has(line),
  }));
}

type CompareMode = "word" | "line";

/** Side-by-side prompt / context comparison: word-level (default) or line-level fallback. */
export function PromptContextCompare({
  beforeLabel,
  afterLabel,
  beforeText,
  afterText,
}: {
  beforeLabel: string;
  afterLabel: string;
  beforeText: string;
  afterText: string;
}) {
  return (
    <PromptContextCompareInner
      beforeLabel={beforeLabel}
      afterLabel={afterLabel}
      beforeText={beforeText}
      afterText={afterText}
    />
  );
}

function PromptContextCompareInner({
  beforeLabel,
  afterLabel,
  beforeText,
  afterText,
}: {
  beforeLabel: string;
  afterLabel: string;
  beforeText: string;
  afterText: string;
}) {
  const t = useTranslations("Traces");
  const [mode, setMode] = useState<CompareMode>("word");

  const wordChunks = useMemo(() => computeWordDiff(beforeText, afterText), [beforeText, afterText]);
  const lineRows = useMemo(() => lineDiffRows(beforeText, afterText), [beforeText, afterText]);

  const effectiveMode: CompareMode = mode === "word" && wordChunks == null ? "line" : mode;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MessageHint
          text={
            wordChunks == null
              ? t("inspectorPromptCompareTooLarge")
              : t("inspectorPromptCompareHint")
          }
          textClassName="text-[11px] text-ca-muted"
          clampClass="line-clamp-3"
        />
        <div className="flex shrink-0 rounded-lg bg-neutral-200/70 p-0.5">
          <button
            type="button"
            disabled={wordChunks == null}
            onClick={() => setMode("word")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
              effectiveMode === "word"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600",
              wordChunks == null && "cursor-not-allowed opacity-45",
            )}
          >
            {t("inspectorPromptCompareWord")}
          </button>
          <button
            type="button"
            onClick={() => setMode("line")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
              effectiveMode === "line"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600",
            )}
          >
            {t("inspectorPromptCompareLine")}
          </button>
        </div>
      </div>

      {effectiveMode === "word" && wordChunks ? (
        <div className="grid max-h-[min(48vh,28rem)] grid-cols-1 gap-0 overflow-hidden rounded-lg border border-border md:grid-cols-2 md:divide-x md:divide-border">
          <div className="flex min-h-0 min-w-0 flex-col bg-white">
            <div className="shrink-0 border-b border-border bg-neutral-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
              {beforeLabel}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2.5 font-mono text-[11px] leading-relaxed">
              {wordChunks.map((c, i) =>
                c.type === "equal" ? (
                  <span key={i} className="text-neutral-800">
                    {c.text}
                  </span>
                ) : c.type === "delete" ? (
                  <span
                    key={i}
                    className="bg-rose-100/90 text-rose-950 line-through decoration-rose-700/60"
                  >
                    {c.text}
                  </span>
                ) : null,
              )}
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col bg-white">
            <div className="shrink-0 border-b border-border bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
              {afterLabel}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2.5 font-mono text-[11px] leading-relaxed">
              {wordChunks.map((c, i) =>
                c.type === "equal" ? (
                  <span key={i} className="text-neutral-800">
                    {c.text}
                  </span>
                ) : c.type === "insert" ? (
                  <span key={i} className="bg-emerald-100/90 font-medium text-emerald-950">
                    {c.text}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <MessageHint
            text={t("inspectorContextDiffHint")}
            textClassName="text-[11px] text-ca-muted"
            clampClass="line-clamp-4"
          />
          <div className="grid max-h-[min(40vh,24rem)] grid-cols-1 gap-2 overflow-hidden md:grid-cols-2 md:gap-0 md:divide-x md:divide-border">
            <div className="flex min-h-0 flex-col rounded-lg border border-border bg-white md:rounded-none md:border-0 md:border-r">
              <div className="border-b border-border bg-neutral-100 px-2 py-1 text-[10px] font-semibold uppercase text-ca-muted">
                {beforeLabel}
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {lineRows.map(({ line, removed }, i) => (
                  <div
                    key={i}
                    className={
                      removed
                        ? "font-mono text-[10px] leading-snug bg-rose-100/80 text-rose-950 line-through decoration-rose-700/50"
                        : "font-mono text-[10px] leading-snug text-neutral-800"
                    }
                  >
                    {line || " "}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-col rounded-lg border border-border bg-white md:rounded-none md:border-0">
              <div className="border-b border-border bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-900">
                {afterLabel}
              </div>
              <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[10px] text-neutral-800">
                {afterText}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Build ordered stages from span metadata: `prompt_stages` array or `context_full` / `context_sent`. */
export function extractPromptStagesFromMetadata(meta: Record<string, unknown>): PromptStage[] {
  const raw = meta.prompt_stages;
  if (Array.isArray(raw) && raw.length >= 2) {
    const stages: PromptStage[] = [];
    let idx = 0;
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const o = item as Record<string, unknown>;
      const label =
        typeof o.label === "string"
          ? o.label
          : typeof o.name === "string"
            ? o.name
            : typeof o.stage === "string"
              ? o.stage
              : `Stage ${idx + 1}`;
      const text =
        typeof o.text === "string"
          ? o.text
          : typeof o.content === "string"
            ? o.content
            : typeof o.body === "string"
              ? o.body
              : "";
      if (text.trim()) {
        const stageId = typeof o.id === "string" ? o.id : `stage-${idx}`;
        const stageLabel = label;
        stages.push({
          id: stageId,
          label: stageLabel,
          text,
        });
        idx++;
      }
    }
    // Even if we only have a single stage (e.g. only `phaseLlmInput`),
    // we still want to surface it in the inspector UI.
    if (stages.length >= 1) {
      return stages;
    }
  }

  const full = meta.context_full;
  const sent = meta.context_sent;
  const fullStr = typeof full === "string" ? full : "";
  const sentStr = typeof sent === "string" ? sent : "";
  if (fullStr && sentStr && fullStr !== sentStr) {
    return [
      { id: "context_full", label: "__context_full__", text: fullStr },
      { id: "context_sent", label: "__context_sent__", text: sentStr },
    ];
  }
  return [];
}

/** When ≥2 stages: pick any pair to compare (dropdowns). */
export function PromptStagesMultiCompare({ stages }: { stages: PromptStage[] }) {
  const t = useTranslations("Traces");
  const [iFrom, setIFrom] = useState(0);
  const [iTo, setITo] = useState(1);

  const lastIdx = Math.max(0, stages.length - 1);
  const fromIdx = Math.min(iFrom, lastIdx);
  const toIdx = Math.min(iTo, lastIdx);

  const labelFor = (s: PromptStage) =>
    s.label === "__context_full__"
      ? t("inspectorContextBefore")
      : s.label === "__context_sent__"
        ? t("inspectorContextAfter")
        : s.label;

  if (stages.length < 2) {
    return null;
  }

  const from = stages[fromIdx]!;
  const to = stages[toIdx]!;

  return (
    <div className="space-y-3">
      {stages.length > 2 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] font-medium text-neutral-600">
            {t("inspectorPromptStageFrom")}
            <select
              value={fromIdx}
              onChange={(e) => setIFrom(Number(e.target.value))}
              className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-xs"
            >
              {stages.map((s, idx) => (
                <option key={s.id} value={idx}>
                  {labelFor(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium text-neutral-600">
            {t("inspectorPromptStageTo")}
            <select
              value={toIdx}
              onChange={(e) => setITo(Number(e.target.value))}
              className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-xs"
            >
              {stages.map((s, idx) => (
                <option key={`${s.id}-to`} value={idx}>
                  {labelFor(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <PromptContextCompareInner
        beforeLabel={labelFor(from)}
        afterLabel={labelFor(to)}
        beforeText={from.text}
        afterText={to.text}
      />
    </div>
  );
}
