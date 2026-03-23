"use client";

import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { collectorAuthHeaders, loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";

type TraceMessageRow = {
  id: number;
  event_id: string;
  thread_key: string;
  trace_root_id?: string | null;
  session_id: string | null;
  session_key?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  chat_title?: string | null;
  channel?: string | null;
  msg_id?: string | null;
  created_at: string;
  client_ts?: string | null;
  message_preview?: string | null;
};

function rowHasChannel(row: TraceMessageRow): boolean {
  return Boolean(row.channel != null && String(row.channel).trim().length > 0);
}

function rowHasAgent(row: TraceMessageRow): boolean {
  const id = row.agent_id != null && String(row.agent_id).trim().length > 0;
  const name = row.agent_name != null && String(row.agent_name).trim().length > 0;
  return Boolean(id || name);
}

function rowHasChatTitle(row: TraceMessageRow): boolean {
  return Boolean(row.chat_title != null && String(row.chat_title).trim().length > 0);
}

function rowMsgId(row: TraceMessageRow): string | null {
  const m = row.msg_id;
  if (typeof m !== "string" || !m.trim()) {
    return null;
  }
  return m.trim();
}

function messagePreviewText(row: TraceMessageRow): string {
  const p = row.message_preview;
  if (typeof p === "string" && p.trim().length > 0) {
    return p.trim();
  }
  return "—";
}

function detailHref(row: TraceMessageRow): string {
  const tk = encodeURIComponent(row.thread_key);
  const mid = rowMsgId(row);
  if (mid) {
    return `/traces/${tk}?msg_id=${encodeURIComponent(mid)}`;
  }
  return `/traces/${tk}?msg=${encodeURIComponent(row.event_id)}`;
}

async function loadTraceMessages(
  baseUrl: string,
  apiKey: string,
): Promise<{ items: TraceMessageRow[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${b}/v1/trace-messages?limit=200`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<{ items: TraceMessageRow[] }>;
}

export default function TracesPage() {
  const t = useTranslations("Traces");
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setBaseUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  useEffect(() => {
    const onSettings = () => {
      setBaseUrl(loadCollectorUrl());
      setApiKey(loadApiKey());
      void queryClient.invalidateQueries({ queryKey: ["trace-messages"] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const q = useQuery({
    queryKey: ["trace-messages", baseUrl, apiKey],
    queryFn: () => loadTraceMessages(baseUrl, apiKey),
    enabled: mounted && baseUrl.trim().length > 0,
    refetchInterval: 10_000,
    staleTime: 0,
  });

  const rows = q.data?.items ?? [];
  const rawCount = rows.length;

  const lastUpdated =
    q.dataUpdatedAt > 0 ? formatTraceDateTimeLocal(new Date(q.dataUpdatedAt).toISOString()) : null;

  const missingUrl = mounted && baseUrl.trim().length === 0;

  if (!mounted) {
    return (
      <main className="ca-page">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded-lg bg-neutral-200" />
          <div className="h-4 w-96 max-w-full rounded bg-neutral-200" />
        </div>
        <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
      </main>
    );
  }

  return (
    <main className="ca-page">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">{t("title")}</h1>
          <MessageHint
            text={t("subtitle")}
            className="mt-2 max-w-2xl"
            textClassName="text-base text-ca-muted"
            clampClass="line-clamp-3"
          />
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

      {q.isSuccess && lastUpdated && !missingUrl && (
        <section className="mb-8 rounded-2xl border border-ca-border bg-white/80 px-5 py-4 shadow-ca-sm backdrop-blur-sm">
          <p className="text-sm text-neutral-700">
            <span className="font-semibold text-neutral-900">{t("lastUpdated")}:</span>{" "}
            <span className="font-mono text-ca-muted">{lastUpdated}</span>
          </p>
          {rawCount > 0 && (
            <p className="mt-2 text-sm text-neutral-600">{t("statsMessages", { count: rawCount })}</p>
          )}
          {rawCount === 0 && (
            <MessageHint
              text={t("probeHint")}
              className="mt-2"
              textClassName="text-sm text-ca-muted"
              clampClass="line-clamp-3"
            />
          )}
        </section>
      )}

      <section aria-label={t("title")}>
        {q.isFetching && !q.data && !missingUrl && (
          <div className="flex items-center gap-2 text-sm text-ca-muted">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ca-border border-t-ca-accent" />
            {t("fetching")}
          </div>
        )}
        {q.isError && !missingUrl && (
          <div className="rounded-2xl border border-red-200 bg-red-50/80 px-5 py-4 text-sm text-red-800">
            <p className="font-medium">{String(q.error)}</p>
            <div className="mt-2">
              <MessageHint text={t("probeHint")} textClassName="text-sm text-red-700/90" clampClass="line-clamp-4" />
            </div>
            <LocalizedLink href="/settings" className="mt-3 inline-block font-medium text-ca-accent no-underline hover:underline">
              {t("openSettings")}
            </LocalizedLink>
          </div>
        )}
        {q.isSuccess && rows.length === 0 && !missingUrl && (
          <div className="ca-card-pad">
            <div className="flex justify-center">
              <MessageHint
                text={t("listMessagesEmpty")}
                textClassName="text-sm text-ca-muted text-center"
                clampClass="line-clamp-4"
              />
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <div className="ca-table-wrap">
            <div className="border-b border-ca-border bg-neutral-50/90 px-5 py-4">
              <h2 className="text-sm font-semibold text-neutral-900">{t("tableTitle")}</h2>
              <MessageHint
                text={t("tableSubtitle")}
                className="mt-0.5"
                textClassName="text-xs text-ca-muted"
                clampClass="line-clamp-2"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ca-border text-xs uppercase tracking-wide text-ca-muted">
                    <th className="px-5 py-3 font-semibold">{t("messageColumn")}</th>
                    <th className="px-5 py-3 font-semibold">{t("time")}</th>
                    <th className="px-5 py-3 font-semibold">{t("chatTitle")}</th>
                    <th className="px-5 py-3 font-semibold">{t("channel")}</th>
                    <th className="px-5 py-3 font-semibold">{t("agent")}</th>
                    <th className="px-5 py-3 font-semibold">{t("msgIdColumn")}</th>
                    <th className="px-5 py-3 font-semibold">{t("traceRoot")}</th>
                    <th className="px-5 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ca-border">
                  {rows.map((row) => {
                    const correlationId = rowMsgId(row);
                    return (
                    <tr key={row.event_id} className="bg-white transition-colors hover:bg-neutral-50/80">
                      <td className="max-w-md px-5 py-3.5 align-top">
                        <p className="line-clamp-3 break-words text-neutral-900">{messagePreviewText(row)}</p>
                        <div className="mt-1">
                          <IdLabeledCopy
                            kind="event_id"
                            value={row.event_id}
                            displayText={
                              row.event_id.length > 14 ? `…${row.event_id.slice(-10)}` : row.event_id
                            }
                            variant="compact"
                          />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-ca-muted align-top">
                        {formatTraceDateTimeLocal(row.client_ts ?? row.created_at)}
                      </td>
                      <td className="max-w-[180px] px-5 py-3.5 align-top">
                        {rowHasChatTitle(row) ? (
                          <span className="text-sm text-neutral-800" title={String(row.chat_title).trim()}>
                            {String(row.chat_title).trim()}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[100px] px-5 py-3.5 align-top">
                        {rowHasChannel(row) ? (
                          <span className="ca-pill-muted font-mono text-[11px] font-semibold">
                            {String(row.channel).trim()}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[200px] px-5 py-3.5 align-top">
                        {rowHasAgent(row) ? (
                          <div className="space-y-1">
                            <span
                              className="text-sm font-medium text-neutral-900"
                              title={
                                row.agent_name?.trim() && row.agent_id?.trim() && row.agent_name.trim() !== row.agent_id.trim()
                                  ? row.agent_id.trim()
                                  : undefined
                              }
                            >
                              {(row.agent_name?.trim() || row.agent_id?.trim() || "—") as string}
                            </span>
                            {row.agent_name?.trim() &&
                            row.agent_id?.trim() &&
                            row.agent_name.trim() !== row.agent_id.trim() ? (
                              <IdLabeledCopy kind="agent_id" value={row.agent_id.trim()} variant="compact" />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[200px] px-5 py-3.5 align-top">
                        {correlationId ? (
                          <IdLabeledCopy
                            kind="msg_id"
                            value={correlationId}
                            displayText={
                              correlationId.length > 14 ? `…${correlationId.slice(-10)}` : correlationId
                            }
                            variant="compact"
                          />
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[200px] px-5 py-3.5 align-top">
                        <IdLabeledCopy
                          kind="thread_key"
                          value={row.thread_key}
                          displayText={
                            row.thread_key.length > 36
                              ? `${row.thread_key.slice(0, 18)}…${row.thread_key.slice(-10)}`
                              : row.thread_key
                          }
                          variant="compact"
                        />
                      </td>
                      <td className="px-5 py-3.5 text-right align-top">
                        <LocalizedLink
                          href={detailHref(row)}
                          className="inline-flex rounded-lg bg-ca-accent px-3 py-1.5 text-xs font-medium text-white no-underline transition hover:bg-ca-accent-hover"
                        >
                          {t("open")}
                        </LocalizedLink>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
