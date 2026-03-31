"use client";

import { IconCopy, IconLanguage, IconInfoCircle, IconApps, IconClockCircle, IconCommon } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { spanTokenTotals } from "@/lib/span-token-display";
import { formatDurationMs } from "@/lib/trace-records";
import { cn, formatShortId } from "@/lib/utils";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

function modelEndpointLabel(span: SemanticSpanRow | null): string {
  if (!span) {
    return "—";
  }
  const meta = span.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = (meta as Record<string, unknown>).model;
    if (typeof m === "string" && m.trim()) {
      return m.trim();
    }
  }
  if (span.module) {
    return span.module;
  }
  return span.type || "—";
}

function inferenceDisplayName(span: SemanticSpanRow | null): string {
  if (!span) {
    return "—";
  }
  return span.model_name?.trim() || span.name?.trim() || "—";
}

type Props = {
  selectedSpan: SemanticSpanRow | null;
  traceId: string;
  /** When tree has not resolved a node yet, show list row span id. */
  fallbackSpanId?: string;
  chipTags?: string[];
  rowTokens?: number | null;
  rowDurationMs?: number | null;
  variant?: "modal" | "panel";
};

function CopyIconButton({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={() => void copyText(text)}
      className="inline-flex shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200/80 hover:text-neutral-700"
      aria-label={ariaLabel}
    >
      <IconCopy className="size-3.5" />
    </button>
  );
}

export function TraceInspectBasicHeader({
  selectedSpan,
  traceId,
  fallbackSpanId = "",
  chipTags = [],
  rowTokens = null,
  rowDurationMs = null,
  variant = "modal",
}: Props) {
  const t = useTranslations("Traces");

  const spanId = selectedSpan?.span_id?.trim() || fallbackSpanId.trim();
  const serviceIdDisplay = spanId || "—";
  const inferenceName = inferenceDisplayName(selectedSpan);
  const endpointId = modelEndpointLabel(selectedSpan);

  const spanDurMs =
    selectedSpan && selectedSpan.end_time != null && Number.isFinite(selectedSpan.start_time)
      ? Math.max(0, selectedSpan.end_time - selectedSpan.start_time)
      : null;
  const durationLabel = formatDurationMs(spanDurMs ?? rowDurationMs ?? undefined);

  const tok = selectedSpan ? spanTokenTotals(selectedSpan) : null;
  let inDisplay = "—";
  let outDisplay = "—";
  if (tok?.hasAny) {
    inDisplay = tok.prompt.toLocaleString();
    outDisplay = tok.completion.toLocaleString();
  } else if (rowTokens != null && rowTokens > 0) {
    inDisplay = rowTokens.toLocaleString();
  }

  const traceShort = formatShortId(traceId) || "—";

  const statusError = selectedSpan != null && selectedSpan.error != null;
  const statusLabel =
    selectedSpan == null
      ? "—"
      : statusError
        ? t("detailStatusError")
        : t("detailStatusSuccess");

  const typeModuleLine = selectedSpan
    ? [selectedSpan.type, selectedSpan.module].filter(Boolean).join(" · ") || "—"
    : "—";

  const pad = variant === "panel" ? "px-4 py-3" : "px-4 py-3";

  return (
    <div className={cn("shrink-0 border-b border-border bg-background", pad)}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-4">
        <div className="min-w-0">
          <div className="text-xs text-neutral-500">{t("inspectInferenceServiceLabel")}</div>
          <div className="mt-1 truncate text-sm font-normal text-neutral-900" title={inferenceName}>
            {inferenceName}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs text-neutral-500">{t("inspectDetailServiceId")}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <span className="truncate text-sm text-neutral-900" title={serviceIdDisplay}>
              {serviceIdDisplay}
            </span>
            {spanId ? (
              <CopyIconButton text={spanId} ariaLabel={t("inspectCopyServiceIdAria")} />
            ) : null}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs text-neutral-500">{t("inspectModelEndpointLabel")}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <span className="truncate text-sm text-neutral-900" title={endpointId}>
              {endpointId}
            </span>
            {endpointId !== "—" ? (
              <CopyIconButton text={endpointId} ariaLabel={t("inspectCopyEndpointAria")} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-neutral-200/80 pt-4 text-sm">
        <span className="font-semibold text-neutral-900">{t("inspectBillingSectionTitle")}</span>
        <span className="text-neutral-300" aria-hidden>
          |
        </span>
        <span className="text-neutral-600">{t("inspectTokenUsageSubtitle")}</span>
        <IconInfoCircle className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
        <span className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
          <span className="text-neutral-900">
            <span className="font-bold text-amber-600">{t("inspectTokenInShort")}</span>{" "}
            <span>{inDisplay}</span>
          </span>
          <span className="text-neutral-900">
            <span className="font-bold text-amber-600">{t("inspectTokenOutShort")}</span>{" "}
            <span>{outDisplay}</span>
          </span>
          {tok != null && tok.cacheRead > 0 ? (
            <span className="text-neutral-600 text-xs">
              cache {tok.cacheRead.toLocaleString()}
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-3 rounded-lg bg-[#f4f5f9] px-3 py-2.5 text-xs leading-relaxed text-neutral-600 dark:bg-neutral-900/55 dark:text-neutral-400">
        <ul className="m-0 list-none space-y-2 p-0">
          <li className="flex gap-2">
            <IconClockCircle className="mt-0.5 size-3.5 shrink-0 text-neutral-400" aria-hidden />
            <span>
              <span className="text-neutral-700">{t("inspectDetailDuration")}</span>
              <span className="text-neutral-900"> {durationLabel}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <IconCommon className="mt-0.5 size-3.5 shrink-0 text-neutral-400" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <span className="text-neutral-700">{t("inspectDetailTrace")}</span>
              <span className="text-neutral-900" title={traceId || undefined}>
                {traceShort}
              </span>
              {traceId ? (
                <CopyIconButton text={traceId} ariaLabel={t("inspectCopyTraceIdAria")} />
              ) : null}
            </span>
          </li>
          <li className="flex gap-2">
            <IconApps className="mt-0.5 size-3.5 shrink-0 text-neutral-400" aria-hidden />
            <span>
              <span className="text-neutral-700">{t("inspectDetailSpanKind")}</span>
              <span className="text-neutral-900"> {typeModuleLine}</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span
              className={cn(
                "mt-0.5 size-3.5 shrink-0 rounded-full",
                selectedSpan == null
                  ? "bg-neutral-300"
                  : statusError
                    ? "bg-red-400"
                    : "bg-emerald-400",
              )}
              aria-hidden
            />
            <span>
              <span className="text-neutral-700">{t("inspectDetailRunStatus")}</span>
              <span
                className={
                  selectedSpan == null
                    ? "text-neutral-900"
                    : statusError
                      ? "text-red-800"
                      : "text-emerald-900"
                }
              >
                {" "}
                {statusLabel}
              </span>
            </span>
          </li>
        </ul>
      </div>

      {chipTags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chipTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-[10rem] truncate rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-900"
              title={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
