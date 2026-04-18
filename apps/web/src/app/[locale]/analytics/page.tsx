"use client";

import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint } from "@/components/message-hint";
import { AppPageShell } from "@/components/app-page-shell";
import { TokenWasteHeatmap } from "@/components/token-waste-heatmap";
import type { TraceTimelineEvent } from "@/features/observe/traces/components/trace-timeline-tree";
import { collectorAuthHeaders, loadApiKey, loadCollectorUrl } from "@/lib/collector";
import { collectorItemsArray, readCollectorFetchResult } from "@/lib/collector-json";
import {
  buildTokenWasteRowForThread,
  maxTurnCount,
  normalizeHeatAcrossThreads,
  type TokenWasteThreadRow,
} from "@/lib/token-waste-heatmap";

const THREAD_CAP = 22;
const TRACE_MSG_LIMIT = 120;
const TURN_COL_CAP = 20;
const FETCH_CHUNK = 5;

type TraceMessageRow = {
  thread_key: string;
  chat_title?: string | null;
  agent_name?: string | null;
};

function uniqueThreadMetasOrdered(items: TraceMessageRow[], cap: number): TraceMessageRow[] {
  const seen = new Set<string>();
  const out: TraceMessageRow[] = [];
  for (const r of items) {
    const k = typeof r.thread_key === "string" ? r.thread_key.trim() : "";
    if (!k || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(r);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

function rowLabel(meta: TraceMessageRow): string {
  const title = meta.chat_title != null ? String(meta.chat_title).trim() : "";
  if (title) {
    return title;
  }
  const agent = meta.agent_name != null ? String(meta.agent_name).trim() : "";
  if (agent) {
    return agent;
  }
  const tk = meta.thread_key;
  return tk.length <= 20 ? tk : `${tk.slice(0, 18)}…`;
}

async function loadTokenWasteHeatmap(baseUrl: string, apiKey: string): Promise<{
  rows: TokenWasteThreadRow[];
  maxTurnCols: number;
}> {
  const b = baseUrl.replace(/\/+$/, "");
  const msgRes = await fetch(`${b}/v1/trace-messages?limit=${TRACE_MSG_LIMIT}`, {
    headers: collectorAuthHeaders(apiKey),
  });
  const msgBody = await readCollectorFetchResult<{ items?: TraceMessageRow[] }>(
    msgRes,
    `trace-messages HTTP ${msgRes.status}`,
  );
  const ordered = uniqueThreadMetasOrdered(collectorItemsArray<TraceMessageRow>(msgBody.items), THREAD_CAP);

  const rows: TokenWasteThreadRow[] = [];
  for (let i = 0; i < ordered.length; i += FETCH_CHUNK) {
    const part = ordered.slice(i, i + FETCH_CHUNK);
    const batch = await Promise.all(
      part.map(async (meta) => {
        const evRes = await fetch(
          `${b}/v1/traces/${encodeURIComponent(meta.thread_key)}/events?limit=2000`,
          { headers: collectorAuthHeaders(apiKey) },
        );
        if (!evRes.ok) {
          return null;
        }
        const evBody = await readCollectorFetchResult<{ items?: TraceTimelineEvent[] }>(
          evRes,
          `trace events HTTP ${evRes.status}`,
        );
        return buildTokenWasteRowForThread({
          threadKey: meta.thread_key,
          label: rowLabel(meta),
          events: collectorItemsArray<TraceTimelineEvent>(evBody.items),
        });
      }),
    );
    for (const r of batch) {
      if (r) {
        rows.push(r);
      }
    }
  }

  const normalized = normalizeHeatAcrossThreads(rows);
  return {
    rows: normalized,
    maxTurnCols: maxTurnCount(normalized, TURN_COL_CAP),
  };
}

export default function AnalyticsPage() {
  const t = useTranslations("Analytics");
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
      void queryClient.invalidateQueries({ queryKey: ["analytics-token-waste"] });
    };
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, onSettings);
  }, [queryClient]);

  const q = useQuery({
    queryKey: ["analytics-token-waste", baseUrl, apiKey],
    queryFn: () => loadTokenWasteHeatmap(baseUrl, apiKey),
    enabled: mounted && baseUrl.trim().length > 0,
    staleTime: 45_000,
  });

  const missingUrl = mounted && baseUrl.trim().length === 0;

  return (
    <AppPageShell variant="analytics">
      <main className="ca-page relative z-[1]">
        <header className="mb-6">
          <h1 className="ca-page-title">{t("title")}</h1>
          <MessageHint
            text={t("subtitle")}
            className="mt-2"
            textClassName="text-base text-ca-muted"
            clampClass="line-clamp-3"
          />
        </header>

        {missingUrl ? (
          <p className="text-sm text-ca-muted">{t("needCollector")}</p>
        ) : (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">{t("wasteHeatmapTitle")}</h2>
              <p className="mt-1 text-xs text-ca-muted">{t("wasteHeatmapHint")}</p>
            </div>

            {q.isFetching && !q.data ? (
              <p className="text-sm text-ca-muted">{t("wasteHeatmapLoading")}</p>
            ) : null}
            {q.isError ? (
              <p className="text-sm text-red-700">
                {t("wasteHeatmapError", { message: q.error instanceof Error ? q.error.message : "error" })}
              </p>
            ) : null}
            {q.data ? (
              <TokenWasteHeatmap rows={q.data.rows} maxTurnCols={q.data.maxTurnCols} />
            ) : null}
          </section>
        )}
      </main>
    </AppPageShell>
  );
}
