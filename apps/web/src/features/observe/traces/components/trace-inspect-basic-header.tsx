"use client";

import { IconInfoCircle, IconApps, IconClockCircle, IconCommon } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { TraceCopyIconButton } from "@/shared/components/trace-copy-icon-button";
import type { SemanticSpanRow } from "@/lib/semantic-spans";
import { spanTokenTotals } from "@/lib/span-token-display";
import { formatDurationMs } from "@/lib/trace-records";
import { cn, formatShortId } from "@/lib/utils";

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
  /** Narrow right column: single-column stack, no multi-column grid. */
  layout?: "default" | "sidebar";
};

export function TraceInspectBasicHeader({
  selectedSpan,
  traceId,
  fallbackSpanId = "",
  chipTags = [],
  rowTokens = null,
  rowDurationMs = null,
  variant = "modal",
  layout = "default",
}: Props) {
  const t = useTranslations("Traces");
  const isSidebar = layout === "sidebar";

  const labelSidebar = (s: string) => s.replace(/:\s*$/, "");

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

  if (isSidebar) {
    return (
      <div className="shrink-0 pb-1">
        <dl className="m-0 space-y-2.5">
          <div>
            <dt className="text-[11px] font-medium text-neutral-500">{labelSidebar(t("inspectInferenceServiceLabel"))}</dt>
            <dd className="mt-0.5 truncate text-xs text-neutral-900 dark:text-neutral-100" title={inferenceName}>
              {inferenceName}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-neutral-500">{labelSidebar(t("inspectDetailServiceId"))}</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-xs text-neutral-900 dark:text-neutral-100" title={serviceIdDisplay}>
                {formatShortId(serviceIdDisplay) || serviceIdDisplay}
              </span>
              {spanId ? (
                <TraceCopyIconButton
                  text={spanId}
                  ariaLabel={t("inspectCopyServiceIdAria")}
                  tooltipLabel={t("copy")}
                  successLabel={t("copySuccessToast")}
                />
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-neutral-500">{labelSidebar(t("inspectModelEndpointLabel"))}</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1">
              <span className="truncate text-xs text-neutral-900 dark:text-neutral-100" title={endpointId}>
                {endpointId}
              </span>
              {endpointId !== "—" ? (
                <TraceCopyIconButton
                  text={endpointId}
                  ariaLabel={t("inspectCopyEndpointAria")}
                  tooltipLabel={t("copy")}
                  successLabel={t("copySuccessToast")}
                />
              ) : null}
            </dd>
          </div>
        </dl>

        <div className="mt-3 rounded-lg border border-neutral-200/70 bg-white/80 px-2.5 py-2 dark:border-neutral-700/80 dark:bg-neutral-900/40">
          <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            {t("inspectBillingSectionTitle")}
            <span className="mx-1 text-neutral-300 dark:text-neutral-600" aria-hidden>
              ·
            </span>
            {t("inspectTokenUsageSubtitle")}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-neutral-900 dark:text-neutral-100">
            <span>
              <span className="font-semibold text-amber-700 dark:text-amber-500">{t("inspectTokenInShort")}</span> {inDisplay}
            </span>
            <span>
              <span className="font-semibold text-amber-700 dark:text-amber-500">{t("inspectTokenOutShort")}</span> {outDisplay}
            </span>
            {tok != null && tok.cacheRead > 0 ? (
              <span className="text-[11px] text-neutral-500">cache {tok.cacheRead.toLocaleString()}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-neutral-100/80 px-2.5 py-2 text-xs leading-snug text-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300">
          <ul className="m-0 list-none space-y-1.5 p-0">
            <li className="flex gap-1.5">
              <IconClockCircle className="mt-0.5 size-3 shrink-0 text-neutral-400" aria-hidden />
              <span>
                <span className="text-neutral-500 dark:text-neutral-400">{labelSidebar(t("inspectDetailDuration"))}</span>{" "}
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{durationLabel}</span>
              </span>
            </li>
            <li className="flex gap-1.5">
              <IconCommon className="mt-0.5 size-3 shrink-0 text-neutral-400" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <span className="text-neutral-500 dark:text-neutral-400">{labelSidebar(t("inspectDetailTrace"))}</span>
                <span className="font-mono text-[11px] text-neutral-900 dark:text-neutral-100" title={traceId || undefined}>
                  {traceShort}
                </span>
                {traceId ? (
                  <TraceCopyIconButton
                    text={traceId}
                    ariaLabel={t("inspectCopyTraceIdAria")}
                    tooltipLabel={t("copy")}
                    successLabel={t("copySuccessToast")}
                  />
                ) : null}
              </span>
            </li>
            <li className="flex gap-1.5">
              <IconApps className="mt-0.5 size-3 shrink-0 text-neutral-400" aria-hidden />
              <span>
                <span className="text-neutral-500 dark:text-neutral-400">{labelSidebar(t("inspectDetailSpanKind"))}</span>{" "}
                <span className="text-neutral-900 dark:text-neutral-100">{typeModuleLine}</span>
              </span>
            </li>
            <li className="flex gap-1.5">
              <span
                className={cn(
                  "mt-0.5 size-3 shrink-0 rounded-full",
                  selectedSpan == null ? "bg-neutral-300 dark:bg-neutral-600" : statusError ? "bg-red-400" : "bg-emerald-400",
                )}
                aria-hidden
              />
              <span>
                <span className="text-neutral-500 dark:text-neutral-400">{labelSidebar(t("inspectDetailRunStatus"))}</span>{" "}
                <span
                  className={
                    selectedSpan == null
                      ? "text-neutral-900 dark:text-neutral-100"
                      : statusError
                        ? "text-red-700 dark:text-red-400"
                        : "text-emerald-800 dark:text-emerald-400"
                  }
                >
                  {statusLabel}
                </span>
              </span>
            </li>
          </ul>
        </div>

        {chipTags.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {chipTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-full truncate rounded-md bg-rose-500/12 px-1.5 py-0.5 text-[10px] font-medium text-rose-900 dark:text-rose-200"
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
              <TraceCopyIconButton
                text={spanId}
                ariaLabel={t("inspectCopyServiceIdAria")}
                tooltipLabel={t("copy")}
                successLabel={t("copySuccessToast")}
              />
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
              <TraceCopyIconButton
                text={endpointId}
                ariaLabel={t("inspectCopyEndpointAria")}
                tooltipLabel={t("copy")}
                successLabel={t("copySuccessToast")}
              />
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
                <TraceCopyIconButton
                  text={traceId}
                  ariaLabel={t("inspectCopyTraceIdAria")}
                  tooltipLabel={t("copy")}
                  successLabel={t("copySuccessToast")}
                />
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
