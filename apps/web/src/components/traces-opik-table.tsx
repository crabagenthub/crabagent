"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps } from "@arco-design/web-react";
import { Table } from "@arco-design/web-react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { ObserveColumnSortIcons } from "@/components/observe-column-sort-icons";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import { ObserveStatusColumnFilter } from "@/components/observe-status-column-filter";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";
import { OBSERVE_TABLE_CLASSNAME, OBSERVE_TABLE_FRAME_CLASSNAME } from "@/lib/observe-table-style";
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

async function copyText(text: string, onSuccess: () => void): Promise<void> {
  if (!text.trim()) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    onSuccess();
  } catch {
    // ignore
  }
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const t = useTranslations("Traces");

  if (!traceId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="block min-w-0 truncate" title={traceId}>
        {traceId}
      </span>
      <TooltipProvider delay={80}>
        <Tooltip>
          <TooltipTrigger
            delay={80}
            render={(triggerProps) => (
              <Button
                {...triggerProps}
                type="button"
                variant="ghost"
                size="icon-sm"
                data-row-click-stop
                className="shrink-0 p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerProps.onClick?.(e);
                  void copyText(traceId, () => {
                    toast.success(t("copied"));
                  });
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  triggerProps.onKeyDown?.(e);
                }}
                aria-label={t("inspectCopyTraceIdAria")}
              >
                <Copy className="size-3.5" strokeWidth={2} />
              </Button>
            )}
          />
          <TooltipContent>{t("copy")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

const headerCellClass =
  "text-xs font-semibold uppercase tracking-wide text-neutral-600 [&_.arco-table-th-item]:text-neutral-600";

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

  const thSub = useCallback(
    (kind: "count" | "p50" | "avg", value: string) => (
      <span className="mt-0.5 block text-[11px] font-normal normal-case tracking-normal text-neutral-500">
        {kind === "count" && t("tableMetricCount", { n: value })}
        {kind === "p50" && t("tableMetricP50", { v: value })}
        {kind === "avg" && t("tableMetricAvg", { v: value })}
      </span>
    ),
    [t],
  );

  const columns: TableColumnProps<TraceRecordRow>[] = useMemo(
    () => [
      {
        title: <span className={headerCellClass}>{t("colTableMessageId")}</span>,
        dataIndex: "trace_id",
        key: "trace_id",
        width: 200,
        render: (_, row) => <TraceIdCell traceId={row.trace_id} />,
      },
      {
        title: (
          <span className={headerCellClass}>
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
          </span>
        ),
        dataIndex: "channel",
        key: "channel",
        width: 140,
        render: (_, row) => {
          const channelDisp = traceRecordChannel(row);
          return channelDisp ? (
            <span className="line-clamp-2 break-words text-xs text-neutral-800" title={channelDisp}>
              {channelDisp}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          );
        },
      },
      {
        title: (
          <span className={headerCellClass}>
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
          </span>
        ),
        dataIndex: "agent",
        key: "agent",
        width: 160,
        render: (_, row) => {
          const agentDisp = traceRecordAgentName(row);
          return agentDisp ? (
            <span className="line-clamp-2 break-words text-xs text-neutral-800" title={agentDisp}>
              {agentDisp}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          );
        },
      },
      {
        title: (
          <span className={headerCellClass}>
            {onStatusFilterChange ? (
              <ObserveStatusColumnFilter
                label={t("colStatus")}
                value={statusFilter}
                onChange={onStatusFilterChange}
              />
            ) : (
              t("colStatus")
            )}
          </span>
        ),
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (_, row) =>
          row.status ? (
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusBandPillClass(
                traceListStatusBandFromApiStatus(row.status),
              )}`}
            >
              {statusBandLabel(traceListStatusBandFromApiStatus(row.status), row.status, t)}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          ),
      },
      {
        title: (
          <span className={headerCellClass}>
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
          </span>
        ),
        dataIndex: "start_time",
        key: "start_time",
        width: 160,
        render: (_, row) => (
          <span className="font-mono text-xs text-neutral-700">
            {formatTraceDateTimeLocal(new Date(row.start_time).toISOString())}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
            {t("colInput")}
            {thSub("count", String(metrics.inputFilled))}
          </span>
        ),
        dataIndex: "input",
        key: "input",
        width: 220,
        render: (_, row) => {
          const inPrev = rowInputSnippet(row, 200);
          return (
            <p
              className="m-0 line-clamp-2 break-words font-mono text-xs leading-snug text-neutral-800"
              title={inPrev}
            >
              {inPrev || "—"}
            </p>
          );
        },
      },
      {
        title: (
          <span className={headerCellClass}>
            {t("colOutput")}
            {thSub("count", String(metrics.outputFilled))}
          </span>
        ),
        dataIndex: "output",
        key: "output",
        width: 220,
        render: (_, row) => {
          const outPrev = rowOutputSnippet(row, 200);
          return (
            <p
              className="m-0 line-clamp-2 break-words font-mono text-xs leading-snug text-neutral-800"
              title={outPrev}
            >
              {outPrev || "—"}
            </p>
          );
        },
      },
      {
        title: (
          <span className={headerCellClass}>
            {t("colErrors")}
            {thSub("count", String(metrics.errCount))}
          </span>
        ),
        dataIndex: "errors",
        key: "errors",
        width: 88,
        align: "left",
        render: (_, row) => {
          const fail = ["error", "timeout"].includes(String(row.status).toLowerCase());
          return <span className="font-mono text-xs tabular-nums text-neutral-700">{fail ? 1 : 0}</span>;
        },
      },
      {
        title: (
          <span className={headerCellClass}>
            {t("colDuration")}
            {thSub("p50", metrics.p50 != null ? formatDurationMs(metrics.p50) : "—")}
          </span>
        ),
        dataIndex: "duration",
        key: "duration",
        width: 112,
        render: (_, row) => (
          <span className="font-mono text-xs tabular-nums text-neutral-800">
            {formatDurationMs(traceRecordDurationMs(row))}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
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
          </span>
        ),
        dataIndex: "total_tokens",
        key: "total_tokens",
        width: 128,
        render: (_, row) => (
          <span className="font-mono text-xs tabular-nums text-neutral-800">
            {typeof row.total_tokens === "number" ? row.total_tokens.toLocaleString() : "—"}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
            {t("colEstCost")}
            {thSub("avg", metrics.costAvg != null ? metrics.costAvg.toFixed(4) : "—")}
          </span>
        ),
        dataIndex: "total_cost",
        key: "total_cost",
        width: 112,
        render: (_, row) => (
          <span className="font-mono text-xs tabular-nums text-neutral-600">
            {row.total_cost != null && Number.isFinite(row.total_cost) ? row.total_cost.toFixed(4) : "—"}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
            {t("colTags")}
            {thSub(
              "avg",
              metrics.tagAvg != null ? metrics.tagAvg.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—",
            )}
          </span>
        ),
        dataIndex: "tags",
        key: "tags",
        width: 160,
        render: (_, row) => {
          const tags = Array.isArray(row.tags) ? row.tags : [];
          return (
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
          );
        },
      },
    ],
    [
      t,
      metrics,
      sortKey,
      listOrder,
      onColumnSort,
      channelFilter,
      channelOptions,
      onChannelFilterChange,
      agentFilter,
      agentOptions,
      onAgentFilterChange,
      statusFilter,
      onStatusFilterChange,
      thSub,
    ],
  );

  return (
    <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
      <ScrollableTableFrame variant="neutral" contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}>
        <div className="min-w-[1240px]">
          <Table<TraceRecordRow>
            className={OBSERVE_TABLE_CLASSNAME}
            size="small"
            border={false}
            columns={columns}
            data={rows}
            rowKey={(r) => r.trace_id || `${r.thread_key}-${r.start_time}`}
            pagination={false}
            tableLayoutFixed={false}
            hover={Boolean(onRowClick)}
            noDataElement={
              rows.length === 0 ? (emptyBody ?? <div className="flex justify-center px-4 py-10" />) : undefined
            }
            onRow={
              onRowClick
                ? (record) => ({
                    onClick: (e) => {
                      if (shouldIgnoreRowClick(e.target)) {
                        return;
                      }
                      onRowClick(record);
                    },
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(record);
                      }
                    },
                    className: "cursor-pointer",
                  })
                : undefined
            }
          />
        </div>
      </ScrollableTableFrame>
    </div>
  );
}
