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
import { ObserveTableHeaderLabel } from "@/components/observe-table-header-label";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTraceDateTimeLocal } from "@/lib/trace-datetime";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import type { ObserveListSortParam, ObserveListStatusParam } from "@/lib/observe-facets";
import { extractInboundDisplayPreview } from "@/lib/strip-inbound-meta";
import {
  OBSERVE_TABLE_CLASSNAME,
  OBSERVE_TABLE_FRAME_CLASSNAME,
  OBSERVE_TABLE_SCROLL_X,
} from "@/lib/observe-table-style";
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
import { cn, formatShortId } from "@/lib/utils";

/** Bump when default column visibility changes so new defaults apply. */
export const OBSERVE_TRACES_TABLE_ID = "observe-traces-v3";

const TRACES_COLUMN_MANDATORY = new Set(["trace_id", "channel", "agent", "status", "duration"]);

export const TRACES_OPTIONAL_KEYS: readonly string[] = [
  "openclaw_routing_kind",
  "openclaw_routing_thinking",
  "openclaw_routing_fast",
  "openclaw_routing_verbose",
  "openclaw_routing_reasoning",
  "start_time",
  "input",
  "output",
  "errors",
  "total_tokens",
];

/** 默认隐藏的可选列（输入、输出默认显示）。 */
export const TRACES_DEFAULT_HIDDEN_OPTIONAL: readonly string[] = TRACES_OPTIONAL_KEYS.filter(
  (k) => k !== "input" && k !== "output",
);

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

function traceListTraceTypeLabel(raw: string | undefined, t: (key: string) => string): string {
  const v = raw?.trim();
  if (!v) {
    return t("traceTypeUnknown");
  }
  const low = v.toLowerCase();
  if (low === "external") {
    return t("traceTypeExternal");
  }
  if (low === "subagent") {
    return t("traceTypeSubagent");
  }
  if (low === "async_command") {
    return t("traceTypeAsyncCommand");
  }
  if (low === "system") {
    return t("traceTypeSystem");
  }
  return v;
}

function TraceIdCell({ traceId, traceTypeLabel }: { traceId: string; traceTypeLabel: string }) {
  const t = useTranslations("Traces");

  if (!traceId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
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
      <span
        className="line-clamp-1 min-w-0 text-[11px] font-normal text-neutral-500 dark:text-neutral-400"
        title={traceTypeLabel}
      >
        {traceTypeLabel}
      </span>
    </div>
  );
}

