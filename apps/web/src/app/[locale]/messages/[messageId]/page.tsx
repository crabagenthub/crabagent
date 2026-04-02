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
import { TraceSemanticTree } from "@/components/trace-semantic-tree";
import {
  collectorAuthHeaders,
  loadApiKey,
  loadCollectorUrl,
} from "@/lib/collector";
import { buildSpanForest, filterSpanForest } from "@/lib/build-span-tree";
import { COLLECTOR_QUERY_SCOPE } from "@/lib/collector-api-paths";
import { loadSemanticSpans } from "@/lib/semantic-spans";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { formatShortId } from "@/lib/utils";

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
      const start = new Date();
      const totalDuration = 5900;
      const end = new Date(start.getTime() + totalDuration);
      return {
        id: messageId,
        content: "Sample message content",
        traceId: "trace_" + messageId,
        agentId: "agent_001",
        agentName: "Assistant",
        channelId: "channel_001",
        channelName: "Default",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        stepCount: 1,
        totalDuration,
        totalTokens: 14081,
        status: "success",
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

  const messageInspectChipTags = useMemo(() => {
    const m = selectedSpan?.module?.trim();
    return m ? [m] : [];
  }, [selectedSpan?.module]);

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
          </div>
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => router.push("/settings")}>
            {t("openSettings")}
          </Button>
        </header>

        <section aria-label={t("messageDetails")} className="flex min-h-[min(520px,calc(100dvh-14rem))] flex-col gap-4 lg:flex-row lg:items-stretch">
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
                  traceId={messageQuery.data?.traceId ?? ""}
                  chipTags={messageInspectChipTags}
                  rowTokens={messageQuery.data?.totalTokens ?? null}
                  rowDurationMs={selectedSpanDurMs ?? messageQuery.data?.totalDuration ?? null}
                />
                <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{t("messageSummarySection")}</p>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("startTime")}</span>
                  <span className="text-xs text-neutral-900">
                    {formatTraceDateTimeLocal(messageQuery.data?.startTime ?? null)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("endTime")}</span>
                  <span className="text-xs text-neutral-900">
                    {formatTraceDateTimeLocal(messageQuery.data?.endTime ?? null)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("messageTotalDurationLabel")}</span>
                  <span className="text-xs tabular-nums text-neutral-900">
                    {messageQuery.data?.totalDuration != null
                      ? t("duration", { ms: messageQuery.data.totalDuration })
                      : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("agent")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.agentName || messageQuery.data?.agentId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("channel")}</span>
                  <span className="text-xs text-neutral-900">
                    {messageQuery.data?.channelName || messageQuery.data?.channelId || "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 border-b border-neutral-200/80 py-2.5">
                  <span className="text-[11px] font-medium text-neutral-500">{t("stepCountLabel")}</span>
                  <span className="text-xs tabular-nums text-neutral-900">
                    {messageQuery.data?.stepCount != null ? messageQuery.data.stepCount.toLocaleString() : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 py-2.5">
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
