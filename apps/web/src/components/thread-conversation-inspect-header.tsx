"use client";

import { useTranslations } from "next-intl";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import type { ThreadRecordRow } from "@/lib/thread-records";
import { cn } from "@/lib/utils";

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
  /** 右侧窄栏：双列栅格；会话 ID 置顶并占满一行 */
  variant?: "default" | "sidebar";
};

/**
 * 与会话详情右栏：顶栏栅格（会话 ID 置顶，智能体、渠道、状态等）。
 */
export function ThreadConversationInspectHeader({
  row,
  threadKey,
  threadShort,
  variant = "default",
}: Props) {
  const t = useTranslations("Traces");

  const agentLine = row?.agent_name?.trim() || "—";
  const channelLine = row?.channel_name?.trim() || "—";

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
          <TraceCopyIconButton
            text={threadKey}
            ariaLabel={t("threadDrawerCopyThreadId")}
            successLabel={t("threadDrawerCopyThreadIdSuccess")}
            tooltipLabel={t("copy")}
          />
        ) : null}
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
            {agentCell}
            {channelCell}
            {statusCell}
          </>
        ) : (
          <>
            {sessionCell}
            {agentCell}
            {channelCell}
            <div className="min-w-0 md:col-span-3">{statusCell}</div>
          </>
        )}
      </div>
    </div>
  );
}
