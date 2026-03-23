"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { TraceTimelineTree, type TraceTimelineEvent } from "@/components/trace-timeline-tree";
import {
  collectorAuthHeaders,
  loadApiKey,
  loadCollectorUrl,
  streamUrl,
} from "@/lib/collector";
import {
  buildUserTurnList,
  filterEventsForRun,
  type UserTurnListItem,
} from "@/lib/user-turn-list";

type TraceEvent = TraceTimelineEvent;

function mergeByEventId(base: TraceEvent[], extra: TraceEvent[]): TraceEvent[] {
  const seen = new Set<string>();
  const out: TraceEvent[] = [];
  for (const row of [...base, ...extra]) {
    const id = typeof row.event_id === "string" ? row.event_id : null;
    if (id) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
    }
    out.push(row);
  }
  return out;
}

async function loadTraceEvents(
  baseUrl: string,
  apiKey: string,
  threadKey: string,
): Promise<{ items: TraceEvent[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${b}/v1/traces/${encodeURIComponent(threadKey)}/events`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<{ items: TraceEvent[] }>;
}

function firstSessionIdInEvents(events: TraceEvent[]): string | null {
  for (const row of events) {
    if (typeof row.session_id === "string" && row.session_id.trim()) {
      return row.session_id.trim();
    }
  }
  return null;
}

export default function TraceDetailPage() {
  const t = useTranslations("Traces");
  const queryClient = useQueryClient();
  const params = useParams<{ traceRootId: string }>();
  /** Route segment is the Collector **thread_key** (conversation id), not a single trace_root_id. */
  const threadKey = decodeURIComponent(params.traceRootId ?? "");

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [sseOpen, setSseOpen] = useState(false);
  const [liveEvents, setLiveEvents] = useState<TraceEvent[]>([]);

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      void queryClient.invalidateQueries({ queryKey: ["trace-events"] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const eventsQuery = useQuery({
    queryKey: ["trace-events", baseUrl, apiKey, threadKey],
    queryFn: () => loadTraceEvents(baseUrl, apiKey, threadKey),
    enabled: mounted && baseUrl.length > 0 && threadKey.length > 0,
  });

  const merged = useMemo(() => {
    const historical = eventsQuery.data?.items ?? [];
    return mergeByEventId(historical, liveEvents);
  }, [eventsQuery.data?.items, liveEvents]);

  const userTurns = useMemo(() => buildUserTurnList(merged), [merged]);

  const [selectedListKey, setSelectedListKey] = useState<string>("");

  useEffect(() => {
    if (userTurns.length === 0) {
      return;
    }
    if (!selectedListKey || !userTurns.some((u) => u.listKey === selectedListKey)) {
      setSelectedListKey(userTurns[0]!.listKey);
    }
  }, [userTurns, selectedListKey]);

  const selectedTurn = useMemo(
    () => userTurns.find((u) => u.listKey === selectedListKey),
    [userTurns, selectedListKey],
  );

  const detailEvents = useMemo(() => {
    if (!selectedTurn) {
      return [];
    }
    if (selectedTurn.linkedRunId) {
      return filterEventsForRun(merged, selectedTurn.linkedRunId);
    }
    return merged.filter((e) => e.event_id === selectedTurn.listKey);
  }, [merged, selectedTurn]);

  const sessionIdForDelete = useMemo(() => firstSessionIdInEvents(merged), [merged]);

  useEffect(() => {
    if (!mounted || !baseUrl || !threadKey) {
      return;
    }
    const url = streamUrl(baseUrl, threadKey, apiKey);
    const es = new EventSource(url);

    const onReady = () => setSseOpen(true);
    es.addEventListener("ready", onReady);

    es.onmessage = (ev) => {
      try {
        const row = JSON.parse(ev.data) as TraceEvent;
        setLiveEvents((prev) => mergeByEventId(prev, [row]));
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      setSseOpen(false);
    };

    return () => {
      es.removeEventListener("ready", onReady);
      es.close();
      setSseOpen(false);
    };
  }, [mounted, baseUrl, threadKey, apiKey]);

  const deleteSession = async () => {
    const sid = sessionIdForDelete;
    if (!sid || !baseUrl) {
      return;
    }
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/v1/sessions/${encodeURIComponent(sid)}`,
      { method: "DELETE", headers: collectorAuthHeaders(apiKey) },
    );
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    setLiveEvents([]);
    await eventsQuery.refetch();
  };

  const threadShort =
    threadKey.length > 24 ? `${threadKey.slice(0, 12)}…${threadKey.slice(-8)}` : threadKey;

  const missingUrl = mounted && baseUrl.trim().length === 0;

  if (!mounted) {
    return (
      <main className="ca-page">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded-lg bg-neutral-200" />
          <div className="h-4 w-full max-w-md rounded bg-neutral-200" />
        </div>
        <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
      </main>
    );
  }

  return (
    <main className="ca-page">
      <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-ca-muted" aria-label="Breadcrumb">
        <LocalizedLink href="/traces" className="font-medium text-ca-accent no-underline hover:underline">
          {t("backToList")}
        </LocalizedLink>
        <span aria-hidden className="text-neutral-400">
          /
        </span>
        <IdLabeledCopy
          kind="thread_key"
          value={threadKey}
          displayText={threadShort}
          variant="compact"
          className="text-neutral-700"
        />
      </nav>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <IdLabeledCopy
              kind="thread_key"
              value={threadKey}
              valueClassName="text-xl font-semibold tracking-tight md:text-2xl"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={sseOpen ? "ca-pill-success" : "ca-pill-muted"}>
              <span className="font-medium">{t("live")}:</span>{" "}
              {sseOpen ? t("sseConnected") : t("sseDisconnected")}
            </span>
            {merged.length > 0 && (
              <span className="ca-pill-muted text-xs">{t("eventCount", { count: merged.length })}</span>
            )}
            {userTurns.length > 0 && (
              <span className="ca-pill-muted text-xs">{t("userTurnCount", { count: userTurns.length })}</span>
            )}
            {sessionIdForDelete && !missingUrl && (
              <button
                type="button"
                className="ca-btn-danger"
                onClick={() => {
                  if (!window.confirm(t("confirmDeleteSession"))) {
                    return;
                  }
                  void deleteSession().catch(() => {});
                }}
              >
                {t("deleteSession")}
              </button>
            )}
          </div>
        </div>
        <LocalizedLink href="/settings" className="ca-btn-secondary shrink-0 no-underline">
          {t("openSettings")}
        </LocalizedLink>
      </header>

      {missingUrl && (
        <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-950">
          <MessageHint
            text={t("needCollectorUrl")}
            textClassName="text-sm leading-relaxed text-amber-950"
            clampClass="line-clamp-4"
          />
          <LocalizedLink href="/settings" className="mt-2 inline-block font-medium text-ca-accent no-underline hover:underline">
            {t("openSettings")}
          </LocalizedLink>
        </div>
      )}

      <section aria-label={t("events")} className="flex min-h-[min(520px,calc(100dvh-14rem))] flex-col gap-4 lg:flex-row lg:items-stretch">
        {eventsQuery.isLoading && !eventsQuery.data && !missingUrl && (
          <div className="flex items-center gap-2 text-sm text-ca-muted">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ca-border border-t-ca-accent" />
            {t("loading")}
          </div>
        )}

        {eventsQuery.isError && !missingUrl && (
          <div className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 text-sm text-red-800">
            {t("loadEventsFailed", { error: String(eventsQuery.error) })}
            <LocalizedLink href="/settings" className="mt-3 block font-medium text-ca-accent no-underline hover:underline">
              {t("openSettings")}
            </LocalizedLink>
          </div>
        )}

        {merged.length > 0 && userTurns.length > 0 && (
          <>
            <aside
              className="flex max-h-52 min-h-0 shrink-0 flex-col rounded-2xl border border-ca-border bg-neutral-50/60 lg:max-h-none lg:w-72 lg:min-h-0 lg:shrink-0 xl:w-80"
              aria-label={t("userMessagesTitle")}
            >
              <div className="border-b border-ca-border px-3 py-2.5">
                <h2 className="text-sm font-semibold text-neutral-900">{t("userMessagesTitle")}</h2>
                <MessageHint
                  text={t("userMessagesHint")}
                  className="mt-0.5"
                  textClassName="text-xs text-ca-muted"
                  clampClass="line-clamp-2"
                />
              </div>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5 sm:p-2">
                {userTurns.map((u: UserTurnListItem) => {
                  const active = u.listKey === selectedListKey;
                  return (
                    <li key={u.listKey}>
                      <button
                        type="button"
                        onClick={() => setSelectedListKey(u.listKey)}
                        className={`flex w-full flex-col rounded-xl border px-2.5 py-2 text-left text-sm transition sm:px-3 sm:py-2.5 ${
                          active
                            ? "border-ca-accent bg-white shadow-sm ring-1 ring-ca-accent/25"
                            : "border-transparent bg-white/70 hover:border-ca-border hover:bg-white"
                        }`}
                      >
                        <span className="line-clamp-3 break-words text-neutral-900">{u.preview}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ca-muted">
                          <span className="font-mono">{u.whenLabel}</span>
                          {u.source === "llm_input" ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
                              {t("userTurnFallbackBadge")}
                            </span>
                          ) : null}
                          {u.linkedRunId ? (
                            <span className="font-mono text-[10px] text-violet-700">
                              run {u.linkedRunId.length > 14 ? `…${u.linkedRunId.slice(-8)}` : u.linkedRunId}
                            </span>
                          ) : (
                            <span className="text-amber-800/90">{t("noLinkedRunShort")}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ca-border bg-white shadow-ca-sm">
              <div className="border-b border-ca-border bg-neutral-50/80 px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">{t("traceForTurnTitle")}</h2>
                {selectedTurn?.linkedRunId ? (
                  <div className="mt-2">
                    <IdLabeledCopy kind="run_id" value={selectedTurn.linkedRunId} variant="compact" />
                  </div>
                ) : (
                  <MessageHint
                    text={t("noLinkedRunDetail")}
                    className="mt-2"
                    textClassName="text-xs text-amber-800"
                    clampClass="line-clamp-3"
                  />
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {selectedTurn ? (
                  <div className="rounded-xl border border-ca-border/80 bg-neutral-50/50 px-3 py-2.5 sm:px-4 sm:py-3">
                    <p className="text-xs font-semibold text-neutral-600">{t("inboundTextLabel")}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900">
                      {selectedTurn.fullText}
                    </p>
                  </div>
                ) : null}

                {detailEvents.length > 0 ? (
                  <TraceTimelineTree events={detailEvents} />
                ) : selectedTurn && !selectedTurn.linkedRunId ? (
                  <MessageHint text={t("noRunEventsYet")} textClassName="text-sm text-ca-muted" />
                ) : null}
              </div>
            </div>
          </>
        )}

        {merged.length > 0 && userTurns.length === 0 && !missingUrl && (
          <div className="ca-card-pad">
            <div className="flex justify-center">
              <MessageHint
                text={t("noTurnsExtracted")}
                textClassName="text-sm text-ca-muted text-center"
                clampClass="line-clamp-4"
              />
            </div>
          </div>
        )}

        {eventsQuery.isSuccess && merged.length === 0 && !missingUrl && (
          <div className="ca-card-pad">
            <div className="flex justify-center">
              <MessageHint
                text={t("detailEmpty")}
                textClassName="text-sm text-ca-muted text-center"
                clampClass="line-clamp-4"
              />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
