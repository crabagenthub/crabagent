"use client";

import ArcoInput from "@arco-design/web-react/es/Input";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { loadApiKey, loadCollectorUrl, saveApiKey, saveCollectorUrl } from "@/lib/collector";
import { readCollectorHealthResult } from "@/lib/collector-json";

import "@/lib/arco-react19-setup";

export const CRABAGENT_COLLECTOR_SETTINGS_EVENT = "crabagent-collector-settings";

function HealthStrip({ collectorUrl }: { collectorUrl: string }) {
  const t = useTranslations("Settings");
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
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {q.isFetching && <span className="ca-pill-muted">{t("checking")}</span>}
      {q.isError && (
        <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-700">
          {t("unreachable")}
        </span>
      )}
      {q.isSuccess && <span className="ca-pill-success">{t("ok")}</span>}
    </div>
  );
}

/**
 * Single place to edit Collector URL + API key (localStorage). Dispatches
 * `CRABAGENT_COLLECTOR_SETTINGS_EVENT` after a successful save so Trace views refetch.
 */
export function CollectorSettingsForm() {
  const t = useTranslations("Settings");
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mounted, setMounted] = useState(false);
  const [saveBanner, setSaveBanner] = useState<"ok" | "warn" | "err" | null>(null);
  const [saveErrDetail, setSaveErrDetail] = useState("");
  const saveBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUrl(loadCollectorUrl());
    setApiKey(loadApiKey());
    setMounted(true);
  }, []);

  useEffect(
    () => () => {
      if (saveBannerTimer.current) {
        clearTimeout(saveBannerTimer.current);
      }
    },
    [],
  );

  const save = async () => {
    if (saveBannerTimer.current) {
      clearTimeout(saveBannerTimer.current);
    }
    const urlT = url.trim();
    const keyT = apiKey.trim();
    try {
      saveCollectorUrl(urlT);
      saveApiKey(keyT);
    } catch (e) {
      setSaveBanner("err");
      setSaveErrDetail(e instanceof Error ? e.message : String(e));
      return;
    }

    flushSync(() => {
      setUrl(urlT);
      setApiKey(keyT);
    });

    try {
      await queryClient.fetchQuery({
        queryKey: ["health", urlT],
        queryFn: async () => {
          const res = await fetch(`${urlT.replace(/\/+$/, "")}/health`);
          return readCollectorHealthResult<unknown>(res, String(res.status));
        },
      });
      setSaveBanner("ok");
      setSaveErrDetail("");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(CRABAGENT_COLLECTOR_SETTINGS_EVENT));
      }
    } catch (e) {
      setSaveBanner("warn");
      setSaveErrDetail(e instanceof Error ? e.message : String(e));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(CRABAGENT_COLLECTOR_SETTINGS_EVENT));
      }
    }

    saveBannerTimer.current = setTimeout(() => setSaveBanner(null), 5000);
  };

  if (!mounted) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-full rounded-xl bg-neutral-200" />
        <div className="h-10 w-full rounded-xl bg-neutral-200" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="ca-card-pad space-y-5">
        <h2 className="text-sm font-semibold text-neutral-900">{t("connectionTitle")}</h2>
        <div>
          <span className="ca-label">{t("collectorUrl")}</span>
          <ArcoInput
            className="mt-1.5"
            value={url}
            onChange={setUrl}
            placeholder="http://127.0.0.1:8087"
            allowClear
          />
        </div>
        <div>
          <span className="ca-label">{t("apiKey")}</span>
          <ArcoInput.Password
            className="mt-1.5"
            autoComplete="off"
            value={apiKey}
            onChange={setApiKey}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            loading={saving}
            onClick={() => {
              setSaving(true);
              void save().finally(() => setSaving(false));
            }}
          >
            {t("saveSettings")}
          </Button>
          {saveBanner === "ok" && (
            <span className="text-sm font-medium text-primary" role="status">
              {t("saveOk")}
            </span>
          )}
          {saveBanner === "warn" && (
            <span className="text-sm font-medium text-amber-700" role="alert">
              {t("saveRefetchFailed")}: {saveErrDetail}
            </span>
          )}
          {saveBanner === "err" && (
            <span className="text-sm font-medium text-red-600" role="alert">
              {t("saveFailed")}
              {saveErrDetail ? `: ${saveErrDetail}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="ca-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ca-muted">{t("collectorHealth")}</h2>
        <p className="mt-3 break-all font-mono text-sm text-neutral-800">{url.trim() || "—"}</p>
        <HealthStrip collectorUrl={url.trim()} />
      </div>
    </div>
  );
}
