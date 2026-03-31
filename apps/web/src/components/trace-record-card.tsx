"use client";

import { useTranslations } from "next-intl";
import { IdLabeledCopy } from "@/components/id-labeled-copy";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import {
  formatDurationMs,
  formatOptimizationRate,
  formatTraceRecordSessionLine,
  statusBandLabel,
  statusBandPillClass,
  traceRecordAgentName,
  traceRecordChannel,
  traceRecordDurationMs,
  traceRecordStatusBand,
  traceRecordTaskSummary,
  type TraceRecordRow,
} from "@/lib/trace-records";
import { formatShortId } from "@/lib/utils";

function detailHref(row: TraceRecordRow): string {
  return `/traces/${encodeURIComponent(row.thread_key)}`;
}

export function TraceRecordCard({ row, tokenWarnAt }: { row: TraceRecordRow; tokenWarnAt: number }) {
  const t = useTranslations("Traces");
  const router = useRouter();
  const dur = traceRecordDurationMs(row);
  const agent = traceRecordAgentName(row);
  const channel = traceRecordChannel(row);
  const band = traceRecordStatusBand(row, tokenWarnAt);
  const rawStatus = String(row.status);
  const sessionShown = formatTraceRecordSessionLine(row);

  return (
    <li className="list-none">
      <article className="rounded-2xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[11px] text-neutral-500" title={row.session_id ?? row.thread_key}>
              {row.session_id ? t("cardSession") : t("cardThread")} {formatTraceRecordSessionLine(row)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm font-medium leading-snug text-neutral-900">
              {traceRecordTaskSummary(row, 2000)}
            </p>
            <p className="text-[11px] text-neutral-500">
              {[agent, channel].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="flex shrink-0 sm:pt-0.5">
            <Button type="button" className="w-full sm:w-auto" onClick={() => router.push(detailHref(row))}>
              {t("open")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border/80 pt-4">
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
              statusBandPillClass(band),
            ].join(" ")}
          >
            {statusBandLabel(band, rawStatus, t)}
          </span>
          <span className="inline-flex items-center rounded-full bg-neutral-100/90 px-2.5 py-1 text-[11px] tabular-nums text-neutral-800 ring-1 ring-neutral-200/80">
            <span className="mr-1 text-[10px] font-semibold uppercase text-neutral-500">{t("tokensColumn")}</span>
            {typeof row.total_tokens === "number" ? row.total_tokens.toLocaleString() : "—"}
          </span>
          <span
            className="inline-flex items-center rounded-full bg-emerald-50/95 px-2.5 py-1 text-[11px] tabular-nums text-emerald-900 ring-1 ring-emerald-200/70"
            title={t("columnOptimizationHint")}
          >
            <span className="mr-1 text-[10px] font-semibold uppercase text-emerald-800/90">{t("columnOptimization")}</span>
            {formatOptimizationRate(row.optimization_rate_pct)}
            {row.saved_tokens_total > 0 ? (
              <span className="ml-1 text-[10px] text-emerald-700/90">(−{row.saved_tokens_total.toLocaleString()})</span>
            ) : null}
          </span>
          <span className="inline-flex items-center rounded-full bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-700 ring-1 ring-neutral-200/80">
            <span className="mr-1 text-[10px] font-semibold uppercase text-neutral-500">{t("durationColumn")}</span>
            {formatDurationMs(dur)}
          </span>
          <span className="inline-flex items-center rounded-full bg-violet-50/90 px-2.5 py-1 text-[11px] tabular-nums text-violet-950 ring-1 ring-violet-200/70">
            <span className="mr-1 text-[10px] font-semibold uppercase text-violet-900/80">{t("columnLoopsTools")}</span>
            <span title={t("loopsHint")}>{row.loop_count}</span>
            <span className="mx-0.5 text-violet-300">/</span>
            <span title={t("toolsHint")}>{row.tool_call_count}</span>
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ca-muted">{t("threadKeyColumn")}</span>
            <div className="mt-1">
              <IdLabeledCopy
                kind="thread_key"
                value={row.thread_key}
                displayText={formatShortId(row.thread_key)}
                variant="compact"
              />
            </div>
          </div>
          <p className="shrink-0 text-xs text-ca-muted">
            <span className="text-[10px] font-semibold uppercase text-neutral-400">{t("time")}</span>{" "}
            {formatTraceDateTimeLocal(new Date(row.start_time).toISOString())}
          </p>
        </div>
      </article>
    </li>
  );
}
