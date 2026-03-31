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
import { TraceSpanRunPanel } from "@/components/trace-span-run-panel";
import { TraceSpanAttributesPanel } from "@/components/trace-span-attributes-panel";
import { TraceSemanticTree } from "@/components/trace-semantic-tree";
import {
  collectorAuthHeaders,
  loadApiKey,
  loadCollectorUrl,
} from "@/lib/collector";
import { buildSpanForest, filterSpanForest } from "@/lib/build-span-tree";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import { formatShortId } from "@/lib/utils";
import { cn } from "@/lib/utils";

function MessageDetailContent() {
  const t = useTranslations("Messages");
  const router = useRouter();
  const params = useParams<{ messageId: string }>();
  const messageId = decodeURIComponent(params.messageId ?? "");

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState("");

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  // Mock message data - replace with actual API call
  const messageQuery = useQuery({
    queryKey: ["message", messageId],
    queryFn: async () => {
      // This should be replaced with actual message API call
      return {
        id: messageId,
        content: "Sample message content",
        traceId: "trace_" + messageId,
        agentId: "agent_001",
        agentName: "Assistant",
        channelId: "channel_001",
        channelName: "Default",
        startTime: new Date().toISOString(),
        stepCount: 1,
        totalDuration: 5900,
        totalTokens: 14081,
        status: "success"
      };
    },
    enabled: mounted && messageId.length > 0,
  });

  const spansQuery = useQuery({
    queryKey: [COLLECTOR_QUERY_SCOPE.traceSpans, baseUrl, apiKey, messageQuery.data?.traceId ?? ""],
    queryFn: () => loadSemanticSpans(baseUrl, apiKey, messageQuery.data?.traceId!),
    enabled: mounted && baseUrl.trim().length > 0 && Boolean(messageQuery.data?.traceId),
  });

  const spanForest = useMemo(
    () => buildSpanForest(spansQuery.data?.items ?? []),
    [spansQuery.data?.items],
  );

  const filteredSpanForest = useMemo(() => filterSpanForest(spanForest, treeFilter), [spanForest, treeFilter]);

  const selectedSpan = useMemo(() => {
    const items = spansQuery.data?.items ?? [];
    return items.find((s) => s.span_id === selectedSpanId) ?? null;
  }, [spansQuery.data?.items, selectedSpanId]);

  const messageShort = formatShortId(messageId);

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
          <div className="min-w-0 flex-1">
            <IdLabeledCopy
              kind="trace_id"
              value={messageId}
              valueClassName="text-lg font-semibold tracking-tight md:text-xl"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {messageQuery.data?.status === "success" && (
                <span className="ca-pill-success">
                  <span className="font-medium">{t("status")}:</span> {t("success")}
                </span>
              )}
              {messageQuery.data?.stepCount && (
                <span className="ca-pill-muted text-xs">
                  {t("stepCount", { count: messageQuery.data.stepCount })}
                </span>
              )}
              {messageQuery.data?.totalDuration && (
                <span className="ca-pill-muted text-xs">
                  {t("duration", { ms: messageQuery.data.totalDuration })}
                </span>
              )}
              {messageQuery.data?.totalTokens && (
                <span className="ca-pill-muted text-xs">
                  {t("tokens", { count: messageQuery.data.totalTokens.toLocaleString() })}
                </span>
              )}
            </div>
          </div>
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => router.push("/settings")}>
            {t("openSettings")}
          </Button>
        </header>

        <section aria-label={t("messageDetails")} className="flex min-h-[min(520px,calc(100dvh-14rem))] flex-col gap-4 lg:flex-row lg:items-stretch">
          {/* Left Column - Message and Execution Steps */}
          <aside
            className="flex max-h-52 min-h-0 shrink-0 flex-col rounded-2xl border border-border bg-neutral-50/60 lg:max-h-none lg:w-72 lg:min-h-0 lg:shrink-0 xl:w-80"
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
              {spansQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-ca-muted">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                  {t("loading")}
                </div>
              ) : spansQuery.isError ? (
                <div className="p-4 text-sm text-red-700">{String(spansQuery.error)}</div>
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

          {/* Middle Column - Step Details */}
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm"
            aria-label={t("stepDetails")}
          >
            <TraceSpanRunPanel span={selectedSpan} chrome="embedded" />
          </div>

          {/* Right Column - Basic Information */}
          <aside className="flex min-h-[200px] w-full shrink-0 flex-col lg:w-56 lg:max-w-[260px] 2xl:w-64 2xl:max-w-none">
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col border-t border-border bg-neutral-50/40 lg:border-l lg:border-t-0">
              <div className="shrink-0 border-b border-border bg-white/90 px-3 py-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("basicInformation")}</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("traceId")}</span>
                  <span className="text-xs text-neutral-900 font-mono break-all">
                    {messageQuery.data?.traceId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("startTime")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.startTime ? new Date(messageQuery.data.startTime).toLocaleString() : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("agent")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.agentName || messageQuery.data?.agentId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("channel")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.channelName || messageQuery.data?.channelId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("stepCount")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.stepCount?.toLocaleString() || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("totalTime")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.totalDuration ? `${(messageQuery.data.totalDuration / 1000).toFixed(1)}s` : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("totalTokens")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.totalTokens?.toLocaleString() || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5 last:border-b-0">
                  <span className="text-[11px] font-medium text-neutral-500">{t("status")}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span
                      className={[
                        "h-2 w-2 rounded-full",
                        messageQuery.data?.status === "success" ? "bg-emerald-500" : "bg-red-500",
                      ].join(" ")}
                      aria-hidden
                    />
                    {messageQuery.data?.status === "success" ? t("success") : t("error")}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </section>
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
