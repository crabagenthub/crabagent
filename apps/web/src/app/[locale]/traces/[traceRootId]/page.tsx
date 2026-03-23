"use client";

import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { pipelineCoverageFromEvents } from "@/lib/trace-detail-pipeline";
import {
  buildDetailEventList,
  buildUserTurnList,
  resolveEffectiveTraceRootId,
  resolveLinkedRunIdForTurn,
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

function shortTraceRootLabel(id: string): string {
  const t = id.trim();
  if (t.length <= 22) {
    return t;
  }
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

function pickBackfillFromEvents(
  events: TraceEvent[],
  kind: "chat_title" | "agent_id" | "agent_name",
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const row = events[i]!;
    if (kind === "chat_title") {
      const c = typeof row.chat_title === "string" ? row.chat_title.trim() : "";
      if (c) {
        return c;
      }
    } else if (kind === "agent_name") {
      const n = typeof row.agent_name === "string" ? row.agent_name.trim() : "";
      if (n) {
        return n;
      }
    } else {
      const a = typeof row.agent_id === "string" ? row.agent_id.trim() : "";
      if (a) {
        return a;
      }
    }
  }
  return null;
}

function TraceDetailContent() {
  const t = useTranslations("Traces");
  const queryClient = useQueryClient();
  const params = useParams<{ traceRootId: string }>();
  const searchParams = useSearchParams();
  /** Route segment is the Collector **thread_key** (conversation id), not a single trace_root_id. */
  const threadKey = decodeURIComponent(params.traceRootId ?? "");
  const focusMsg = (searchParams.get("msg") ?? "").trim();
  const focusMsgId = (searchParams.get("msg_id") ?? "").trim();

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

  const mergedHasOnlyMessageReceived = useMemo(() => {
    if (merged.length === 0) {
      return false;
    }
    return merged.every((e) => e.type === "message_received");
  }, [merged]);

  const userTurns = useMemo(() => buildUserTurnList(merged), [merged]);

  /** Resolved listKey from URL: `msg_id` (preferred) or legacy `msg` (= event_id). */
  const urlFocusListKey = useMemo(() => {
    if (userTurns.length === 0) {
      return "";
    }
    if (focusMsgId) {
      const hit = userTurns.find((u) => u.msgId === focusMsgId);
      if (hit) {
        return hit.listKey;
      }
    }
    if (focusMsg && userTurns.some((u) => u.listKey === focusMsg)) {
      return focusMsg;
    }
    return "";
  }, [userTurns, focusMsg, focusMsgId]);

  /** Per message: same slice as right-hand detail (`buildDetailEventList`), for left-column trace summary. */
  const turnTraceByListKey = useMemo(() => {
    const m = new Map<
      string,
      { eventCount: number; typeLabels: string[]; typeTotal: number; traceRoot: string | null }
    >();
    for (const u of userTurns) {
      const slice = buildDetailEventList(merged, u);
      const cov = pipelineCoverageFromEvents(slice);
      m.set(u.listKey, {
        eventCount: slice.length,
        typeLabels: cov.orderedTypes.slice(0, 6),
        typeTotal: cov.orderedTypes.length,
        traceRoot: resolveEffectiveTraceRootId(u, merged),
      });
    }
    return m;
  }, [merged, userTurns]);

  const [selectedListKey, setSelectedListKey] = useState<string>("");

  useEffect(() => {
    if (userTurns.length === 0) {
      return;
    }
    if (urlFocusListKey) {
      setSelectedListKey(urlFocusListKey);
      return;
    }
    setSelectedListKey((prev) => {
      if (prev && userTurns.some((u) => u.listKey === prev)) {
        return prev;
      }
      return userTurns[0]!.listKey;
    });
  }, [userTurns, urlFocusListKey]);

  const scrollFocusOnceRef = useRef(false);
  useEffect(() => {
    scrollFocusOnceRef.current = false;
  }, [threadKey, focusMsg, focusMsgId]);

  useLayoutEffect(() => {
    if (!urlFocusListKey) {
      return;
    }
    if (selectedListKey !== urlFocusListKey) {
      return;
    }
    if (scrollFocusOnceRef.current) {
      return;
    }
    scrollFocusOnceRef.current = true;
    const id = `ca-trace-turn-${urlFocusListKey}`;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.getElementById(`ca-trace-inbound-${urlFocusListKey}`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }, [urlFocusListKey, selectedListKey, userTurns.length]);

  const selectedTurn = useMemo(
    () => userTurns.find((u) => u.listKey === selectedListKey),
    [userTurns, selectedListKey],
  );

  const displayLinkedRunId = useMemo(() => {
    if (!selectedTurn) {
      return null;
    }
    return resolveLinkedRunIdForTurn(selectedTurn, merged);
  }, [selectedTurn, merged]);

  const detailEvents = useMemo(() => {
    if (!selectedTurn) {
      return [];
    }
    return buildDetailEventList(merged, selectedTurn);
  }, [merged, selectedTurn]);

  const detailPipeline = useMemo(() => pipelineCoverageFromEvents(detailEvents), [detailEvents]);

  const effectiveTraceRootId = useMemo(() => {
    if (!selectedTurn) {
      return null;
    }
    return resolveEffectiveTraceRootId(selectedTurn, merged);
  }, [merged, selectedTurn]);

  const detailHeader = useMemo(() => {
    if (!selectedTurn) {
      return {
        chatTitle: null as string | null,
        agentId: null as string | null,
        agentName: null as string | null,
        agentDisplay: null as string | null,
        traceRootId: null as string | null,
        msgId: null as string | null,
      };
    }
    const chatFallback = pickBackfillFromEvents(detailEvents, "chat_title");
    const agentIdFb = pickBackfillFromEvents(detailEvents, "agent_id");
    const agentNameFb = pickBackfillFromEvents(detailEvents, "agent_name");
    const agentId = selectedTurn.agentId ?? agentIdFb;
    const agentName = selectedTurn.agentName ?? agentNameFb;
    const agentDisplay = (agentName?.trim() || agentId?.trim() || null) as string | null;
    return {
      chatTitle: selectedTurn.chatTitle ?? chatFallback,
      agentId,
      agentName,
      agentDisplay,
      traceRootId: effectiveTraceRootId ?? selectedTurn.traceRootId,
      msgId: selectedTurn.msgId,
    };
  }, [selectedTurn, detailEvents, effectiveTraceRootId]);

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
              <span className="ca-pill-muted text-xs" title={t("threadFetchCountTitle")}>
                {t("threadFetchCount", { count: merged.length })}
              </span>
            )}
            {userTurns.length > 0 && (
              <span className="ca-pill-muted text-xs">{t("userTurnCount", { count: userTurns.length })}</span>
            )}
            {selectedTurn && (detailHeader.chatTitle || detailHeader.agentDisplay) ? (
              <div className="flex w-full flex-wrap gap-2 text-xs text-neutral-700">
                {detailHeader.chatTitle ? (
                  <span
                    className="max-w-full truncate rounded-full bg-sky-100/90 px-2.5 py-1 font-medium text-sky-950"
                    title={detailHeader.chatTitle}
                  >
                    {t("detailChatLabel")}: {detailHeader.chatTitle}
                  </span>
                ) : null}
                {detailHeader.agentDisplay ? (
                  <span
                    className="max-w-full truncate rounded-full bg-violet-100/90 px-2.5 py-1 font-medium text-violet-950"
                    title={
                      detailHeader.agentId && detailHeader.agentId !== detailHeader.agentDisplay
                        ? detailHeader.agentId
                        : undefined
                    }
                  >
                    {t("detailAgentLabel")}: {detailHeader.agentDisplay}
                  </span>
                ) : null}
              </div>
            ) : null}
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

      {mergedHasOnlyMessageReceived && !missingUrl && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3">
          <MessageHint
            text={t("detailMergedOnlyMessagesHint")}
            textClassName="text-sm leading-relaxed text-amber-950"
            clampClass="line-clamp-5"
          />
        </div>
      )}

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
                  const rowTrace = turnTraceByListKey.get(u.listKey);
                  return (
                    <li key={u.listKey}>
                      <button
                        type="button"
                        id={`ca-trace-turn-${u.listKey}`}
                        onClick={() => setSelectedListKey(u.listKey)}
                        className={`flex w-full flex-col rounded-xl border px-2.5 py-2 text-left text-sm transition sm:px-3 sm:py-2.5 ${
                          active
                            ? "border-ca-accent bg-white shadow-sm ring-1 ring-ca-accent/25"
                            : "border-transparent bg-white/70 hover:border-ca-border hover:bg-white"
                        }`}
                      >
                        <span className="line-clamp-3 break-words text-neutral-900">{u.preview}</span>
                        {u.chatTitle || u.agentName || u.agentId ? (
                          <div className="mt-1 space-y-0.5 text-[10px] leading-snug text-neutral-600">
                            {u.chatTitle ? (
                              <p className="truncate" title={u.chatTitle}>
                                <span className="font-semibold text-neutral-500">{t("detailChatLabel")}:</span>{" "}
                                {u.chatTitle}
                              </p>
                            ) : null}
                            {u.agentName || u.agentId ? (
                              <p
                                className="truncate"
                                title={u.agentId && u.agentId !== (u.agentName ?? "") ? u.agentId : undefined}
                              >
                                <span className="font-semibold text-neutral-500">{t("detailAgentLabel")}:</span>{" "}
                                {u.agentName?.trim() || u.agentId}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ca-muted">
                          <span className="font-mono">{u.whenLabel}</span>
                          {u.msgId ? (
                            <span className="font-mono text-[10px] text-sky-800" title={u.msgId}>
                              msg {u.msgId.length > 16 ? `…${u.msgId.slice(-8)}` : u.msgId}
                            </span>
                          ) : null}
                          {u.source === "llm_input" ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
                              {t("userTurnFallbackBadge")}
                            </span>
                          ) : null}
                          {(() => {
                            const rid = resolveLinkedRunIdForTurn(u, merged);
                            return rid ? (
                              <span className="font-mono text-[10px] text-violet-700">
                                run {rid.length > 14 ? `…${rid.slice(-8)}` : rid}
                              </span>
                            ) : (
                              <span className="text-amber-800/90">{t("noLinkedRunShort")}</span>
                            );
                          })()}
                        </span>
                        {rowTrace ? (
                          <div className="mt-2 border-t border-ca-border/70 pt-2 text-left">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/90">
                              {t("sidebarTraceForMessage")}
                            </p>
                            <p className="mt-1 font-mono text-[10px] text-neutral-700">
                              {t("sidebarTraceEventCount", { count: String(rowTrace.eventCount) })}
                              {rowTrace.traceRoot ? (
                                <>
                                  {" · "}
                                  <span className="text-emerald-900/90" title={rowTrace.traceRoot}>
                                    {t("sidebarTraceRootShort", {
                                      id: shortTraceRootLabel(rowTrace.traceRoot),
                                    })}
                                  </span>
                                </>
                              ) : (
                                <>
                                  {" · "}
                                  <span className="text-amber-800/90">{t("sidebarTraceNoRoot")}</span>
                                </>
                              )}
                            </p>
                            {rowTrace.typeLabels.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                {rowTrace.typeLabels.map((ty) => (
                                  <span
                                    key={ty}
                                    className="max-w-full truncate rounded bg-emerald-100/90 px-1.5 py-0.5 font-mono text-[9px] font-medium text-emerald-950"
                                    title={ty}
                                  >
                                    {ty}
                                  </span>
                                ))}
                                {rowTrace.typeTotal > rowTrace.typeLabels.length ? (
                                  <span className="text-[9px] font-medium text-emerald-800/80">
                                    +{rowTrace.typeTotal - rowTrace.typeLabels.length}
                                  </span>
                                ) : null}
                              </div>
                            ) : rowTrace.eventCount <= 1 ? (
                              <p className="mt-1 text-[10px] text-amber-800/85">{t("sidebarTraceNoTypesYet")}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ca-border bg-white shadow-ca-sm"
              aria-label={t("detailRightPanelTitle")}
            >
              <div className="space-y-2 border-b border-ca-border bg-neutral-50/80 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-neutral-900">{t("detailRightPanelTitle")}</h2>
                  {selectedTurn ? (
                    <span className="shrink-0 rounded-full bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-950">
                      {t("detailSliceEventBadge", { count: detailEvents.length })}
                    </span>
                  ) : null}
                </div>
                <MessageHint
                  text={t("detailRightPanelSubtitle")}
                  className="text-[11px]"
                  textClassName="text-[11px] leading-snug text-ca-muted"
                  clampClass="line-clamp-3"
                />
                {detailHeader.traceRootId ? (
                  <IdLabeledCopy kind="trace_root" value={detailHeader.traceRootId} variant="compact" />
                ) : (
                  <MessageHint
                    text={t("noTraceRootOnTurn")}
                    textClassName="text-xs text-amber-800"
                    clampClass="line-clamp-2"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {detailHeader.chatTitle ? (
                    <span
                      className="max-w-full truncate rounded-full bg-sky-100/90 px-2.5 py-1 text-xs font-medium text-sky-950"
                      title={detailHeader.chatTitle}
                    >
                      {t("detailChatLabel")}: {detailHeader.chatTitle}
                    </span>
                  ) : null}
                  {detailHeader.agentDisplay ? (
                    <span
                      className="max-w-full truncate rounded-full bg-violet-100/90 px-2.5 py-1 text-xs font-medium text-violet-950"
                      title={
                        detailHeader.agentId && detailHeader.agentId !== detailHeader.agentDisplay
                          ? detailHeader.agentId
                          : undefined
                      }
                    >
                      {t("detailAgentLabel")}: {detailHeader.agentDisplay}
                    </span>
                  ) : null}
                </div>
                {detailHeader.msgId ? (
                  <div className="pt-1">
                    <span className="text-xs font-medium text-ca-muted">{t("detailMsgIdLabel")}</span>
                    <div className="mt-1">
                      <IdLabeledCopy
                        kind="msg_id"
                        value={detailHeader.msgId}
                        displayText={
                          detailHeader.msgId.length > 22
                            ? `${detailHeader.msgId.slice(0, 8)}…${detailHeader.msgId.slice(-6)}`
                            : detailHeader.msgId
                        }
                        variant="compact"
                      />
                    </div>
                  </div>
                ) : null}
                {displayLinkedRunId ? (
                  <div className="pt-1">
                    <span className="text-xs font-medium text-ca-muted">{t("linkedRunLabel")}</span>
                    <div className="mt-1">
                      <IdLabeledCopy kind="run_id" value={displayLinkedRunId} variant="compact" />
                    </div>
                  </div>
                ) : selectedTurn && !detailHeader.traceRootId ? (
                  <MessageHint
                    text={t("noLinkedRunDetail")}
                    className="pt-1"
                    textClassName="text-xs text-amber-800"
                    clampClass="line-clamp-3"
                  />
                ) : null}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {selectedTurn ? (
                  <div
                    id={`ca-trace-inbound-${selectedTurn.listKey}`}
                    className="rounded-xl border border-ca-border/80 bg-neutral-50/50 px-3 py-2.5 sm:px-4 sm:py-3 scroll-mt-4"
                  >
                    <p className="text-xs font-semibold text-neutral-600">{t("inboundTextLabel")}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900">
                      {selectedTurn.fullText}
                    </p>
                  </div>
                ) : null}

                {detailEvents.length > 0 ? (
                  <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/50 px-3 py-2.5 sm:px-4 sm:py-3">
                    <p className="text-xs font-semibold text-emerald-950">{t("detailPipelineTitle")}</p>
                    <p className="mt-1 text-[11px] text-emerald-900/80">
                      {t("detailPipelineTypeCount", { count: String(detailPipeline.orderedTypes.length) })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {detailPipeline.orderedTypes.map((ty) => (
                        <span
                          key={ty}
                          className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/95 px-2 py-0.5 font-mono text-[10px] text-emerald-950 ring-1 ring-emerald-200/80"
                          title={ty}
                        >
                          <span className="truncate">{ty}</span>
                          <span className="shrink-0 tabular-nums text-emerald-700">
                            ×{detailPipeline.counts[ty] ?? 0}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {detailEvents.length > 0 ? (
                  <TraceTimelineTree events={detailEvents} />
                ) : selectedTurn && detailEvents.length === 0 ? (
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

export default function TraceDetailPage() {
  const t = useTranslations("Traces");
  return (
    <Suspense
      fallback={
        <main className="ca-page">
          <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
        </main>
      }
    >
      <TraceDetailContent />
    </Suspense>
  );
}
