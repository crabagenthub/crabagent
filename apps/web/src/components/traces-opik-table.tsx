"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { ObserveColumnSortIcons } from "@/components/observe-column-sort-icons";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import { ObserveStatusColumnFilter } from "@/components/observe-status-column-filter";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import {
  formatDurationMs,
  statusBandLabel,
  statusBandPillClass,
  traceListStatusBandFromApiStatus,
  traceRecordAgentName,
  traceRecordChannel,
  traceRecordDurationMs,
  type TraceRecordRow,
} from "@/lib/trace-records";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";

function clipOneLine(s: string | null | undefined, max: number): string {
  const raw = (s ?? "").trim().replace(/\s+/g, " ");
  if (!raw) {
    return "";
  }
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

function rowInputSnippet(row: TraceRecordRow, max: number): string {
  const raw = row.last_message_preview;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return "";
  }
  return clipOneLine(extractInboundDisplayPreview(raw), max);
}

function rowOutputSnippet(row: TraceRecordRow, max: number): string {
  return clipOneLine(row.output_preview, max);
}

function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (a.length === 0) {
    return null;
  }
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function TracesOpikTable({
  rows,
  sortKey,
  listOrder,
  onColumnSort,
  onRowClick,
  channelFilter = "",
  channelOptions = [],
  onChannelFilterChange,
  agentFilter = "",
  agentOptions = [],
  onAgentFilterChange,
  statusFilter = "",
  onStatusFilterChange,
  emptyBody,
}: {
  rows: TraceRecordRow[];
  sortKey: ObserveListSortParam;
  listOrder: "asc" | "desc";
  onColumnSort: (sort: ObserveListSortParam, order: "asc" | "desc") => void;
  onRowClick?: (row: TraceRecordRow) => void;
  channelFilter?: string;
  channelOptions?: string[];
  onChannelFilterChange?: (next: string) => void;
  agentFilter?: string;
  agentOptions?: string[];
  onAgentFilterChange?: (next: string) => void;
  statusFilter?: ObserveListStatusParam | "";
  onStatusFilterChange?: (next: ObserveListStatusParam | "") => void;
  /** 无数据时表体区域内展示（表头仍渲染） */
  emptyBody?: ReactNode;
}) {
  const t = useTranslations("Traces");

  const metrics = useMemo(() => {
    const inputFilled = rows.filter((r) => rowInputSnippet(r, 4000).length > 0).length;
    const outputFilled = rows.filter((r) => rowOutputSnippet(r, 4000).length > 0).length;
    const errCount = rows.filter((r) => String(r.status).toLowerCase() === "error").length;
    const durs = rows.map((r) => traceRecordDurationMs(r)).filter((x): x is number => x != null);
    const p50 = median(durs);
    const tokenVals = rows.map((r) => (typeof r.total_tokens === "number" ? r.total_tokens : 0));
    const tokAvg =
      tokenVals.length > 0 ? tokenVals.reduce((a, b) => a + b, 0) / tokenVals.length : null;
    const costs = rows
      .map((r) => r.total_cost)
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
    const costAvg = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    const tagCounts = rows.map((r) => (Array.isArray(r.tags) ? r.tags.length : 0));
    const tagAvg = tagCounts.length > 0 ? tagCounts.reduce((a, b) => a + b, 0) / tagCounts.length : null;
    return {
      inputFilled,
      outputFilled,
      errCount,
      p50,
      tokAvg,
      costAvg,
      tagAvg,
    };
  }, [rows]);

  const thSub = (kind: "count" | "p50" | "avg", value: string) => (
    <span className="mt-0.5 block text-[11px] font-normal normal-case tracking-normal text-neutral-500">
      {kind === "count" && t("tableMetricCount", { n: value })}
      {kind === "p50" && t("tableMetricP50", { v: value })}
      {kind === "avg" && t("tableMetricAvg", { v: value })}
    </span>
  );

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-neutral-200/90 bg-white">
      <ScrollableTableFrame variant="neutral" contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}>
        <table className="w-max min-w-[1240px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/95 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <th className="min-w-[10rem] max-w-[14rem] px-3 py-3 normal-case">{t("colTableMessageId")}</th>
              <th className="min-w-[6.5rem] max-w-[10rem] px-3 py-3 normal-case">
                {onChannelFilterChange ? (
                  <ObserveFacetColumnFilter
                    label={t("filterChannelLabel")}
                    value={channelFilter}
                    options={channelOptions}
                    onChange={onChannelFilterChange}
                    ariaLabelKey="channelColumnFilterAria"
                  />
                ) : (
                  t("filterChannelLabel")
                )}
              </th>
              <th className="min-w-[6.5rem] max-w-[11rem] px-3 py-3 normal-case">
                {onAgentFilterChange ? (
                  <ObserveFacetColumnFilter
                    label={t("filterAgentLabel")}
                    value={agentFilter}
                    options={agentOptions}
                    onChange={onAgentFilterChange}
                    ariaLabelKey="agentColumnFilterAria"
                  />
                ) : (
                  t("filterAgentLabel")
                )}
              </th>
              <th className="min-w-[5.5rem] whitespace-nowrap px-3 py-3">
                {onStatusFilterChange ? (
                  <ObserveStatusColumnFilter
                    label={t("colStatus")}
                    value={statusFilter}
                    onChange={onStatusFilterChange}
                  />
                ) : (
                  t("colStatus")
                )}
              </th>
              <th className="min-w-[9rem] px-3 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{t("colStartTime")}</span>
                  <ObserveColumnSortIcons
                    dimension="time"
                    sortKey={sortKey}
                    listOrder={listOrder}
                    onSort={onColumnSort}
                    ascLabel={t("columnSortTimeAsc")}
                    descLabel={t("columnSortTimeDesc")}
                  />
                </div>
              </th>
              <th className="min-w-[12rem] max-w-[18rem] px-3 py-3">
                {t("colInput")}
                {thSub("count", String(metrics.inputFilled))}
              </th>
              <th className="min-w-[12rem] max-w-[18rem] px-3 py-3">
                {t("colOutput")}
                {thSub("count", String(metrics.outputFilled))}
              </th>
              <th className="w-24 px-3 py-3">
                {t("colErrors")}
                {thSub("count", String(metrics.errCount))}
              </th>
              <th className="w-28 px-3 py-3">
                {t("colDuration")}
                {thSub(
                  "p50",
                  metrics.p50 != null ? formatDurationMs(metrics.p50) : "—",
                )}
              </th>
              <th className="w-32 px-3 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>
                    {t("colTotalTokens")}
                    {thSub(
                      "avg",
                      metrics.tokAvg != null
                        ? metrics.tokAvg.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : "—",
                    )}
                  </span>
                  <ObserveColumnSortIcons
                    dimension="tokens"
                    sortKey={sortKey}
                    listOrder={listOrder}
                    onSort={onColumnSort}
                    ascLabel={t("columnSortTokensAsc")}
                    descLabel={t("columnSortTokensDesc")}
                  />
                </div>
              </th>
              <th className="w-28 px-3 py-3">
                {t("colEstCost")}
                {thSub(
                  "avg",
                  metrics.costAvg != null ? metrics.costAvg.toFixed(4) : "—",
                )}
              </th>
              <th className="min-w-[7rem] px-3 py-3">
                {t("colTags")}
                {thSub(
                  "avg",
                  metrics.tagAvg != null ? metrics.tagAvg.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—",
                )}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 && emptyBody ? (
              <tr>
                <td colSpan={12} className="border-0 bg-white p-0 align-top">
                  <div className="flex justify-center px-4 py-10">{emptyBody}</div>
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const dur = traceRecordDurationMs(row);
              const fail = ["error", "timeout"].includes(String(row.status).toLowerCase());
              const err = fail ? 1 : 0;
              const inPrev = rowInputSnippet(row, 200);
              const outPrev = rowOutputSnippet(row, 200);
              const tags = Array.isArray(row.tags) ? row.tags : [];
              const channelDisp = traceRecordChannel(row);
              const agentDisp = traceRecordAgentName(row);
              return (
                <tr
                  key={row.trace_id}
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={onRowClick ? "cursor-pointer transition-colors hover:bg-neutral-50/80" : "transition-colors hover:bg-neutral-50/80"}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  <td className="max-w-[14rem] min-w-0 px-3 py-2.5 align-top font-mono text-xs text-neutral-800">
                    {row.trace_id.trim() ? (
                      <span className="block truncate" title={row.trace_id}>
                        {row.trace_id}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="max-w-[10rem] min-w-0 px-3 py-2.5 align-top text-xs text-neutral-800">
                    {channelDisp ? (
                      <span className="line-clamp-2 break-words" title={channelDisp}>
                        {channelDisp}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="max-w-[11rem] min-w-0 px-3 py-2.5 align-top text-xs text-neutral-800">
                    {agentDisp ? (
                      <span className="line-clamp-2 break-words" title={agentDisp}>
                        {agentDisp}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top">
                    {row.status ? (
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusBandPillClass(
                          traceListStatusBandFromApiStatus(row.status),
                        )}`}
                      >
                        {statusBandLabel(
                          traceListStatusBandFromApiStatus(row.status),
                          row.status,
                          t,
                        )}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top font-mono text-xs text-neutral-700">
                    {formatTraceDateTimeLocal(new Date(row.start_time).toISOString())}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5 align-top">
                    <p className="line-clamp-2 break-words font-mono text-xs leading-snug text-neutral-800" title={inPrev}>
                      {inPrev || "—"}
                    </p>
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5 align-top">
                    <p className="line-clamp-2 break-words font-mono text-xs leading-snug text-neutral-800" title={outPrev}>
                      {outPrev || "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-700">
                    {err}
                  </td>
                  <td className="px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-800">
                    {formatDurationMs(dur)}
                  </td>
                  <td className="px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-800">
                    {typeof row.total_tokens === "number" ? row.total_tokens.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-600">
                    {row.total_cost != null && Number.isFinite(row.total_cost)
                      ? row.total_cost.toFixed(4)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap gap-1">
                      {tags.length === 0 ? (
                        <span className="text-xs text-neutral-400">—</span>
                      ) : (
                        tags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex max-w-[7rem] truncate rounded-md bg-rose-500/12 px-1.5 py-0.5 text-[11px] font-medium text-rose-900"
                            title={tag}
                          >
                            {tag.length > 16 ? `${tag.slice(0, 14)}…` : tag}
                          </span>
                        ))
                      )}
                      {tags.length > 4 ? (
                        <span className="text-[11px] text-neutral-500">+{tags.length - 4}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTableFrame>
    </div>
  );
}
