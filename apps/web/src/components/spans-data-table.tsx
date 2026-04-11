"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps, TableProps } from "@arco-design/web-react";
import { Popover, Table } from "@arco-design/web-react";
import { IconCopy, IconHistory } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
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
import { ObserveTableHeaderLabel } from "@/components/observe-table-header-label";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import {
  OBSERVE_TABLE_FRAME_CLASSNAME,
  OBSERVE_TABLE_SCROLL_X,
} from "@/lib/observe-table-style";
import { formatSpanDuration, type SpanRecordRow } from "@/lib/span-records";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { cn, formatShortId } from "@/lib/utils";

/** Bump when default column visibility changes. */
export const OBSERVE_SPANS_TABLE_ID = "observe-spans-v2";

const SPANS_COLUMN_MANDATORY = new Set([
  "span_id",
  "channel_name",
  "agent_name",
  "name",
  "list_status",
  "duration_ms",
  "input_preview",
  "output_preview",
]);

export const SPANS_OPTIONAL_KEYS: readonly string[] = ["start_time_ms", "end_time_ms", "total_tokens"];

/** 默认仅隐藏：执行开始、执行结束、Token（其余为默认展示列）。 */
export const SPANS_DEFAULT_HIDDEN_OPTIONAL: readonly string[] = [...SPANS_OPTIONAL_KEYS];

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

