"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { LocalizedLink } from "@/components/localized-link";
import { MessageHint, TitleHintIcon } from "@/components/message-hint";
import { loadCollectorUrl } from "@/lib/collector";

function HealthCheck({ collectorUrl }: { collectorUrl: string }) {
  const t = useTranslations("Home");
  const q = useQuery({
    queryKey: ["health", collectorUrl],
    queryFn: async () => {
      const res = await fetch(`${collectorUrl.replace(/\/+$/, "")}/health`);
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      return res.json();
    },
    enabled: collectorUrl.length > 0,
    retry: false,
  });

  return (
    <div className="ca-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ca-muted">{t("collectorHealth")}</h2>
      <p className="mt-3 break-all font-mono text-sm text-neutral-800">{collectorUrl || "—"}</p>
      <div className="mt-4 flex items-center gap-2">
        {q.isFetching && <span className="ca-pill-muted">{t("checking")}</span>}
        {q.isError && <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-700">{t("unreachable")}</span>}
        {q.isSuccess && <span className="ca-pill-success">{t("ok")}</span>}
      </div>
    </div>
  );
}

export default function HomePage() {
  const t = useTranslations("Home");
  const [url, setUrl] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setUrl(loadCollectorUrl());
    setMounted(true);
  }, []);

  useEffect(() => {
    const fn = () => setUrl(loadCollectorUrl());
    window.addEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, fn);
    return () => window.removeEventListener(CRABAGENT_COLLECTOR_SETTINGS_EVENT, fn);
  }, []);

  if (!mounted) {
    return (
      <main className="ca-page-narrow">
        <div className="animate-pulse space-y-4">
          <div className="h-9 w-48 rounded-lg bg-neutral-200" />
          <div className="h-4 w-full max-w-md rounded bg-neutral-200" />
        </div>
        <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
      </main>
    );
  }

  return (
    <main className="ca-page-narrow">
      <div className="mb-10">
        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
          <span>{t("title")}</span>
          <TitleHintIcon tooltipText={t("subtitle")} />
        </h1>
        <MessageHint
          text={t("subtitle")}
          className="mt-3"
          textClassName="text-base leading-relaxed text-ca-muted"
          clampClass="line-clamp-3"
        />
        <div className="mt-6 flex flex-wrap gap-3">
          <LocalizedLink href="/traces" className="ca-btn-primary inline-flex no-underline">
            {t("openTraces")}
          </LocalizedLink>
          <LocalizedLink href="/settings" className="ca-btn-secondary inline-flex no-underline">
            {t("configureCollector")}
          </LocalizedLink>
        </div>
      </div>

      <div className="space-y-6">
        <HealthCheck collectorUrl={url.trim()} />
        <MessageHint text={t("tracesHint")} textClassName="text-sm leading-relaxed text-ca-muted" />
      </div>
    </main>
  );
}
