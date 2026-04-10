"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { IconExclamationCircle, IconSafe } from "@arco-design/web-react/icon";
import { useRouter } from "@/i18n/navigation";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/components/app-page-shell";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { InspectTitleLeadingIcon } from "@/components/inspect-title-leading-icon";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { Button } from "@/components/ui/button";
import { TraceInspectBasicHeader } from "@/components/trace-inspect-basic-header";
import { TraceSpanRunPanel } from "@/components/trace-span-run-panel";
import { ExecutionTraceFlow } from "@/components/execution-trace-flow";
import { SpanTraceFlow } from "@/components/span-trace-flow";
import { TraceSemanticTree } from "@/components/trace-semantic-tree";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { buildSpanForest, filterSpanForest } from "@/lib/build-span-tree";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";

function MessageDetailContent() {
  const t = useTranslations("Messages");
  const tTr = useTranslations("Traces");
  const router = useRouter();
  const params = useParams<{ messageId: string }>();
  const messageId = decodeURIComponent(params.messageId ?? "");

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [spanView, setSpanView] = useState<"tree" | "graph" | "execution">("tree");

  const traceId = messageId.trim();

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  const spansQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, baseUrl, apiKey, traceId],
    queryFn: () => loadSemanticSpans(baseUrl, apiKey, traceId),
    enabled: mounted && baseUrl.trim().length > 0 && traceId.length > 0,
  });

  const spanDerived = useMemo(() => {
    const items = spansQuery.data?.items ?? [];
    if (items.length === 0) {
      return null;
    }
    const starts = items.map((i) => i.start_time).filter((x) => Number.isFinite(x));
    const ends = items.map((i) => i.end_time).filter((x): x is number => x != null && Number.isFinite(x));
    const minStart = starts.length > 0 ? Math.min(...starts) : 0;
    const maxEnd = ends.length > 0 ? Math.max(...ends) : null;
    let totalTok = 0;
    for (const s of items) {
      if (s.total_tokens != null && Number.isFinite(s.total_tokens)) {
        totalTok += s.total_tokens;
      }
    }
    const hasErr = items.some((s) => s.error != null && String(s.error).trim().length > 0);
    return {
      startTime: minStart > 0 ? new Date(minStart).toISOString() : null,
      endTime: maxEnd != null ? new Date(maxEnd).toISOString() : null,
      totalTokens: totalTok,
      stepCount: items.length,
      totalDuration:
        maxEnd != null && minStart > 0 && maxEnd >= minStart ? Math.max(0, maxEnd - minStart) : null,
      status: hasErr ? ("error" as const) : ("success" as const),
    };
  }, [spansQuery.data?.items]);

  const spanForest = useMemo(
    () => buildSpanForest(spansQuery.data?.items ?? []),
    [spansQuery.data?.items],
  );

  const filteredSpanForest = useMemo(() => filterSpanForest(spanForest, ""), [spanForest]);

  const selectedSpan = useMemo(() => {
    const items = spansQuery.data?.items ?? [];
    return items.find((s) => s.span_id === selectedSpanId) ?? null;
  }, [spansQuery.data?.items, selectedSpanId]);

  const selectedSpanDurMs = useMemo(() => {
    if (
      !selectedSpan ||
      selectedSpan.end_time == null ||
      !Number.isFinite(selectedSpan.start_time) ||
      !Number.isFinite(selectedSpan.end_time)
    ) {
      return null;
    }
    return Math.max(0, selectedSpan.end_time - selectedSpan.start_time);
  }, [selectedSpan]);

  const securityHint = useMemo(() => {
    const items = spansQuery.data?.items ?? [];
    let best: { hitCount: number; intercepted: boolean } | null = null;
    for (const s of items) {
      const raw = s.metadata?.crabagent_interception;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }
      const rec = raw as Record<string, unknown>;
      const hitCount =
        typeof rec.hit_count === "number" && Number.isFinite(rec.hit_count)
          ? Math.max(0, rec.hit_count)
          : 0;
      const intercepted = rec.intercepted === true;
      if (!best || hitCount > best.hitCount || (intercepted && !best.intercepted)) {
        best = { hitCount, intercepted };
      }
    }
    return best;
  }, [spansQuery.data?.items]);

  const messageInspectChipTags = useMemo(() => {
    const m = selectedSpan?.module?.trim();
    return m ? [m] : [];
  }, [selectedSpan?.module]);

  const messageShort = formatShortId(messageId);

  const openTraceFromGraph = useCallback(
    (tid: string) => {
      const id = tid.trim();
      if (!id || id === traceId) {
        return;
      }
      router.push(`/messages/${encodeURIComponent(id)}`);
    },
    [router, traceId],
  );

  const viewToggleBtn = (active: boolean) =>
    cn(
      "rounded px-2.5 py-1 text-xs font-medium transition-colors",
      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  if (!mounted) {
    return (
      <AppPageShell variant="traces">
        <main className="ca-page relative z-[1]">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-48 rounded-lg bg-neutral-200" />
            <div className="h-4 w-full max-w-md rounded bg-neutral-200" />
          </div>
          <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="traces">
      <main className="ca-page relative z-[1]">
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-ca-muted" aria-label="Breadcrumb">
          <LocalizedLink href="/messages" className="font-medium text-primary no-underline hover:underline">
            {t("backToList")}
          </LocalizedLink>
          <span aria-hidden className="text-neutral-400">
            /
          </span>
          <IdLabeledCopy
            kind="trace_id"
            value={messageId}
            displayText={messageShort}
            variant="compact"
            className="text-neutral-700"
          />
        </nav>

        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-stretch gap-2">
            <InspectTitleLeadingIcon kind="message" />
            <div className="min-w-0 flex-1">
              <IdLabeledCopy
                kind="trace_id"
                value={messageId}
                valueClassName="text-lg font-semibold tracking-tight md:text-xl"
              />
              {securityHint ? (
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                  {securityHint.intercepted ? (
                    <IconSafe className="size-3.5 shrink-0 text-amber-600" aria-hidden />
                  ) : (
                    <IconExclamationCircle className="size-3.5 shrink-0 text-amber-600" aria-hidden />
                  )}
                  <span className="tabular-nums">Sensitive hit ×{securityHint.hitCount}</span>
                </div>
              ) : null}
            </div>
          </div>
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => router.push("/settings")}>
            {t("openSettings")}
          </Button>
        </header>

        {spanView === "execution" ? (
          <section
            aria-label={t("messageDetails")}
            className="flex min-h-[min(520px,calc(100dvh-14rem))] flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-neutral-50/60"
          >
            <div className="shrink-0 border-b border-border px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">{t("executionSteps")}</h2>
                <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                  <button type="button" onClick={() => setSpanView("tree")} className={viewToggleBtn(false)}>
                    {tTr("messageViewTree")}
                  </button>
                  <button type="button" onClick={() => setSpanView("graph")} className={viewToggleBtn(false)}>
                    {tTr("messageViewGraph")}
                  </button>
                  <button type="button" onClick={() => setSpanView("execution")} className={viewToggleBtn(true)}>
                    {tTr("threadDrawerViewCallGraph")}
                  </button>
                </div>
              </div>
              <MessageHint
                text={t("executionStepsHint")}
                className="mt-0.5"
                textClassName="text-xs text-ca-muted"
                clampClass="line-clamp-2"
              />
            </div>
            <ExecutionTraceFlow
              variant="trace"
              baseUrl={baseUrl}
              apiKey={apiKey}
              traceId={traceId}
              maxNodes={500}
              className="min-h-0 flex-1 bg-background"
              onOpenTrace={openTraceFromGraph}
              onSelectSpan={(id) => setSelectedSpanId(id)}
            />
          </section>
        ) : (
        <section aria-label={t("messageDetails")} className="flex min-h-[min(520px,calc(100dvh-14rem))] flex-col gap-4 lg:flex-row lg:items-stretch">
          {/* Left — execution steps */}
          <aside
            className="flex max-h-52 min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-neutral-50/60 lg:max-h-none lg:w-72 lg:min-h-0 lg:shrink-0 xl:w-80"
            aria-label={t("executionSteps")}
          >
            <div className="border-b border-border px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">{t("executionSteps")}</h2>
                <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                  <button type="button" onClick={() => setSpanView("tree")} className={viewToggleBtn(spanView === "tree")}>
                    {tTr("messageViewTree")}
                  </button>
                  <button type="button" onClick={() => setSpanView("graph")} className={viewToggleBtn(spanView === "graph")}>
                    {tTr("messageViewGraph")}
                  </button>
                  <button type="button" onClick={() => setSpanView("execution")} className={viewToggleBtn(false)}>
                    {tTr("threadDrawerViewCallGraph")}
                  </button>
                </div>
              </div>
              <MessageHint
                text={t("executionStepsHint")}
                className="mt-0.5"
                textClassName="text-xs text-ca-muted"
                clampClass="line-clamp-2"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-2">
              {spansQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-ca-muted">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                  {t("loading")}
                </div>
              ) : spansQuery.isError ? (
                <div className="p-4 text-sm text-red-700">{String(spansQuery.error)}</div>
              ) : spanView === "graph" ? (
                <div className="min-h-[min(52vh,420px)] w-full">
                  <SpanTraceFlow items={spansQuery.data?.items ?? []} semanticOnly />
                </div>
              ) : spanForest.length > 0 ? (
                filteredSpanForest.length > 0 ? (
                  <TraceSemanticTree
                    forest={filteredSpanForest}
                    selectedId={selectedSpanId}
                    onSelect={setSelectedSpanId}
                  />
                ) : (
                  <p className="p-4 text-sm text-ca-muted">{t("noMatches")}</p>
                )
              ) : (
                <MessageHint
                  className="p-4"
                  text={t("noExecutionSteps")}
                  textClassName="text-sm text-ca-muted"
                  clampClass="line-clamp-5"
                />
              )}
            </div>
          </aside>

          {/* Middle — step details */}
          <div
            className="flex min-h-[min(280px,45vh)] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm lg:min-h-[min(520px,calc(100dvh-14rem))]"
            aria-label={t("stepDetails")}
          >
            <TraceSpanRunPanel span={selectedSpan} chrome="embedded" />
          </div>

          {/* Right — basic information (trace, times, agent, channel, tokens) */}
          <aside className="flex min-h-0 w-full shrink-0 flex-col lg:w-[min(100%,22rem)] lg:min-w-[260px] lg:max-w-[24rem] lg:shrink-0">
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-neutral-50/40">
              <div className="shrink-0 border-b border-border bg-white/90 px-3 py-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("basicInformation")}</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
                <TraceInspectBasicHeader
                  layout="sidebar"
                  selectedSpan={selectedSpan}
                  traceId={traceId}
                  chipTags={messageInspectChipTags}
                  rowTokens={spanDerived?.totalTokens ?? null}
                  rowDurationMs={selectedSpanDurMs ?? spanDerived?.totalDuration ?? null}
                />
                <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{t("messageSummarySection")}</p>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("startTime")}</span>
                  <span className="text-xs text-neutral-900">
                    {formatTraceDateTimeLocal(spanDerived?.startTime ?? null)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("endTime")}</span>
                  <span className="text-xs text-neutral-900">
                    {formatTraceDateTimeLocal(spanDerived?.endTime ?? null)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("messageTotalDurationLabel")}</span>
                  <span className="text-xs tabular-nums text-neutral-900">
                    {spanDerived?.totalDuration != null
                      ? t("duration", { ms: spanDerived.totalDuration })
                      : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("agent")}</span>
                  <span className="text-xs text-neutral-900">
                    —
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("channel")}</span>
                  <span className="text-xs text-neutral-900">
                    —
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("stepCountLabel")}</span>
                  <span className="text-xs tabular-nums text-neutral-900">
                    {spanDerived?.stepCount != null ? spanDerived.stepCount.toLocaleString() : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("status")}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    {spanDerived == null ? (
                      "—"
                    ) : (
                      <>
                        <span
                          className={[
                            "h-2 w-2 rounded-full",
                            spanDerived.status === "success" ? "bg-emerald-500" : "bg-red-500",
                          ].join(" ")}
                          aria-hidden
                        />
                        {spanDerived.status === "success" ? t("success") : t("error")}
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </section>
        )}
      </main>
    </AppPageShell>
  );
}

export default function MessageDetailPage() {
  const t = useTranslations("Messages");
  return (
    <Suspense
      fallback={
        <AppPageShell variant="traces">
          <main className="ca-page relative z-[1]">
            <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
          </main>
        </AppPageShell>
      }
    >
      <MessageDetailContent />
    </Suspense>
  );
}
