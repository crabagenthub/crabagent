"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppPageShell } from "@/components/app-page-shell";
import { CRABAGENT_COLLECTOR_SETTINGS_EVENT } from "@/components/collector-settings-form";
import { MessageHint } from "@/components/message-hint";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { loadCollectorUrl } from "@/lib/collector";
import { readCollectorHealthResult } from "@/lib/collector-json";

function HealthCheck({ collectorUrl }: { collectorUrl: string }) {
  const t = useTranslations("Home");
  const q = useQuery({
    queryKey: ["health", collectorUrl],
    queryFn: async () => {
      const res = await fetch(`${collectorUrl.replace(/\/+$/, "")}/health`);
      return readCollectorHealthResult<unknown>(res, String(res.status));
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
  const router = useRouter();
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
      <AppPageShell variant="home">
        <main className="ca-page-narrow relative z-[1]">
          <div className="animate-pulse space-y-4">
            <div className="h-9 w-48 rounded-lg bg-neutral-200" />
            <div className="h-4 w-full max-w-md rounded bg-neutral-200" />
          </div>
          <p className="mt-8 text-sm text-ca-muted">{t("loading")}</p>
        </main>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell variant="home">
      <main className="ca-page-narrow relative z-[1]">
      <div className="mb-6">
        <h1 className="ca-page-title">{t("title")}</h1>
        <MessageHint
          text={t("subtitle")}
          className="mt-3"
          textClassName="text-base leading-relaxed text-ca-muted"
          clampClass="line-clamp-3"
        />
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" variant="default" onClick={() => router.push("/traces")}>
            {t("openTraces")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/settings")}>
            {t("configureCollector")}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <HealthCheck collectorUrl={url.trim()} />
        <MessageHint text={t("tracesHint")} textClassName="text-sm leading-relaxed text-ca-muted" />
      </div>
    </main>
    </AppPageShell>
  );
}
