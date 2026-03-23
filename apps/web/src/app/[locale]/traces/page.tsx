"use client";

import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint } from "@/components/message-hint";
import { collectorAuthHeaders, loadApiKey, loadCollectorUrl } from "@/lib/collector";

type TraceRow = {
  /** Conversation thread id (session_key → session_id → trace_root_id). */
  thread_key: string;
  event_id: string;
  event_count?: number;
  trace_root_id?: string | null;
  session_id: string | null;
  session_key?: string | null;
  type: string;
  created_at: string;
  channel?: string | null;
};

function rowHasChannel(row: TraceRow): boolean {
  return Boolean(row.channel != null && String(row.channel).trim().length > 0);
}

async function loadTraces(baseUrl: string, apiKey: string): Promise<{ items: TraceRow[] }> {
  const b = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${b}/v1/traces?limit=100`, {
    headers: collectorAuthHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<{ items: TraceRow[] }>;
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
      void queryClient.invalidateQueries({ queryKey: ["traces"] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const q = useQuery({
    queryKey: ["traces", baseUrl, apiKey],
    queryFn: () => loadTraces(baseUrl, apiKey),
    enabled: mounted && baseUrl.trim().length > 0,
    refetchInterval: 10_000,
    staleTime: 0,
  });

  const traceRows = q.data?.items ?? [];
  const rawCount = traceRows.length;

  const lastUpdated =
    q.dataUpdatedAt > 0
      ? new Date(q.dataUpdatedAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : null;

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
            <p className="mt-2 text-sm text-neutral-600">{t("stats", { traces: rawCount })}</p>
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
        {q.isSuccess && traceRows.length === 0 && !missingUrl && (
          <div className="ca-card-pad">
            <div className="flex justify-center">
              <MessageHint
                text={t("empty")}
                textClassName="text-sm text-ca-muted text-center"
                clampClass="line-clamp-4"
              />
            </div>
          </div>
        )}
        {traceRows.length > 0 && (
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
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ca-border text-xs uppercase tracking-wide text-ca-muted">
                    <th className="px-5 py-3 font-semibold">{t("traceRoot")}</th>
                    <th className="px-5 py-3 font-semibold">{t("channel")}</th>
                    <th className="px-5 py-3 font-semibold">{t("listEventCount")}</th>
                    <th className="px-5 py-3 font-semibold">{t("session")}</th>
                    <th className="px-5 py-3 font-semibold">{t("eventSample")}</th>
                    <th className="px-5 py-3 font-semibold">{t("type")}</th>
                    <th className="px-5 py-3 font-semibold">{t("time")}</th>
                    <th className="px-5 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ca-border">
                  {traceRows.map((row) => (
                    <tr
                      key={row.thread_key}
                      className="bg-white transition-colors hover:bg-neutral-50/80"
                    >
                      <td className="max-w-[260px] px-5 py-3.5 align-top">
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
                      <td className="max-w-[100px] px-5 py-3.5">
                        {rowHasChannel(row) ? (
                          <span className="ca-pill-muted font-mono text-[11px] font-semibold">
                            {String(row.channel).trim()}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-xs tabular-nums text-neutral-700">
                        {typeof row.event_count === "number" ? row.event_count : "—"}
                      </td>
                      <td className="max-w-[200px] px-5 py-3.5 align-top">
                        <IdLabeledCopy kind="session_id" value={row.session_id} variant="compact" />
                      </td>
                      <td className="max-w-[200px] px-5 py-3.5 align-top">
                        <IdLabeledCopy
                          kind="event_id"
                          value={row.event_id}
                          displayText={
                            row.event_id.length > 14
                              ? `…${row.event_id.slice(-10)}`
                              : row.event_id
                          }
                          variant="compact"
                        />
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="ca-pill-muted font-mono text-[11px]">{row.type}</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-xs text-ca-muted">{row.created_at}</td>
                      <td className="px-5 py-3.5 text-right">
                        <LocalizedLink
                          href={`/traces/${encodeURIComponent(row.thread_key)}`}
                          className="inline-flex rounded-lg bg-ca-accent px-3 py-1.5 text-xs font-medium text-white no-underline transition hover:bg-ca-accent-hover"
                        >
                          {t("open")}
                        </LocalizedLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
