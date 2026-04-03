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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";
import { OBSERVE_TABLE_CLASSNAME, OBSERVE_TABLE_FRAME_CLASSNAME } from "@/lib/observe-table-style";
import {
  displayOpenclawFast,
  displayOpenclawKind,
  displayOpenclawReasoning,
  displayOpenclawThinking,
  displayOpenclawVerbose,
} from "@/lib/openclaw-routing-display";
import {
  formatDurationMs,
  statusBandLabel,
  statusBandPillClass,
  traceListStatusBandFromApiStatus,
  traceRecordAgentName,
  traceRecordChannel,
  traceRecordDurationMs,
  traceRecordOpenclawRouting,
  type TraceRecordRow,
} from "@/lib/trace-records";
import { formatShortId } from "@/lib/utils";

export const OBSERVE_TRACES_TABLE_ID = "observe-traces";

const TRACES_COLUMN_MANDATORY = new Set(["trace_id", "status", "input"]);

export const TRACES_OPTIONAL_KEYS: readonly string[] = [
  "channel",
  "agent",
  "openclaw_routing_kind",
  "openclaw_routing_thinking",
  "openclaw_routing_fast",
  "openclaw_routing_verbose",
  "openclaw_routing_reasoning",
  "start_time",
  "output",
  "errors",
  "duration",
  "total_tokens",
  "total_cost",
  "tags",
];

function rowFullInputText(row: TraceRecordRow): string {
  const raw = row.last_message_preview;
  if (typeof raw !== "string" || !raw.trim()) {
    return "";
  }
  return extractInboundDisplayPreview(raw).trim();
}

function rowFullOutputText(row: TraceRecordRow): string {
  const raw = row.output_preview;
  return typeof raw === "string" ? raw.trim() : "";
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const t = useTranslations("Traces");

  if (!traceId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="block truncate whitespace-nowrap text-xs text-neutral-800" title={traceId}>
        {formatShortId(traceId)}
      </span>
      <TraceCopyIconButton
        text={traceId}
        ariaLabel={t("copyIdAria", { kind: t("idKinds.trace_id") })}
        tooltipLabel={t("copy")}
        successLabel={t("copySuccessToast")}
        className="p-1 hover:bg-neutral-100"
        stopPropagation
      />
    </div>
  );
}

const headerCellClass =
  "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-600 [&_.arco-table-th-item]:whitespace-nowrap [&_.arco-table-th-item]:text-neutral-600";

/** OpenClaw 路由列：中文下不用全大写，列头用 title 展示说明 */
const openclawRoutingHeaderClass =
  "whitespace-nowrap text-xs font-semibold text-neutral-600 [&_.arco-table-th-item]:whitespace-nowrap [&_.arco-table-th-item]:text-neutral-600";

