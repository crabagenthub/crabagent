"use client";

import { useTranslations } from "next-intl";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";

export type TraceIdKind =
  | "trace_root"
  | "trace_id"
  | "thread_key"
  | "agent_id"
  | "session_id"
  | "session_key"
  | "run_id"
  | "msg_id"
  | "event_id"
  | "row_id";

type TracesIdKindKey =
  | "idKinds.trace_root"
  | "idKinds.trace_id"
  | "idKinds.thread_key"
  | "idKinds.agent_id"
  | "idKinds.session_id"
  | "idKinds.session_key"
  | "idKinds.run_id"
  | "idKinds.msg_id"
  | "idKinds.event_id"
  | "idKinds.row_id";

const TRACE_ID_KIND_TO_MSG: Record<TraceIdKind, TracesIdKindKey> = {
  trace_root: "idKinds.trace_root",
  trace_id: "idKinds.trace_id",
  thread_key: "idKinds.thread_key",
  agent_id: "idKinds.agent_id",
  session_id: "idKinds.session_id",
  session_key: "idKinds.session_key",
  run_id: "idKinds.run_id",
  msg_id: "idKinds.msg_id",
  event_id: "idKinds.event_id",
  row_id: "idKinds.row_id",
};

type Props = {
  kind: TraceIdKind;
  value: string | number | null | undefined;
  /** Shown when `value` is empty (no copy) */
  emptyLabel?: string;
  /** Override visible text; copy still uses string `value` */
  displayText?: string;
  className?: string;
  /** Tighter layout for table cells */
  variant?: "default" | "compact";
  /** Stop parent clicks (e.g. row selection) */
  stopPropagationOnCopy?: boolean;
  /** Class for the monospace id text */
  valueClassName?: string;
};

function toCopyString(value: string | number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "";
}

export function IdLabeledCopy({
  kind,
  value,
  emptyLabel,
  displayText,
  className = "",
  variant = "default",
  stopPropagationOnCopy,
  valueClassName,
}: Props) {
  const t = useTranslations("Traces");

  const text = toCopyString(value);
  const kindLabel = t(TRACE_ID_KIND_TO_MSG[kind]);

  if (!text) {
    return (
      <span className={`text-xs text-neutral-400 ${className}`}>{emptyLabel ?? "—"}</span>
    );
  }

  const shown = displayText ?? text;

  const typeTag = (
    <span
      className="shrink-0 rounded bg-violet-100/90 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900"
      title={kindLabel}
    >
      {kindLabel}
    </span>
  );

  const copyBtn = (
    <TraceCopyIconButton
      text={text}
      ariaLabel={t("copyIdAria", { kind: kindLabel })}
      tooltipLabel={t("copy")}
      successLabel={t("copied")}
      className="text-neutral-400 hover:bg-neutral-200/80 hover:text-neutral-700"
      stopPropagation={Boolean(stopPropagationOnCopy)}
    />
  );

  if (variant === "compact") {
    return (
      <span
        className={`inline-flex max-w-full items-center gap-1.5 ${className}`}
        title={text}
      >
        <span
          className={`min-w-0 truncate text-[11px] text-neutral-800 ${valueClassName ?? ""}`}
        >
          {shown}
        </span>
        {typeTag}
        {copyBtn}
      </span>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span
        className={`min-w-0 break-all text-sm text-neutral-900 ${valueClassName ?? ""}`}
        title={text}
      >
        {shown}
      </span>
      {typeTag}
      {copyBtn}
    </div>
  );
}