function SpanIdCell({ spanId, spanType }: { spanId: string; spanType: string }) {
  const t = useTranslations("Traces");
  const typeLine = spanType.trim() || "—";

  if (!spanId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="block truncate whitespace-nowrap text-xs text-neutral-800" title={spanId}>
          {formatShortId(spanId)}
        </span>
        <TraceCopyIconButton
          text={spanId}
          ariaLabel={t("traceInspectCopySpanId")}
          tooltipLabel={t("copy")}
          successLabel={t("copySuccessToast")}
          className="p-1 hover:bg-neutral-100"
          stopPropagation
        />
      </div>
      <span
        className="line-clamp-1 min-w-0 text-[11px] font-normal text-neutral-500 dark:text-neutral-400"
        title={typeLine}
      >
        {typeLine}
      </span>
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
  spanTypeFilter = "",
  spanTypeOptions = [],
  onSpanTypeFilterChange,
  statusFilters = [],
  onStatusFiltersChange,
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
  spanTypeFilter?: string;
  spanTypeOptions?: string[];
  onSpanTypeFilterChange?: (next: string) => void;
  statusFilters?: ObserveListStatusParam[];
  onStatusFiltersChange?: (next: ObserveListStatusParam[]) => void;
  emptyBody?: ReactNode;
  hiddenOptional?: Set<string>;
  showColumnManager?: boolean;
}) {
  const t = useTranslations("Traces");

  const { hiddenOptional: localHiddenOptional, toggleOptional, resetOptional } = useObserveTableColumnVisibility(
    OBSERVE_SPANS_TABLE_ID,
    SPANS_OPTIONAL_KEYS,
    SPANS_DEFAULT_HIDDEN_OPTIONAL,
  );
  const effectiveHiddenOptional = hiddenOptional ?? localHiddenOptional;

  const columnManagerItems = useMemo(
    () => [
      { key: "span_id", mandatory: true as const, label: t("spansColSpanId") },
      { key: "list_status", mandatory: true as const, label: t("spansColStatus") },
      { key: "agent_name", mandatory: true as const, label: t("spansColAgent") },
      { key: "channel_name", mandatory: true as const, label: t("spansColChannel") },
      { key: "name", mandatory: true as const, label: t("spansColName") },
      { key: "duration_ms", mandatory: true as const, label: t("spansColDuration") },
      { key: "input_preview", mandatory: true as const, label: t("spansColInput") },
      { key: "output_preview", mandatory: true as const, label: t("spansColOutput") },
      { key: "start_time_ms", label: t("spansColExecStart") },
      { key: "end_time_ms", label: t("spansColExecEnd") },
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
        title:
          onSpanTypeFilterChange && spanTypeOptions.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <ObserveFacetColumnFilter
                label={t("spansFilterSpanType")}
                value={spanTypeFilter}
                options={spanTypeOptions}
                onChange={onSpanTypeFilterChange}
                ariaLabelKey="spanTypeColumnFilterAria"
              />
              <ObserveTableHeaderLabel>{t("spansColSpanId")}</ObserveTableHeaderLabel>
            </div>
          ) : (
            <ObserveTableHeaderLabel>{t("spansColSpanId")}</ObserveTableHeaderLabel>
          ),
        dataIndex: "span_id",
        key: "span_id",
        fixed: "left",
        width: 230,
        render: (_, r) => <SpanIdCell spanId={r.span_id} spanType={r.span_type} />,
      },
      {
        title: onStatusFiltersChange ? (
          <ObserveStatusColumnFilter
            label={t("spansColStatus")}
            value={statusFilters}
            onChange={onStatusFiltersChange}
          />
        ) : (
          <ObserveTableHeaderLabel>{t("spansColStatus")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "list_status",
        key: "list_status",
        render: (_, r) => <SpanStatusCell status={r.list_status} />,
      },
      {
        title: onAgentFilterChange ? (
          <ObserveFacetColumnFilter
            label={t("spansColAgent")}
            value={agentFilter}
            options={agentOptions}
            onChange={onAgentFilterChange}
            ariaLabelKey="agentColumnFilterAria"
          />
        ) : (
          <ObserveTableHeaderLabel>{t("spansColAgent")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "agent_name",
        key: "agent_name",
        render: (_, r) => (
          <span
            className="line-clamp-2 min-w-0 break-words text-xs text-neutral-800 [overflow-wrap:anywhere]"
            title={r.agent_name ?? ""}
          >
            {r.agent_name ?? "—"}
          </span>
        ),
      },
      {
        title: onChannelFilterChange ? (
          <ObserveFacetColumnFilter
            label={t("spansColChannel")}
            value={channelFilter}
            options={channelOptions}
            onChange={onChannelFilterChange}
            ariaLabelKey="channelColumnFilterAria"
          />
        ) : (
          <ObserveTableHeaderLabel>{t("spansColChannel")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "channel_name",
        key: "channel_name",
        render: (_, r) => (
          <span
            className="line-clamp-2 min-w-0 break-words text-xs text-neutral-800 [overflow-wrap:anywhere]"
            title={r.channel_name ?? ""}
          >
            {r.channel_name ?? "—"}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColName")}</ObserveTableHeaderLabel>,
        dataIndex: "name",
        key: "name",
        render: (_, r) => (
          <span
            className="line-clamp-2 min-w-0 break-words text-sm font-medium text-neutral-900 [overflow-wrap:anywhere]"
            title={r.name}
          >
            {r.name || "—"}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColDuration")}</ObserveTableHeaderLabel>,
        dataIndex: "duration_ms",
        key: "duration_ms",
        width: 100,
        render: (_, r) => {
          const startFmt =
            r.start_time_ms != null
              ? formatTraceDateTimeLocal(new Date(r.start_time_ms).toISOString())
              : "—";
          const endFmt =
            r.end_time_ms != null ? formatTraceDateTimeLocal(new Date(r.end_time_ms).toISOString()) : "—";
          const durationText = formatSpanDuration(r.duration_ms);
          const popoverStyle: CSSProperties = {
            maxWidth: "min(100vw - 2rem, 20rem)",
            padding: 0,
            boxSizing: "border-box",
          };
          return (
            <Popover
              trigger="hover"
              position="top"
              triggerProps={{ popupStyle: popoverStyle }}
              content={
                <div className="box-border min-w-0 px-3 py-2 text-xs text-neutral-800">
                  <div className="flex min-w-0 gap-2">
                    <span className="shrink-0 text-neutral-500">{t("colStartTime")}</span>
                    <span className="min-w-0 break-words tabular-nums">{startFmt}</span>
                  </div>
                  <div className="mt-1.5 flex min-w-0 gap-2">
                    <span className="shrink-0 text-neutral-500">{t("colEndTime")}</span>
                    <span className="min-w-0 break-words tabular-nums">{endFmt}</span>
                  </div>
                </div>
              }
            >
              <span
                className="inline-flex min-w-0 cursor-default items-center gap-1 tabular-nums"
                data-row-click-stop
              >
                <IconHistory className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
                <span className="text-xs text-neutral-800">{durationText}</span>
              </span>
            </Popover>
          );
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColInput")}</ObserveTableHeaderLabel>,
        dataIndex: "input_preview",
        key: "input_preview",
        width: 320,
        render: (_, r) => (
          <div className="min-w-0 w-[20rem] max-w-full">
            <ObserveIoPreviewPopoverCell
              fullText={r.input_preview ?? ""}
              ariaLabel={t("spanListInputFullAria")}
              previewClassName="w-full max-w-full"
            />
          </div>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColOutput")}</ObserveTableHeaderLabel>,
        dataIndex: "output_preview",
        key: "output_preview",
        width: 320,
        render: (_, r) => (
          <div className="min-w-0 w-[20rem] max-w-full">
            <ObserveIoPreviewPopoverCell
              fullText={r.output_preview ?? ""}
              ariaLabel={t("spanListOutputFullAria")}
              previewClassName="w-full max-w-full"
            />
          </div>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColExecStart")}</ObserveTableHeaderLabel>,
        dataIndex: "start_time_ms",
        key: "start_time_ms",
        sorter: (a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0),
        sortOrder: observeColumnSortOrder("start_time_ms", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        render: (_, r) => (
          <span className="whitespace-nowrap text-xs text-neutral-600">
            {r.start_time_ms != null
              ? formatTraceDateTimeLocal(new Date(r.start_time_ms).toISOString())
              : "—"}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColExecEnd")}</ObserveTableHeaderLabel>,
        dataIndex: "end_time_ms",
        key: "end_time_ms",
        render: (_, r) => (
          <span className="whitespace-nowrap text-xs text-neutral-600">
            {r.end_time_ms != null ? formatTraceDateTimeLocal(new Date(r.end_time_ms).toISOString()) : "—"}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("spansColTokens")}</ObserveTableHeaderLabel>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        sorter: (a, b) => (a.total_tokens ?? 0) - (b.total_tokens ?? 0),
        sortOrder: observeColumnSortOrder("total_tokens", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
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
      spanTypeFilter,
      spanTypeOptions,
      onSpanTypeFilterChange,
      statusFilters,
      onStatusFiltersChange,
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
      <ScrollableTableFrame
        variant="neutral"
        contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}
        scrollClassName="overflow-x-visible touch-pan-x overscroll-x-contain"
      >
        <div className="min-w-0 w-full">
          <Table<SpanRecordRow>
            tableLayoutFixed
            size="small"
            border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
            columns={columns}
            data={sortedRows}
            rowKey={(r) => `${r.trace_id}:${r.span_id}`}
            pagination={false}
            scroll={OBSERVE_TABLE_SCROLL_X}
            hover={true}
            noDataElement={
              rows.length === 0 ? (emptyBody ?? <div className="flex justify-center px-4 py-10" />) : undefined
            }
            onChange={onTableChange}
            rowClassName={onRowClick ? () => "cursor-pointer" : undefined}
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
                  })
                : undefined
            }
          />
        </div>
      </ScrollableTableFrame>
    </div>
  );
}