function OpenclawRoutingTextCell({ value }: { value: string | undefined }) {
  if (value === undefined || value === "") {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  return (
    <span className="line-clamp-2 min-w-0 break-words text-xs text-neutral-800 dark:text-neutral-100" title={value}>
      {value}
    </span>
  );
}

function OpenclawRoutingMappedCell({
  raw,
  role,
  t,
}: {
  raw: string | undefined;
  role: "thinking" | "fast" | "verbose" | "reasoning";
  t: (key: string) => string;
}) {
  const d =
    role === "thinking"
      ? displayOpenclawThinking(raw, t)
      : role === "fast"
        ? displayOpenclawFast(raw, t)
        : role === "verbose"
          ? displayOpenclawVerbose(raw, t)
          : displayOpenclawReasoning(raw, t);
  if (d.text === "\u2014") {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  return (
    <span
      className="line-clamp-2 min-w-0 break-words text-xs text-neutral-800 dark:text-neutral-100"
      title={d.title ?? d.text}
    >
      {d.text}
    </span>
  );
}

function OpenclawRoutingKindCell({ row, t }: { row: TraceRecordRow; t: (key: string) => string }) {
  const raw = traceRecordOpenclawRouting(row)?.kind;
  const d = displayOpenclawKind(raw, t);
  if (d.text === "\u2014") {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  return (
    <span
      className="inline-flex max-w-full truncate rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
      title={d.title ?? d.text}
    >
      {d.text}
    </span>
  );
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
  hiddenOptional,
  showColumnManager = true,
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
  hiddenOptional?: Set<string>;
  showColumnManager?: boolean;
}) {
  const t = useTranslations("Traces");

  const {
    hiddenOptional: localHiddenOptional,
    toggleOptional,
    resetOptional,
  } = useObserveTableColumnVisibility(
    OBSERVE_TRACES_TABLE_ID,
    TRACES_OPTIONAL_KEYS,
  );
  const effectiveHiddenOptional = hiddenOptional ?? localHiddenOptional;

  const columnManagerItems = useMemo(
    () => [
      { key: "trace_id", mandatory: true as const, label: t("colTableMessageId") },
      { key: "status", mandatory: true as const, label: t("colStatus") },
      { key: "input", mandatory: true as const, label: t("colInput") },
      { key: "channel", label: t("filterChannelLabel") },
      { key: "agent", label: t("filterAgentLabel") },
      { key: "openclaw_routing_kind", label: t("openclawRoutingFieldKind") },
      { key: "openclaw_routing_thinking", label: t("openclawRoutingFieldThinking") },
      { key: "openclaw_routing_fast", label: t("openclawRoutingFieldFast") },
      { key: "openclaw_routing_verbose", label: t("openclawRoutingFieldVerbose") },
      { key: "openclaw_routing_reasoning", label: t("openclawRoutingFieldReasoning") },
      { key: "start_time", label: t("colStartTime") },
      { key: "output", label: t("colOutput") },
      { key: "errors", label: t("colErrors") },
      { key: "duration", label: t("colDuration") },
      { key: "total_tokens", label: t("colTotalTokens") },
      { key: "total_cost", label: t("colEstCost") },
      { key: "tags", label: t("colTags") },
    ],
    [t],
  );

  const onTableChange = useCallback<NonNullable<TableProps<TraceRecordRow>["onChange"]>>(
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
        (row) => row.start_time,
        (row) => row.total_tokens,
      ),
    [rows, sortKey, listOrder],
  );

  const allColumns: TableColumnProps<TraceRecordRow>[] = useMemo(
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
        title: <span className={openclawRoutingHeaderClass}>{t("openclawRoutingFieldKind")}</span>,
        dataIndex: "openclaw_routing_kind",
        key: "openclaw_routing_kind",
        width: 88,
        render: (_, row) => <OpenclawRoutingKindCell row={row} t={t} />,
      },
      {
        title: (
          <span className={openclawRoutingHeaderClass} title={t("openclawRoutingFieldThinkingHeaderHint")}>
            {t("openclawRoutingFieldThinking")}
          </span>
        ),
        dataIndex: "openclaw_routing_thinking",
        key: "openclaw_routing_thinking",
        width: 100,
        render: (_, row) => (
          <OpenclawRoutingMappedCell raw={traceRecordOpenclawRouting(row)?.thinking} role="thinking" t={t} />
        ),
      },
      {
        title: (
          <span className={openclawRoutingHeaderClass} title={t("openclawRoutingFieldFastHeaderHint")}>
            {t("openclawRoutingFieldFast")}
          </span>
        ),
        dataIndex: "openclaw_routing_fast",
        key: "openclaw_routing_fast",
        width: 96,
        render: (_, row) => (
          <OpenclawRoutingMappedCell
            raw={
              traceRecordOpenclawRouting(row)?.fast !== undefined
                ? String(traceRecordOpenclawRouting(row)!.fast)
                : undefined
            }
            role="fast"
            t={t}
          />
        ),
      },
      {
        title: (
          <span className={openclawRoutingHeaderClass} title={t("openclawRoutingFieldVerboseHeaderHint")}>
            {t("openclawRoutingFieldVerbose")}
          </span>
        ),
        dataIndex: "openclaw_routing_verbose",
        key: "openclaw_routing_verbose",
        width: 104,
        render: (_, row) => (
          <OpenclawRoutingMappedCell raw={traceRecordOpenclawRouting(row)?.verbose} role="verbose" t={t} />
        ),
      },
      {
        title: (
          <span className={openclawRoutingHeaderClass} title={t("openclawRoutingFieldReasoningHeaderHint")}>
            {t("openclawRoutingFieldReasoning")}
          </span>
        ),
        dataIndex: "openclaw_routing_reasoning",
        key: "openclaw_routing_reasoning",
        width: 96,
        render: (_, row) => (
          <OpenclawRoutingMappedCell raw={traceRecordOpenclawRouting(row)?.reasoning} role="reasoning" t={t} />
        ),
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
              )} whitespace-nowrap`}
            >
              {statusBandLabel(traceListStatusBandFromApiStatus(row.status), row.status, t)}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          ),
      },
      {
        title: <span className={headerCellClass}>{t("colStartTime")}</span>,
        dataIndex: "start_time",
        key: "start_time",
        sorter: (a, b) => (a.start_time ?? 0) - (b.start_time ?? 0),
        sortOrder: observeColumnSortOrder("start_time", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        width: 160,
        render: (_, row) => (
          <span className="text-xs text-neutral-700">
            {formatTraceDateTimeLocal(new Date(row.start_time).toISOString())}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colInput")}</span>,
        dataIndex: "input",
        key: "input",
        width: 360,
        render: (_, row) => (
          <div className="min-w-0">
            <ObserveIoPreviewPopoverCell fullText={rowFullInputText(row)} ariaLabel={t("traceListInputFullAria")} />
          </div>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colOutput")}</span>,
        dataIndex: "output",
        key: "output",
        width: 360,
        render: (_, row) => (
          <div className="min-w-0">
            <ObserveIoPreviewPopoverCell fullText={rowFullOutputText(row)} ariaLabel={t("traceListOutputFullAria")} />
          </div>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colErrors")}</span>,
        dataIndex: "errors",
        key: "errors",
        width: 88,
        align: "left",
        render: (_, row) => {
          const fail = ["error", "timeout"].includes(String(row.status).toLowerCase());
          return <span className="text-xs tabular-nums text-neutral-700">{fail ? 1 : 0}</span>;
        },
      },
      {
        title: <span className={headerCellClass}>{t("colDuration")}</span>,
        dataIndex: "duration",
        key: "duration",
        width: 112,
        render: (_, row) => (
          <span className="text-xs tabular-nums text-neutral-800">
            {formatDurationMs(traceRecordDurationMs(row))}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colTotalTokens")}</span>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        sorter: (a, b) => (a.total_tokens ?? 0) - (b.total_tokens ?? 0),
        sortOrder: observeColumnSortOrder("total_tokens", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        width: 128,
        render: (_, row) => (
          <span className="text-xs tabular-nums text-neutral-800">
            {typeof row.total_tokens === "number" ? row.total_tokens.toLocaleString() : "—"}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colEstCost")}</span>,
        dataIndex: "total_cost",
        key: "total_cost",
        width: 112,
        render: (_, row) => (
          <span className="text-xs tabular-nums text-neutral-600">
            {row.total_cost != null && Number.isFinite(row.total_cost) ? row.total_cost.toFixed(4) : "—"}
          </span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colTags")}</span>,
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
        if (TRACES_COLUMN_MANDATORY.has(k)) {
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
        <div className="min-w-[2100px]">
          <Table<TraceRecordRow>
            className={OBSERVE_TABLE_CLASSNAME}
            size="small"
            border={false}
            columns={columns}
            data={sortedRows}
            rowKey={(r) => r.trace_id || `${r.thread_key}-${r.start_time}`}
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
