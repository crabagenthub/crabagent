"use client";

import { useTranslations } from "next-intl";
import { ObserveColumnSortIcons } from "@/components/observe-column-sort-icons";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { formatSpanDuration, type SpanRecordRow } from "@/lib/span-records";
import { cn } from "@/lib/utils";

function clip(s: string | null | undefined, max: number): string {
  const raw = (s ?? "").trim().replace(/\s+/g, " ");
  if (!raw) {
    return "—";
  }
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

function SpanStatusCell({ status }: { status: ObserveListStatusParam }) {
  const t = useTranslations("Traces");
  const label =
    status === "running"
      ? t("spansStatusRunning")
      : status === "success"
        ? t("spansStatusSuccess")
        : status === "timeout"
          ? t("spansStatusTimeout")
          : t("spansStatusError");
  const cls =
    status === "running"
      ? "bg-amber-50 text-amber-900 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-800"
      : status === "success"
        ? "bg-emerald-50 text-emerald-900 ring-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-100 dark:ring-emerald-800"
        : status === "timeout"
          ? "bg-neutral-100 text-neutral-800 ring-neutral-200/90 dark:bg-neutral-800/60 dark:text-neutral-100 dark:ring-neutral-600"
          : "bg-red-50 text-red-900 ring-red-200/80 dark:bg-red-950/40 dark:text-red-100 dark:ring-red-800";
  return (
    <span
      className={cn(
        "inline-flex max-w-full truncate rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        cls,
      )}
      title={label}
    >
      {label}
    </span>
  );
}

export function SpansDataTable({
  rows,
  sortKey,
  listOrder,
  onColumnSort,
  onRowClick,
}: {
  rows: SpanRecordRow[];
  sortKey: ObserveListSortParam;
  listOrder: "asc" | "desc";
  onColumnSort: (sort: ObserveListSortParam, order: "asc" | "desc") => void;
  onRowClick?: (row: SpanRecordRow) => void;
}) {
  const t = useTranslations("Traces");

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-neutral-200/90 bg-white shadow-sm">
      <ScrollableTableFrame variant="neutral" contentKey={rows.length}>
        <table className="w-max min-w-[1600px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/90 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <th className="min-w-[10rem] max-w-[14rem] px-3 py-3 normal-case">{t("spansColSpanId")}</th>
              <th className="min-w-[6rem] max-w-[10rem] px-3 py-3 normal-case">{t("spansColAgent")}</th>
              <th className="min-w-[6rem] max-w-[10rem] px-3 py-3 normal-case">{t("spansColChannel")}</th>
              <th className="min-w-[7rem] max-w-[12rem] px-3 py-3 normal-case">{t("spansColName")}</th>
              <th className="w-24 px-3 py-3">{t("spansColType")}</th>
              <th className="min-w-[5.5rem] px-3 py-3 normal-case">{t("spansColStatus")}</th>
              <th className="min-w-[10rem] max-w-[14rem] px-3 py-3 normal-case">{t("spansColInput")}</th>
              <th className="min-w-[10rem] max-w-[14rem] px-3 py-3 normal-case">{t("spansColOutput")}</th>
              <th className="min-w-[11rem] px-3 py-3 normal-case">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
                  <div className="flex items-center gap-1.5">
                    <span>{t("spansColExecStart")}</span>
                    <ObserveColumnSortIcons
                      dimension="time"
                      sortKey={sortKey}
                      listOrder={listOrder}
                      onSort={onColumnSort}
                      ascLabel={t("columnSortTimeAsc")}
                      descLabel={t("columnSortTimeDesc")}
                    />
                  </div>
                  <span className="hidden h-3 w-px bg-neutral-300 sm:inline sm:self-center" aria-hidden />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tracking-wide text-neutral-500">{t("sortByTokens")}</span>
                    <ObserveColumnSortIcons
                      dimension="tokens"
                      sortKey={sortKey}
                      listOrder={listOrder}
                      onSort={onColumnSort}
                      ascLabel={t("columnSortTokensAsc")}
                      descLabel={t("columnSortTokensDesc")}
                    />
                  </div>
                </div>
              </th>
              <th className="min-w-[11rem] px-3 py-3 normal-case">{t("spansColExecEnd")}</th>
              <th className="w-24 px-3 py-3">{t("spansColDuration")}</th>
              <th className="w-28 px-3 py-3 text-right normal-case">{t("spansColTokens")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.trace_id}:${r.span_id}`}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(r)}
                onKeyDown={(e) => {
                  if (!onRowClick) {
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(r);
                  }
                }}
                className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <td className="max-w-[14rem] min-w-0 px-3 py-2.5 font-mono text-xs text-neutral-800">
                  {r.span_id.trim() ? (
                    <span className="block truncate" title={r.span_id}>
                      {r.span_id}
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="max-w-[10rem] truncate px-3 py-2.5 text-xs text-neutral-800" title={r.agent_name ?? ""}>
                  {r.agent_name ?? "—"}
                </td>
                <td className="max-w-[10rem] truncate px-3 py-2.5 text-xs text-neutral-800" title={r.channel_name ?? ""}>
                  {r.channel_name ?? "—"}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2.5 font-medium text-neutral-900" title={r.name}>
                  {r.name || "—"}
                </td>
                <td className="px-3 py-2.5 text-xs text-neutral-600">{r.span_type}</td>
                <td className="px-3 py-2.5">
                  <SpanStatusCell status={r.list_status} />
                </td>
                <td className="max-w-[14rem] px-3 py-2.5 text-xs text-neutral-600" title={r.input_preview ?? ""}>
                  {clip(r.input_preview, 120)}
                </td>
                <td className="max-w-[14rem] px-3 py-2.5 text-xs text-neutral-600" title={r.output_preview ?? ""}>
                  {clip(r.output_preview, 120)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-neutral-600">
                  {r.start_time_ms != null
                    ? formatTraceDateTimeLocal(new Date(r.start_time_ms).toISOString())
                    : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-neutral-600">
                  {r.end_time_ms != null
                    ? formatTraceDateTimeLocal(new Date(r.end_time_ms).toISOString())
                    : "—"}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-neutral-700">
                  {formatSpanDuration(r.duration_ms)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-neutral-700">
                  {String(r.total_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTableFrame>
    </div>
  );
}
