"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageHint } from "@/components/message-hint";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import {
  LARGE_TOOL_RESULT_CHARS,
  estimatePayloadChars,
  toolResultChars,
} from "@/lib/span-insights";
import { extractRunChatBlocks, type ChatRole } from "@/lib/span-messages";

type MainTab = "run" | "metadata" | "feedback";

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return String(obj);
  }
}

function splitHighlight(text: string, q: string): { hit: boolean; v: string }[] {
  const query = q.trim();
  if (!query) {
    return [{ hit: false, v: text }];
  }
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc, "gi");
  const out: { hit: boolean; v: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const s = text;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      out.push({ hit: false, v: s.slice(last, m.index) });
    }
    out.push({ hit: true, v: m[0] });
    last = m.index + m[0].length;
    if (m[0].length === 0) {
      re.lastIndex += 1;
    }
  }
  if (last < s.length) {
    out.push({ hit: false, v: s.slice(last) });
  }
  return out.length > 0 ? out : [{ hit: false, v: text }];
}

function HighlightedBlock({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitHighlight(text, query), [text, query]);
  return (
    <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-neutral-800">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-200/90 px-0.5 text-neutral-900">
            {p.v}
          </mark>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </pre>
  );
}

function ContextLineDiff({ full, sent }: { full: string; sent: string }) {
  const t = useTranslations("Traces");
  const lines = useMemo(() => {
    const f = full.split("\n");
    const sset = new Set(sent.split("\n"));
    return f.map((line, i) => ({
      i,
      line,
      removed: line.length > 0 && !sset.has(line),
    }));
  }, [full, sent]);

  return (
    <div className="space-y-2">
      <MessageHint
        text={t("inspectorContextDiffHint")}
        textClassName="text-[11px] text-ca-muted"
        clampClass="line-clamp-4"
      />
      <div className="grid max-h-[min(40vh,24rem)] grid-cols-1 gap-2 overflow-hidden md:grid-cols-2">
        <div className="flex min-h-0 flex-col rounded-lg border border-ca-border bg-white">
          <div className="border-b border-ca-border bg-neutral-100 px-2 py-1 text-[10px] font-semibold uppercase text-ca-muted">
            {t("inspectorContextBefore")}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {lines.map(({ i, line, removed }) => (
              <div
                key={i}
                className={`font-mono text-[10px] leading-snug ${removed ? "bg-rose-100/80 text-rose-950 line-through decoration-rose-700/50" : "text-neutral-800"}`}
              >
                {line || " "}
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-col rounded-lg border border-ca-border bg-white">
          <div className="border-b border-ca-border bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-900">
            {t("inspectorContextAfter")}
          </div>
          <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[10px] text-neutral-800">
            {sent}
          </pre>
        </div>
      </div>
    </div>
  );
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

export function TraceSpanRunPanel({ span }: { span: SemanticSpanRow | null }) {
  const t = useTranslations("Traces");
  const [mainTab, setMainTab] = useState<MainTab>("run");
  const [viewMode, setViewMode] = useState<"text" | "json">("text");
  const [rawMode, setRawMode] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setMainTab("run");
    setViewMode("text");
    setRawMode(false);
    setSearch("");
  }, [span?.span_id]);

  const inputJson = useMemo(() => formatJson(span?.input), [span?.input]);
  const outputJson = useMemo(() => formatJson(span?.output), [span?.output]);
  const metadataJson = useMemo(() => formatJson(span?.metadata), [span?.metadata]);

  const hasContextDiff = Boolean(
    span?.context_full && span.context_sent && span.context_full !== span.context_sent,
  );

  const { input: inputBlocks, output: outputBlocks } = useMemo(
    () => (span ? extractRunChatBlocks(span) : { input: [], output: [] }),
    [span],
  );

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
      <div className="flex h-full min-h-[200px] flex-col justify-center border-t border-ca-border bg-white p-6 text-center lg:border-t-0">
        <p className="text-sm text-ca-muted">{t("inspectorEmpty")}</p>
      </div>
    );
  }

  const totalTok = (span.prompt_tokens ?? 0) + (span.completion_tokens ?? 0);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t border-ca-border bg-white lg:border-t-0">
      <header className="shrink-0 space-y-2 border-b border-ca-border bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold tracking-tight text-neutral-900">{span.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  span.error ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-900",
                ].join(" ")}
              >
                {span.error ? t("detailStatusError") : t("detailStatusSuccess")}
              </span>
              {durationMs != null ? (
                <span className="tabular-nums text-neutral-600">
                  {t("detailSpanLatency", { ms: durationMs.toLocaleString() })}
                </span>
              ) : null}
              {totalTok > 0 ? (
                <span className="tabular-nums text-neutral-600">
                  {t("detailSpanTokens", { n: totalTok.toLocaleString() })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-ca-border bg-neutral-50 px-2 py-1.5">
        {(["run", "metadata", "feedback"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setMainTab(k)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              mainTab === k ? "bg-white text-ca-accent shadow-sm ring-1 ring-ca-border" : "text-neutral-600 hover:text-neutral-900",
            ].join(" ")}
          >
            {k === "run" ? t("detailRunTab") : k === "metadata" ? t("detailMetadataTab") : t("detailFeedbackTab")}
          </button>
        ))}
      </div>

      {mainTab === "run" ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ca-border bg-neutral-50/90 px-3 py-2">
            <span className="text-xs font-semibold text-neutral-700">{t("detailInputSection")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600">
                <input type="checkbox" className="rounded border-ca-border" checked={rawMode} onChange={(e) => setRawMode(e.target.checked)} />
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
          <div className="shrink-0 border-b border-ca-border bg-neutral-50/80 px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inspectorSearchPlaceholder")}
              className="w-full rounded-lg border border-ca-border bg-white px-2 py-1.5 font-mono text-[11px] outline-none ring-ca-accent/25 focus:ring-2"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50/30 p-3">
            {rawMode ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-neutral-500">{t("inspectorTabInput")}</p>
                  <HighlightedBlock text={inputJson} query={search} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-neutral-500">{t("inspectorTabOutput")}</p>
                  <HighlightedBlock text={outputJson} query={search} />
                </div>
              </div>
            ) : viewMode === "json" ? (
              <HighlightedBlock text={`${inputJson}\n\n---\n\n${outputJson}`} query={search} />
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
                  <HighlightedBlock text={inputJson} query={search} />
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
      ) : null}

      {mainTab === "metadata" ? (
        <>
          <div className="shrink-0 border-b border-ca-border bg-neutral-50/80 px-3 py-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inspectorSearchPlaceholder")}
              className="w-full rounded-lg border border-ca-border bg-white px-2 py-1.5 font-mono text-[11px] outline-none ring-ca-accent/25 focus:ring-2"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <HighlightedBlock text={metadataJson} query={search} />
          {hasContextDiff ? (
            <div className="mt-6 border-t border-ca-border pt-4">
              <p className="mb-2 text-xs font-semibold text-neutral-800">{t("inspectorTabContext")}</p>
              <ContextLineDiff full={span.context_full!} sent={span.context_sent!} />
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
