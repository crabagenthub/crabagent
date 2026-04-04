"use client";

import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppPageShell } from "@/components/app-page-shell";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { Button } from "@/components/ui/button";
import { TraceInspectBasicHeader } from "@/components/trace-inspect-basic-header";
import { TraceSpanRunPanel } from "@/components/trace-span-run-panel";
import { TraceSpanAttributesPanel } from "@/components/trace-span-attributes-panel";
import { loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { formatShortId } from "@/lib/utils";
import { cn } from "@/lib/utils";

function StepDetailContent() {
  const t = useTranslations("Steps");
  const router = useRouter();
  const params = useParams<{ stepId: string }>();
  const stepId = decodeURIComponent(params.stepId ?? "");

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  // Mock step data - replace with actual API call
  const stepQuery = useQuery({
    queryKey: ["step", stepId],
    queryFn: async () => {
      // This should be replaced with actual step API call
      return {
        id: stepId,
        name: "minimax-m2.5:cloud · llm",
        type: "LLM",
        traceId: "trace_" + stepId,
        messageId: "message_" + stepId,
        agentId: "agent_001",
        agentName: "Assistant",
        channelId: "channel_001",
        channelName: "Default",
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 5900).toISOString(),
        duration: 5900,
        status: "success",
        input: {
          promptPreview: "This is a sample prompt for the execution step..."
        },
        output: {
          text: "This is the sample output from the execution step..."
        },
        tokens: {
          prompt: 8000,
          completion: 6081,
          total: 14081
        },
        metadata: {
          model: "minimax-m2.5",
          provider: "cloud",
          temperature: 0.7,
          maxTokens: 4000
        }
      };
    },
    enabled: mounted && stepId.length > 0,
  });

  const spanQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, baseUrl, apiKey, stepQuery.data?.traceId ?? ""],
    queryFn: () => {
      const tid = stepQuery.data?.traceId?.trim();
      if (!tid) {
        return Promise.reject(new Error("missing trace id"));
      }
      return loadSemanticSpans(baseUrl, apiKey, tid);
    },
    enabled: mounted && baseUrl.trim().length > 0 && Boolean(stepQuery.data?.traceId),
  });

  const currentSpan = useMemo(() => {
    const items = spanQuery.data?.items ?? [];
    return items.find((s) => s.span_id === stepId) ?? null;
  }, [spanQuery.data?.items, stepId]);

  const linkedStepCount = spanQuery.data?.items?.length ?? 0;

  const stepHeaderDurMs = useMemo(() => {
    if (
      currentSpan &&
      currentSpan.end_time != null &&
      Number.isFinite(currentSpan.start_time) &&
      Number.isFinite(currentSpan.end_time)
    ) {
      return Math.max(0, currentSpan.end_time - currentSpan.start_time);
    }
    return stepQuery.data?.duration ?? null;
  }, [currentSpan, stepQuery.data?.duration]);

  const stepInspectChipTags = useMemo(() => {
    const m = currentSpan?.module?.trim();
    return m ? [m] : [];
  }, [currentSpan?.module]);

  const stepShort = formatShortId(stepId);

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
          <LocalizedLink href="/steps" className="font-medium text-primary no-underline hover:underline">
            {t("backToList")}
          </LocalizedLink>
          <span aria-hidden className="text-neutral-400">
            /
          </span>
          <IdLabeledCopy
            kind="trace_id"
            value={stepId}
            displayText={stepShort}
            variant="compact"
            className="text-neutral-700"
          />
        </nav>

        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <IdLabeledCopy
              kind="trace_id"
              value={stepId}
              valueClassName="text-lg font-semibold tracking-tight md:text-xl"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {stepQuery.data?.name && (
                <span className="ca-pill-muted">
                  <span className="font-medium">{t("name")}:</span> {stepQuery.data.name}
                </span>
              )}
              {stepQuery.data?.type && (
                <span className="ca-pill-muted">
                  <span className="font-medium">{t("type")}:</span> {stepQuery.data.type}
                </span>
              )}
              {stepQuery.data?.status === "success" && (
                <span className="ca-pill-success">
                  <span className="font-medium">{t("status")}:</span> {t("success")}
                </span>
              )}
              {stepQuery.data?.duration && (
                <span className="ca-pill-muted text-xs">
                  {t("duration", { ms: stepQuery.data.duration })}
                </span>
              )}
              {stepQuery.data?.tokens?.total && (
                <span className="ca-pill-muted text-xs">
                  {t("tokens", { count: stepQuery.data.tokens.total.toLocaleString() })}
                </span>
              )}
            </div>
          </div>
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => router.push("/settings")}>
            {t("openSettings")}
          </Button>
        </header>

        <section aria-label={t("stepDetails")} className="flex min-h-[min(520px,calc(100dvh-14rem))] flex-col gap-4 lg:flex-row lg:items-stretch">
          {/* Left — execution steps */}
          <aside
            className="flex max-h-52 min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-neutral-50/60 lg:max-h-none lg:w-72 lg:min-h-0 lg:shrink-0 xl:w-80"
            aria-label={t("executionSteps")}
          >
            <div className="border-b border-border px-3 py-2.5">
              <h2 className="text-sm font-semibold text-neutral-900">{t("executionSteps")}</h2>
              <MessageHint
                text={t("executionStepsHint")}
                className="mt-0.5"
                textClassName="text-xs text-ca-muted"
                clampClass="line-clamp-2"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-2">
              {spanQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-ca-muted">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                  {t("loading")}
                </div>
              ) : spanQuery.isError ? (
                <div className="p-4 text-sm text-red-700">{String(spanQuery.error)}</div>
              ) : (
                <div className="space-y-1">
                  {spanQuery.data?.items?.map((span) => (
                    <button
                      key={span.span_id}
                      onClick={() => router.push(`/steps/${encodeURIComponent(span.span_id)}`)}
                      className={cn(
                        "w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left text-sm transition sm:px-3 sm:py-2.5",
                        span.span_id === stepId
                          ? "border-primary bg-white shadow-sm ring-1 ring-primary/25"
                          : "border-transparent bg-white/70 hover:border-border hover:bg-neutral-100/95"
                      )}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="truncate font-medium text-neutral-900">
                          {span.name || span.type}
                        </span>
                        {span.span_id === stepId && (
                          <span className="text-xs text-primary font-medium">
                            {t("current")}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-ca-muted">
                        <span className="font-mono">{formatShortId(span.span_id)}</span>
                        {span.type && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-950">
                            {span.type}
                          </span>
                        )}
                      </div>
                      {span.end_time && span.start_time && (
                        <div className="mt-1 text-[10px] text-ca-muted">
                          {t("duration", { ms: span.end_time - span.start_time })}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Middle — step details */}
          <div
            className="flex min-h-[min(280px,45vh)] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm lg:min-h-[min(520px,calc(100dvh-14rem))]"
            aria-label={t("stepDetails")}
          >
            <TraceSpanRunPanel span={currentSpan} chrome="embedded" />
          </div>

          {/* Right — basic information + span attributes */}
          <aside className="flex max-h-[min(88vh,920px)] min-h-0 w-full shrink-0 flex-col gap-4 overflow-y-auto lg:max-h-none lg:w-[min(100%,22rem)] lg:min-w-[260px] lg:max-w-[24rem] lg:shrink-0">
            <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-neutral-50/40">
              <div className="shrink-0 border-b border-border bg-white/90 px-3 py-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("basicInformation")}</h3>
              </div>
              <div className="max-h-[min(52vh,420px)] overflow-y-auto px-3 py-1 lg:max-h-none">
                <TraceInspectBasicHeader
                  layout="sidebar"
                  selectedSpan={currentSpan}
                  traceId={stepQuery.data?.traceId ?? ""}
                  fallbackSpanId={stepId}
                  chipTags={stepInspectChipTags}
                  rowTokens={stepQuery.data?.tokens?.total ?? null}
                  rowDurationMs={stepHeaderDurMs}
                />
                <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{t("stepSidebarContext")}</p>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("messageId")}</span>
                  <span className="break-all font-mono text-xs text-neutral-900">{stepQuery.data?.messageId || "—"}</span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("agent")}</span>
                  <span className="text-xs text-neutral-900">
                    {stepQuery.data?.agentName || stepQuery.data?.agentId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("channel")}</span>
                  <span className="text-xs text-neutral-900">
                    {stepQuery.data?.channelName || stepQuery.data?.channelId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("startTime")}</span>
                  <span className="text-xs text-neutral-900">{formatTraceDateTimeLocal(stepQuery.data?.startTime ?? null)}</span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("endTime")}</span>
                  <span className="text-xs text-neutral-900">{formatTraceDateTimeLocal(stepQuery.data?.endTime ?? null)}</span>
                </div>
                <div className="flex flex-col gap-0.5 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("linkedStepsCountLabel")}</span>
                  <span className="text-xs tabular-nums text-neutral-900">{linkedStepCount.toLocaleString()}</span>
                </div>
              </div>
            </div>
            <TraceSpanAttributesPanel variant="embedded" span={currentSpan} />
          </aside>
        </section>
      </main>
    </AppPageShell>
  );
}

export default function StepDetailPage() {
  const t = useTranslations("Steps");
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
      <StepDetailContent />
    </Suspense>
  );
}