/** OpenClaw 路由列：中文下不用全大写，列头用 title 展示说明 */
const openclawRoutingHeaderClass =
  "inline-flex items-center whitespace-nowrap text-xs font-semibold text-neutral-600 [&_.arco-table-th-item]:whitespace-nowrap [&_.arco-table-th-item]:text-neutral-600";

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
  } = useObserveTableColumnVisibility(OBSERVE_TRACES_TABLE_ID, TRACES_OPTIONAL_KEYS, TRACES_DEFAULT_HIDDEN_OPTIONAL);
  const effectiveHiddenOptional = hiddenOptional ?? localHiddenOptional;

  const columnManagerItems = useMemo(
    () => [
      { key: "trace_id", mandatory: true as const, label: t("colTableMessageId") },
      { key: "status", mandatory: true as const, label: t("colStatus") },
      { key: "agent", mandatory: true as const, label: t("filterAgentLabel") },
      { key: "channel", mandatory: true as const, label: t("filterChannelLabel") },
      { key: "duration", mandatory: true as const, label: t("colDuration") },
      { key: "openclaw_routing_kind", label: t("openclawRoutingFieldKind") },
      { key: "openclaw_routing_thinking", label: t("openclawRoutingFieldThinking") },
      { key: "openclaw_routing_fast", label: t("openclawRoutingFieldFast") },
      { key: "openclaw_routing_verbose", label: t("openclawRoutingFieldVerbose") },
      { key: "openclaw_routing_reasoning", label: t("openclawRoutingFieldReasoning") },
      { key: "start_time", label: t("colStartTime") },
      { key: "input", label: t("colInput") },
      { key: "output", label: t("colOutput") },
      { key: "errors", label: t("colErrors") },
      { key: "total_tokens", label: t("colTotalTokens") },
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
        title: <ObserveTableHeaderLabel>{t("colTableMessageId")}</ObserveTableHeaderLabel>,
        dataIndex: "trace_id",
        key: "trace_id",
        fixed: "left",
        width: 260,
        render: (_, row) => (
          <TraceIdCell traceId={row.trace_id} traceTypeLabel={traceListTraceTypeLabel(row.trace_type, t)} />
        ),
      },
      {
        title: onStatusFilterChange ? (
          <ObserveStatusColumnFilter
            label={t("colStatus")}
            value={statusFilter}
            onChange={onStatusFilterChange}
          />
        ) : (
          <ObserveTableHeaderLabel>{t("colStatus")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "status",
        key: "status",
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
        title: onAgentFilterChange ? (
          <ObserveFacetColumnFilter
            label={t("filterAgentLabel")}
            value={agentFilter}
            options={agentOptions}
            onChange={onAgentFilterChange}
            ariaLabelKey="agentColumnFilterAria"
          />
        ) : (
          <ObserveTableHeaderLabel>{t("filterAgentLabel")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "agent",
        key: "agent",
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
        title: onChannelFilterChange ? (
          <ObserveFacetColumnFilter
            label={t("filterChannelLabel")}
            value={channelFilter}
            options={channelOptions}
            onChange={onChannelFilterChange}
            ariaLabelKey="channelColumnFilterAria"
          />
        ) : (
          <ObserveTableHeaderLabel>{t("filterChannelLabel")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "channel",
        key: "channel",
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
        title: <ObserveTableHeaderLabel>{t("colDuration")}</ObserveTableHeaderLabel>,
        dataIndex: "duration",
        key: "duration",
        width: 200,
        render: (_, row) => {
          const startFmt = formatTraceDateTimeLocal(new Date(row.start_time).toISOString());
          const endFmt =
            row.end_time != null && typeof row.end_time === "number" && Number.isFinite(row.end_time)
              ? formatTraceDateTimeLocal(new Date(row.end_time).toISOString())
              : "—";
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs tabular-nums text-neutral-800">
                {formatDurationMs(traceRecordDurationMs(row))}
              </span>
              <span
                className="line-clamp-2 break-words text-[11px] leading-snug text-neutral-500 dark:text-neutral-400"
                title={`${startFmt} – ${endFmt}`}
              >
                {startFmt} – {endFmt}
              </span>
            </div>
          );
        },
      },
      {
        title: <span className={openclawRoutingHeaderClass}>{t("openclawRoutingFieldKind")}</span>,
        dataIndex: "openclaw_routing_kind",
        key: "openclaw_routing_kind",
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
        render: (_, row) => (
          <OpenclawRoutingMappedCell raw={traceRecordOpenclawRouting(row)?.reasoning} role="reasoning" t={t} />
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("colStartTime")}</ObserveTableHeaderLabel>,
        dataIndex: "start_time",
        key: "start_time",
        sorter: (a, b) => (a.start_time ?? 0) - (b.start_time ?? 0),
        sortOrder: observeColumnSortOrder("start_time", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        render: (_, row) => (
          <span className="text-xs text-neutral-700">
            {formatTraceDateTimeLocal(new Date(row.start_time).toISOString())}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("colInput")}</ObserveTableHeaderLabel>,
        dataIndex: "input",
        key: "input",
        width: 320,
        render: (_, row) => (
          <div className="min-w-0 w-[20rem] max-w-full">
            <ObserveIoPreviewPopoverCell
              fullText={rowFullInputText(row)}
              ariaLabel={t("traceListInputFullAria")}
              previewClassName="w-full max-w-full"
            />
          </div>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("colOutput")}</ObserveTableHeaderLabel>,
        dataIndex: "output",
        key: "output",
        width: 320,
        render: (_, row) => (
          <div className="min-w-0 w-[20rem] max-w-full">
            <ObserveIoPreviewPopoverCell
              fullText={rowFullOutputText(row)}
              ariaLabel={t("traceListOutputFullAria")}
              previewClassName="w-full max-w-full"
            />
          </div>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("colErrors")}</ObserveTableHeaderLabel>,
        dataIndex: "errors",
        key: "errors",
        align: "left",
        render: (_, row) => {
          const fail = ["error", "timeout"].includes(String(row.status).toLowerCase());
          return <span className="text-xs tabular-nums text-neutral-700">{fail ? 1 : 0}</span>;
        },
      },
      {
        title: <ObserveTableHeaderLabel>{t("colTotalTokens")}</ObserveTableHeaderLabel>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        sorter: (a, b) => (a.total_tokens ?? 0) - (b.total_tokens ?? 0),
        sortOrder: observeColumnSortOrder("total_tokens", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        render: (_, row) => (
          <span className="text-xs tabular-nums text-neutral-800">
            {typeof row.total_tokens === "number" ? row.total_tokens.toLocaleString() : "—"}
          </span>
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
      <ScrollableTableFrame
        variant="neutral"
        contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}
        scrollClassName="overflow-x-visible touch-pan-x overscroll-x-contain"
      >
        <div className="min-w-0 w-full">
          <Table<TraceRecordRow>
            tableLayoutFixed
            size="small"
            border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
            columns={columns}
            data={sortedRows}
            rowKey={(r) => r.trace_id || `${r.thread_key}-${r.start_time}`}
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
