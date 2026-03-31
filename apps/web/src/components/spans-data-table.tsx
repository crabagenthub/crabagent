"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps } from "@arco-design/web-react";
import { Table } from "@arco-design/web-react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";
import { useMemo } from "react";
import { ObserveColumnSortIcons } from "@/components/observe-column-sort-icons";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import { ObserveStatusColumnFilter } from "@/components/observe-status-column-filter";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_CLASSNAME, OBSERVE_TABLE_FRAME_CLASSNAME } from "@/lib/observe-table-style";
import { formatSpanDuration, type SpanRecordRow } from "@/lib/span-records";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { cn } from "@/lib/utils";

function clip(s: string | null | undefined, max: number): string {
  const raw = (s ?? "").trim().replace(/\s+/g, " ");
  if (!raw) {
    return "—";
  }
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

const headerCellClass =
  "text-xs font-semibold uppercase tracking-wide text-neutral-600 [&_.arco-table-th-item]:text-neutral-600";

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

function SpanIdCell({ spanId }: { spanId: string }) {
  const t = useTranslations("Traces");

  if (!spanId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="block min-w-0 truncate" title={spanId}>
        {spanId}
      </span>
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
              onClick={async (e) => {
                e.stopPropagation();
                triggerProps.onClick?.(e);
                try {
                  await navigator.clipboard.writeText(spanId);
                  toast.success(t("copied"));
                } catch {
                  // ignore
                }
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                triggerProps.onKeyDown?.(e);
              }}
              aria-label={t("traceInspectCopySpanId")}
            >
              <Copy className="size-3.5" strokeWidth={2} />
            </Button>
          )}
        />
        <TooltipContent>{t("copy")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function SpansDataTable({
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
  rows: SpanRecordRow[];
  sortKey: ObserveListSortParam;
  listOrder: "asc" | "desc";
  onColumnSort: (sort: ObserveListSortParam, order: "asc" | "desc") => void;
  onRowClick?: (row: SpanRecordRow) => void;
  channelFilter?: string;
  channelOptions?: string[];
  onChannelFilterChange?: (next: string) => void;
  agentFilter?: string;
  agentOptions?: string[];
  onAgentFilterChange?: (next: string) => void;
  statusFilter?: ObserveListStatusParam | "";
  onStatusFilterChange?: (next: ObserveListStatusParam | "") => void;
  emptyBody?: ReactNode;
}) {
  const t = useTranslations("Traces");

  const columns: TableColumnProps<SpanRecordRow>[] = useMemo(
    () => [
      {
        title: <span className={headerCellClass}>{t("spansColSpanId")}</span>,
        dataIndex: "span_id",
        key: "span_id",
        width: 200,
        render: (_, r) => <SpanIdCell spanId={r.span_id} />,
      },
      {
        title: (
          <span className={headerCellClass}>
            {onAgentFilterChange ? (
              <ObserveFacetColumnFilter
                label={t("spansColAgent")}
                value={agentFilter}
                options={agentOptions}
                onChange={onAgentFilterChange}
                ariaLabelKey="agentColumnFilterAria"
              />
            ) : (
              t("spansColAgent")
            )}
          </span>
        ),
        dataIndex: "agent_name",
        key: "agent_name",
        width: 140,
        render: (_, r) => (
          <span className="max-w-[10rem] truncate text-xs text-neutral-800" title={r.agent_name ?? ""}>
            {r.agent_name ?? "—"}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
            {onChannelFilterChange ? (
              <ObserveFacetColumnFilter
                label={t("spansColChannel")}
                value={channelFilter}
                options={channelOptions}
                onChange={onChannelFilterChange}
                ariaLabelKey="channelColumnFilterAria"
              />
            ) : (
              t("spansColChannel")
            )}
          </span>
        ),
        dataIndex: "channel_name",
        key: "channel_name",
        width: 140,
        render: (_, r) => (
          <span className="max-w-[10rem] truncate text-xs text-neutral-800" title={r.channel_name ?? ""}>
            {r.channel_name ?? "—"}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColName")}</span>,
        dataIndex: "name",
        key: "name",
        width: 180,
        render: (_, r) => (
          <span className="max-w-[12rem] truncate text-sm font-medium text-neutral-900" title={r.name}>
            {r.name || "—"}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColType")}</span>,
        dataIndex: "span_type",
        key: "span_type",
        width: 96,
        render: (_, r) => <span className="text-xs text-neutral-600">{r.span_type}</span>,
      },
      {
        title: (
          <span className={headerCellClass}>
            {onStatusFilterChange ? (
              <ObserveStatusColumnFilter
                label={t("spansColStatus")}
                value={statusFilter}
                onChange={onStatusFilterChange}
              />
            ) : (
              t("spansColStatus")
            )}
          </span>
        ),
        dataIndex: "list_status",
        key: "list_status",
        width: 120,
        render: (_, r) => <SpanStatusCell status={r.list_status} />,
      },
      {
        title: <span className={headerCellClass}>{t("spansColInput")}</span>,
        dataIndex: "input_preview",
        key: "input_preview",
        width: 200,
        render: (_, r) => (
          <span className="max-w-[14rem] text-xs text-neutral-600" title={r.input_preview ?? ""}>
            {clip(r.input_preview, 120)}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColOutput")}</span>,
        dataIndex: "output_preview",
        key: "output_preview",
        width: 200,
        render: (_, r) => (
          <span className="max-w-[14rem] text-xs text-neutral-600" title={r.output_preview ?? ""}>
            {clip(r.output_preview, 120)}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
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
          </span>
        ),
        dataIndex: "start_time_ms",
        key: "start_time_ms",
        width: 200,
        render: (_, r) => (
          <span className="whitespace-nowrap font-mono text-xs text-neutral-600">
            {r.start_time_ms != null
              ? formatTraceDateTimeLocal(new Date(r.start_time_ms).toISOString())
              : "—"}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColExecEnd")}</span>,
        dataIndex: "end_time_ms",
        key: "end_time_ms",
        width: 200,
        render: (_, r) => (
          <span className="whitespace-nowrap font-mono text-xs text-neutral-600">
            {r.end_time_ms != null ? formatTraceDateTimeLocal(new Date(r.end_time_ms).toISOString()) : "—"}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColDuration")}</span>,
        dataIndex: "duration_ms",
        key: "duration_ms",
        width: 96,
        render: (_, r) => (
          <span className="font-mono text-xs tabular-nums text-neutral-700">{formatSpanDuration(r.duration_ms)}</span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColTokens")}</span>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        width: 112,
        align: "right",
        render: (_, r) => (
          <span className="font-mono text-xs tabular-nums text-neutral-700">{String(r.total_tokens)}</span>
        ),
      },
    ],
    [
      t,
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
    ],
  );

  return (
    <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
      <ScrollableTableFrame variant="neutral" contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}>
        <div className="min-w-[1600px]">
          <Table<SpanRecordRow>
            className={OBSERVE_TABLE_CLASSNAME}
            size="small"
            border={false}
            columns={columns}
            data={rows}
            rowKey={(r) => `${r.trace_id}:${r.span_id}`}
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
