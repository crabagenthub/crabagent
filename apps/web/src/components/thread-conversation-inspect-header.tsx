"use client";

import { IconCopy, IconInfoCircle } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ThreadLlmUsageAggregate } from "@/lib/trace-payload-usage";
import type { ThreadRecordRow } from "@/lib/thread-records";
import { cn } from "@/lib/utils";

function CopyIconButton({
  text,
  ariaLabel,
  successLabel,
}: {
  text: string;
  ariaLabel: string;
  successLabel: string;
}) {
  const [showOk, setShowOk] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, []);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
      }
      setShowOk(true);
      hideTimer.current = window.setTimeout(() => setShowOk(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => void onClick()}
        className="inline-flex rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200/80 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-label={ariaLabel}
      >
        <IconCopy className="size-3.5" />
      </button>
      {showOk ? (
        <span
          className="whitespace-nowrap text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
          role="status"
          aria-live="polite"
        >
          {successLabel}
        </span>
      ) : null}
    </span>
  );
}

function threadRowStatusPresentation(st: string | null | undefined): {
  labelKey: "statusRunning" | "statusSuccess" | "statusError" | "statusTimeout" | "statusOther";
  error: boolean;
  timeout: boolean;
  running: boolean;
  muted: boolean;
} {
  const s = st?.trim().toLowerCase();
  if (s === "running") {
    return { labelKey: "statusRunning", error: false, timeout: false, running: true, muted: false };
  }
  if (s === "success") {
    return { labelKey: "statusSuccess", error: false, timeout: false, running: false, muted: false };
  }
  if (s === "error") {
    return { labelKey: "statusError", error: true, timeout: false, running: false, muted: false };
  }
  if (s === "timeout") {
    return { labelKey: "statusTimeout", error: false, timeout: true, running: false, muted: false };
  }
  return { labelKey: "statusOther", error: false, timeout: false, running: false, muted: true };
}

function formatTokenAmount(n: number | null): string {
  if (n == null) {
    return "—";
  }
  return n.toLocaleString();
}

type Props = {
  row: ThreadRecordRow | null;
  threadKey: string;
  threadShort: string;
  metaStart: string;
  metaDuration: string;
  metaMsgCount: number;
  /** 会话列表接口合计，在无 `llm_output` 分项时用于「总 token」兜底 */
  listTotalTokens: number;
  threadUsage: ThreadLlmUsageAggregate;
  /** 右侧窄栏：双列栅格；会话 ID 置顶并占满一行 */
  variant?: "default" | "sidebar";
};

/**
 * 与会话详情右栏：顶栏栅格（会话 ID 置顶，智能体、渠道、耗时、开始时间、轮次、状态）+ 计费/Token 用量。
 */
