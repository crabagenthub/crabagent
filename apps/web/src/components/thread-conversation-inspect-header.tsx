"use client";

import { Clock, Copy, Hash, Info, MessageSquare, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ThreadRecordRow } from "@/lib/thread-records";
import { cn } from "@/lib/utils";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

function CopyIconButton({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={() => void copyText(text)}
      className="inline-flex shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200/80 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
      aria-label={ariaLabel}
    >
      <Copy className="size-3.5" strokeWidth={2} />
    </button>
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

type Props = {
  row: ThreadRecordRow | null;
  threadKey: string;
  threadShort: string;
  metaStart: string;
  metaDuration: string;
  metaMsgCount: number;
  totalTokensNum: number;
  /** 右侧窄栏：智能体/渠道优先一行两列，会话 ID 占满下行 */
  variant?: "default" | "sidebar";
};

/**
 * 与会话详情右栏 `TraceInspectBasicHeader` 一致的三段式：顶栏栅格 + 计费/用量条 + 浅底详情列表。
 */
export function ThreadConversationInspectHeader({
  row,
  threadKey,
  threadShort,
  metaStart,
  metaDuration,
  metaMsgCount,
  totalTokensNum,
  variant = "default",
}: Props) {
  const t = useTranslations("Traces");

  const agentLine = row?.agent_name?.trim() || "—";
  const channelLine = row?.channel_name?.trim() || "—";

  const inDisplay = totalTokensNum > 0 ? totalTokensNum.toLocaleString() : "—";
  const outDisplay = "—";

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
    <div className="min-w-0">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaChannelLabel")}</div>
      <div className="mt-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100" title={channelLine}>
        {channelLine}
      </div>
    </div>
  );
  const sessionCell = (
    <div className={cn("min-w-0", variant === "sidebar" && "col-span-2")}>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("drawerMetaSessionIdLabel")}</div>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-sm text-neutral-900 dark:text-neutral-100" title={threadKey || undefined}>
          {threadKey ? threadShort : "—"}
        </span>
        {threadKey ? <CopyIconButton text={threadKey} ariaLabel={t("threadDrawerCopyThreadId")} /> : null}
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
            {agentCell}
            {channelCell}
            {sessionCell}
          </>
        ) : (
          <>
            {agentCell}
            {sessionCell}
            {channelCell}
          </>
        )}
      </div>

      <div
        className={cn(
          "flex gap-x-2 gap-y-2 border-t border-neutral-200/80 pt-4 text-sm dark:border-neutral-700/80",
          variant === "sidebar" ? "mt-4 flex-col" : "mt-5 flex-wrap items-center",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-neutral-900 dark:text-neutral-50">{t("inspectBillingSectionTitle")}</span>
          <span className="text-neutral-300 dark:text-neutral-600" aria-hidden>
            |
          </span>
          <span className="text-neutral-600 dark:text-neutral-400">{t("inspectTokenUsageSubtitle")}</span>
          <Info className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
        </div>
        <span
          className={cn(
            "flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums",
            variant === "sidebar" ? "" : "ml-auto",
          )}
        >
          <span className="text-neutral-900 dark:text-neutral-100">
            <span className="font-bold text-amber-600 dark:text-amber-500">{t("inspectTokenInShort")}</span>{" "}
            <span>{inDisplay}</span>
          </span>
          <span className="text-neutral-900 dark:text-neutral-100">
            <span className="font-bold text-amber-600 dark:text-amber-500">{t("inspectTokenOutShort")}</span>{" "}
            <span>{outDisplay}</span>
          </span>
        </span>
      </div>

      <div className="mt-3 rounded-lg bg-[#f4f5f9] px-3 py-2.5 text-xs leading-relaxed text-neutral-600 dark:bg-neutral-900/55 dark:text-neutral-400">
        <ul className="m-0 list-none space-y-2 p-0">
          <li className="flex gap-2">
            <Timer className="mt-0.5 size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
            <span>
              <span className="text-neutral-700 dark:text-neutral-300">{t("inspectDetailDuration")}</span>
              <span className="text-neutral-900 dark:text-neutral-100"> {metaDuration}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
            <span>
              <span className="text-neutral-700 dark:text-neutral-300">{t("drawerMetaFirstSeenLabel")}</span>
              <span className="text-neutral-900 dark:text-neutral-100"> {metaStart}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <Hash className="mt-0.5 size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <span className="text-neutral-700 dark:text-neutral-300">{t("drawerMetaSessionIdLabel")}</span>
              <span className="font-mono text-neutral-900 dark:text-neutral-100" title={threadKey || undefined}>
                {threadKey ? threadShort : "—"}
              </span>
              {threadKey ? (
                <CopyIconButton text={threadKey} ariaLabel={t("threadDrawerCopyThreadId")} />
              ) : null}
            </span>
          </li>
          <li className="flex gap-2">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
            <span>
              <span className="text-neutral-700 dark:text-neutral-300">{t("drawerMetaTurnsLabel")}</span>
              <span className="text-neutral-900 dark:text-neutral-100 tabular-nums">
                {" "}
                {metaMsgCount > 0 ? String(metaMsgCount) : "—"}
              </span>
            </span>
          </li>
          <li className="flex gap-2">
            <span
              className={cn(
                "mt-0.5 size-3.5 shrink-0 rounded-full",
                st.error ? "bg-red-400" : st.timeout ? "bg-amber-400" : st.running ? "bg-sky-400" : st.muted ? "bg-neutral-300" : "bg-emerald-400",
              )}
              aria-hidden
            />
            <span>
              <span className="text-neutral-700 dark:text-neutral-300">{t("inspectDetailRunStatus")}</span>
              <span
                className={cn(
                  "text-neutral-900 dark:text-neutral-100",
                  st.error && "text-red-800 dark:text-red-400",
                  st.timeout && "text-amber-900 dark:text-amber-300",
                  st.running && "text-sky-900 dark:text-sky-300",
                )}
              >
                {" "}
                {statusText}
              </span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
