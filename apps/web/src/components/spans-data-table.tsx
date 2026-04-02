"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps, TableProps } from "@arco-design/web-react";
import { Table } from "@arco-design/web-react";
import { IconCopy } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import {
  applyObserveTableSortChange,
  observeColumnSortOrder,
  sortObserveRows,
} from "@/lib/observe-table-arco-sort";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import { ObserveIoPreviewPopoverCell } from "@/components/observe-io-preview-popover-cell";
import {
  ObserveTableColumnManager,
  useObserveTableColumnVisibility,
} from "@/components/observe-table-column-manager";
import { ObserveStatusColumnFilter } from "@/components/observe-status-column-filter";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_CLASSNAME, OBSERVE_TABLE_FRAME_CLASSNAME } from "@/lib/observe-table-style";
import { formatSpanDuration, type SpanRecordRow } from "@/lib/span-records";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";

export const OBSERVE_SPANS_TABLE_ID = "observe-spans";

const SPANS_COLUMN_MANDATORY = new Set(["span_id", "list_status", "input_preview"]);

export const SPANS_OPTIONAL_KEYS: readonly string[] = [
  "agent_name",
  "channel_name",
  "name",
  "span_type",
  "output_preview",
  "start_time_ms",
  "end_time_ms",
  "duration_ms",
  "total_tokens",
];

const headerCellClass =
  "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-600 [&_.arco-table-th-item]:whitespace-nowrap [&_.arco-table-th-item]:text-neutral-600";

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
        "inline-flex max-w-full whitespace-nowrap truncate rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
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
      <span className="block truncate whitespace-nowrap text-xs text-neutral-800" title={spanId}>
        {formatShortId(spanId)}
      </span>
      <TraceCopyIconButton
        text={spanId}
        ariaLabel={t("traceInspectCopySpanId")}
        tooltipLabel={t("copy")}
        successLabel={t("copied")}
        className="p-1 hover:bg-neutral-100"
        stopPropagation
      />
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
  hiddenOptional,
  showColumnManager = true,
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
  hiddenOptional?: Set<string>;
  showColumnManager?: boolean;
}) {
  const t = useTranslations("Traces");

  const { hiddenOptional: localHiddenOptional, toggleOptional, resetOptional } = useObserveTableColumnVisibility(
    OBSERVE_SPANS_TABLE_ID,
    SPANS_OPTIONAL_KEYS,
  );
  const effectiveHiddenOptional = hiddenOptional ?? localHiddenOptional;

  const columnManagerItems = useMemo(
    () => [
      { key: "span_id", mandatory: true as const, label: t("spansColSpanId") },
      { key: "list_status", mandatory: true as const, label: t("spansColStatus") },
      { key: "input_preview", mandatory: true as const, label: t("spansColInput") },
      { key: "agent_name", label: t("spansColAgent") },
      { key: "channel_name", label: t("spansColChannel") },
      { key: "name", label: t("spansColName") },
      { key: "span_type", label: t("spansColType") },
      { key: "output_preview", label: t("spansColOutput") },
      { key: "start_time_ms", label: t("spansColExecStart") },
      { key: "end_time_ms", label: t("spansColExecEnd") },
      { key: "duration_ms", label: t("spansColDuration") },
      { key: "total_tokens", label: t("spansColTokens") },
    ],
    [t],
  );

  const onTableChange = useCallback<NonNullable<TableProps<SpanRecordRow>["onChange"]>>(
    (_pagination, sorter, _filters, extra) => {
      applyObserveTableSortChange(sorter, extra, onColumnSort);
    },
    [onColumnSort],
  );

  const sortedRows = useMemo(
    () =>
      sortObserveRows(
        rows,
        sortKey,
        listOrder,
        (row) => row.start_time_ms,
        (row) => row.total_tokens,
      ),
    [rows, sortKey, listOrder],
  );

  const allColumns: TableColumnProps<SpanRecordRow>[] = useMemo(
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
        width: 320,
        render: (_, r) => (
          <div className="min-w-0">
            <ObserveIoPreviewPopoverCell
              fullText={r.input_preview ?? ""}
              ariaLabel={t("spanListInputFullAria")}
            />
          </div>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColOutput")}</span>,
        dataIndex: "output_preview",
        key: "output_preview",
        width: 320,
        render: (_, r) => (
          <div className="min-w-0">
            <ObserveIoPreviewPopoverCell
              fullText={r.output_preview ?? ""}
              ariaLabel={t("spanListOutputFullAria")}
            />
          </div>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColExecStart")}</span>,
        dataIndex: "start_time_ms",
        key: "start_time_ms",
        sorter: (a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0),
        sortOrder: observeColumnSortOrder("start_time_ms", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        width: 200,
        render: (_, r) => (
          <span className="whitespace-nowrap text-xs text-neutral-600">
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
          <span className="whitespace-nowrap text-xs text-neutral-600">
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
          <span className="text-xs tabular-nums text-neutral-700">{formatSpanDuration(r.duration_ms)}</span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("spansColTokens")}</span>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        sorter: (a, b) => (a.total_tokens ?? 0) - (b.total_tokens ?? 0),
        sortOrder: observeColumnSortOrder("total_tokens", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        width: 112,
        align: "right",
        render: (_, r) => (
          <span className="text-xs tabular-nums text-neutral-700">{String(r.total_tokens)}</span>
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

  const columns = useMemo(
    () =>
      allColumns.filter((c) => {
        const k = String(c.key);
        if (SPANS_COLUMN_MANDATORY.has(k)) {
          return true;
        }
        return !effectiveHiddenOptional.has(k);
      }),
    [allColumns, effectiveHiddenOptional],
  );

  return (
    <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
      {showColumnManager ? (
        <div className="mb-2 flex justify-end">
          <ObserveTableColumnManager
            items={columnManagerItems}
            hiddenOptional={effectiveHiddenOptional}
            onToggleOptional={toggleOptional}
            onReset={resetOptional}
          />
        </div>
      ) : null}
      <ScrollableTableFrame variant="neutral" contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}>
        <div className="min-w-[1840px]">
          <Table<SpanRecordRow>
            className={OBSERVE_TABLE_CLASSNAME}
            size="small"
            border={false}
            columns={columns}
            data={sortedRows}
            rowKey={(r) => `${r.trace_id}:${r.span_id}`}
            pagination={false}
            tableLayoutFixed={false}
            hover={Boolean(onRowClick)}
            noDataElement={
              rows.length === 0 ? (emptyBody ?? <div className="flex justify-center px-4 py-10" />) : undefined
            }
            onChange={onTableChange}
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