export function ThreadConversationInspectHeader({
  row,
  threadKey,
  threadShort,
  metaStart,
  metaDuration,
  metaMsgCount,
  listTotalTokens,
  threadUsage,
  variant = "default",
}: Props) {
  const t = useTranslations("Traces");

  const agentLine = row?.agent_name?.trim() || "—";
  const channelLine = row?.channel_name?.trim() || "—";

  const fromEvents = threadUsage.llmOutputCount > 0;
  const inputVal = fromEvents ? threadUsage.prompt : null;
  const outputVal = fromEvents ? threadUsage.completion : null;
  const cacheVal = fromEvents ? threadUsage.cacheRead : null;
  const totalVal: number | null = (() => {
    if (fromEvents) {
      if (threadUsage.displayTotal != null) {
        return threadUsage.displayTotal;
      }
      const parts = threadUsage.prompt + threadUsage.completion + threadUsage.cacheRead;
      if (parts > 0) {
        return parts;
      }
      if (listTotalTokens > 0) {
        return listTotalTokens;
      }
      return 0;
    }
    return listTotalTokens > 0 ? listTotalTokens : null;
  })();

  const st = threadRowStatusPresentation(row?.status);
  const rawStatus = row?.status?.trim();
  const statusText = !rawStatus ? "—" : st.muted ? rawStatus : t(st.labelKey);

  const agentCell = (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaAgentLabel")}</div>
      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={agentLine}>
        {agentLine}
      </div>
    </div>
  );
  const channelCell = (
    <div className={cn("min-w-0", variant === "default" && "md:col-span-2")}>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaChannelLabel")}</div>
      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={channelLine}>
        {channelLine}
      </div>
    </div>
  );
  const sessionCell = (
    <div className={cn("min-w-0", variant === "sidebar" ? "col-span-2" : "md:col-span-3")}>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaSessionIdLabel")}</div>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        <span className="truncate text-sm text-neutral-900 dark:text-neutral-100" title={threadKey || undefined}>
          {threadKey ? threadShort : "—"}
        </span>
        {threadKey ? (
          <CopyIconButton
            text={threadKey}
            ariaLabel={t("threadDrawerCopyThreadId")}
            successLabel={t("threadDrawerCopyThreadIdSuccess")}
          />
        ) : null}
      </div>
    </div>
  );

  const durationCell = (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectDetailDuration")}</div>
      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100">{metaDuration}</div>
    </div>
  );

  const firstSeenCell = (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaFirstSeenLabel")}</div>
      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={metaStart !== "—" ? metaStart : undefined}>
        {metaStart}
      </div>
    </div>
  );

  const turnsCell = (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaTurnsLabel")}</div>
      <div className="mt-1 tabular-nums text-sm font-normal text-neutral-900 dark:text-neutral-100">
        {metaMsgCount > 0 ? String(metaMsgCount) : "—"}
      </div>
    </div>
  );

  const statusCell = (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspectDetailRunStatus")}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            st.error ? "bg-red-400" : st.timeout ? "bg-amber-400" : st.running ? "bg-sky-400" : st.muted ? "bg-neutral-300 dark:bg-neutral-600" : "bg-emerald-400",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "break-words text-sm font-normal text-neutral-900 dark:text-neutral-100",
            st.error && "text-red-800 dark:text-red-400",
            st.timeout && "text-amber-900 dark:text-amber-300",
            st.running && "text-sky-900 dark:text-sky-300",
          )}
        >
          {statusText}
        </span>
      </div>
    </div>
  );

  return (
    <div className={cn(variant === "sidebar" ? "pt-0" : "pt-1")}>
      <div
        className={cn(
          "grid gap-x-6 gap-y-4",
          variant === "sidebar" ? "grid-cols-2 gap-x-3 gap-y-3" : "grid-cols-1 md:grid-cols-3",
        )}
      >
        {variant === "sidebar" ? (
          <>
            {sessionCell}
            {agentCell}
            {channelCell}
            {durationCell}
            {firstSeenCell}
            {turnsCell}
            {statusCell}
          </>
        ) : (
          <>
            {sessionCell}
            {agentCell}
            {channelCell}
            {durationCell}
            {firstSeenCell}
            {turnsCell}
            <div className="min-w-0 md:col-span-3">{statusCell}</div>
          </>
        )}
      </div>

      <div
        className={cn(
          "border-t border-neutral-200/80 pt-4 dark:border-neutral-700/80",
          variant === "sidebar" ? "mt-4" : "mt-5",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm",
            variant === "sidebar" ? "flex-col items-stretch" : "",
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-neutral-900 dark:text-neutral-50">{t("inspectBillingSectionTitle")}</span>
            <span className="text-neutral-300 dark:text-neutral-600" aria-hidden>
              |
            </span>
            <span className="text-neutral-600 dark:text-neutral-400">{t("inspectTokenUsageSubtitle")}</span>
            <IconInfoCircle className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-amber-200/40 bg-amber-50/50 px-3 py-2.5 dark:border-amber-900/35 dark:bg-amber-950/25">
          <dl className="m-0 space-y-2 text-xs leading-relaxed">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenInput")}</dt>
              <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{formatTokenAmount(inputVal)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenOutput")}</dt>
              <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{formatTokenAmount(outputVal)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenTotal")}</dt>
              <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{formatTokenAmount(totalVal)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-neutral-600 dark:text-neutral-400">{t("threadSidebarTokenCache")}</dt>
              <dd className="tabular-nums font-semibold text-amber-700 dark:text-amber-500">{formatTokenAmount(cacheVal)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
