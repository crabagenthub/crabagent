"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps, TableProps } from "@arco-design/web-react";
import { Table } from "@arco-design/web-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Components } from "react-markdown";
import {
  applyObserveTableSortChange,
  observeColumnSortOrder,
  sortObserveRows,
} from "@/lib/observe-table-arco-sort";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import {
  ObserveTableColumnManager,
  useObserveTableColumnVisibility,
} from "@/components/observe-table-column-manager";
import { Markdown } from "@/components/prompt-kit/markdown";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { ObserveTableHeaderLabel } from "@/components/observe-table-header-label";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { IconClockCircle } from "@arco-design/web-react/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover } from "@arco-design/web-react";
import type { ObserveListSortParam } from "@/lib/observe-facets";
import {
  OBSERVE_TABLE_FRAME_CLASSNAME,
  OBSERVE_TABLE_SCROLL_X,
} from "@/lib/observe-table-style";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import {
  statusBandLabel,
  statusBandPillClass,
  traceListStatusBandFromApiStatus,
} from "@/lib/trace-records";
import { extractThreadListMessageText } from "@/lib/strip-inbound-meta";
import { threadRowStableId, type ThreadRecordRow } from "@/lib/thread-records";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import { cn, formatThreadListSessionId } from "@/lib/utils";

export const OBSERVE_THREADS_TABLE_ID = "observe-threads";

const THREADS_COLUMN_MANDATORY = new Set(["thread_id", "status", "last_message_preview"]);

export const THREADS_OPTIONAL_KEYS: readonly string[] = [
  "agent_name",
  "channel_name",
  "trace_count",
  "total_tokens",
];

const threadMessagePopoverMarkdownComponents: Partial<Components> = {
  pre: ({ children }) => (
    <pre className="my-2 box-border w-max min-w-0 max-w-none rounded-lg bg-neutral-50 px-3 py-2 text-[12px] leading-5 text-neutral-800 whitespace-pre">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line;

    if (isInline) {
      return (
        <code className={cn("rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800", className)}>
          {children}
        </code>
      );
    }

    return (
      <code className={cn("font-mono text-[12px] text-neutral-800", className)}>
        {children}
      </code>
    );
  },
};

function EmptyDash() {
  return <span className="text-xs text-neutral-400">—</span>;
}

function TruncatedTextCell({
  text,
  widthClass,
  className,
}: {
  text: string | null | undefined;
  /** 可选：限制最大宽度；未传时按内容自适应（最多两行） */
  widthClass?: string;
  className?: string;
}) {
  const value = (text ?? "").trim();
  if (!value) {
    return <EmptyDash />;
  }
  return (
    <span
      className={cn(
        "block min-w-0 text-xs text-neutral-800",
        widthClass
          ? cn("truncate whitespace-nowrap", widthClass)
          : "line-clamp-2 whitespace-normal break-words [overflow-wrap:anywhere]",
        className,
      )}
    >
      {value}
    </span>
  );
}

function ThreadIdCell({ row }: { row: ThreadRecordRow }) {
  const t = useTranslations("Traces");
  const threadId = row.thread_id;

  if (!threadId.trim()) {
    return <EmptyDash />;
  }

  const isSubagent = row.thread_type === "subagent";

  return (
    <div className="flex min-w-0 flex-col gap-1.5 py-0.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <span
          className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-neutral-900"
          title={threadId}
        >
          {formatThreadListSessionId(threadId)}
        </span>
        <TraceCopyIconButton
          text={threadId}
          ariaLabel={t("threadDrawerCopyThreadId")}
          tooltipLabel={t("copy")}
          successLabel={t("copySuccessToast")}
          className="shrink-0 p-1 hover:bg-neutral-100"
          stopPropagation
        />
      </div>
      <div>
        <span
          className={cn(
            "inline-flex max-w-full rounded-md px-2 py-0.5 text-[11px] font-medium leading-tight",
            isSubagent
              ? "bg-violet-100 text-violet-900 dark:bg-violet-950/45 dark:text-violet-100"
              : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-200",
          )}
        >
          {isSubagent ? t("threadsListSessionKindSubagent") : t("threadsListSessionKindMain")}
        </span>
      </div>
    </div>
  );
}

function ThreadMessageCell({
  raw,
  ariaLabel,
  extractText,
  previewLineClamp = 2,
}: {
  raw: string | null | undefined;
  ariaLabel: string;
  extractText: (raw: string | null | undefined) => string;
  /** 列表「最新消息」列：第一行预览用单行截断，第二行显示时间 */
  previewLineClamp?: 1 | 2;
}) {
  const full = extractText(raw).trim();
  if (!full) {
    return <EmptyDash />;
  }

  const normalized = full.replace(/\s+/g, " ").trim();
  const needsPopover =
    previewLineClamp === 1
      ? full.includes("\n") || normalized.length > 48
      : full.includes("\n") || normalized.length > 72;

  const body = (
    <span
      aria-label={ariaLabel}
      className="block w-[20rem] max-w-full min-w-0 whitespace-normal break-words text-xs leading-5 text-neutral-800"
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: previewLineClamp,
        overflow: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {full}
    </span>
  );

  if (!needsPopover) {
    return body;
  }

  /** 滚动约束在气泡根节点（Trigger 合并到 `arco-popover-content`），避免内层 max-height 不生效导致内容溢出 */
  const popoverPopupStyle: CSSProperties = {
    maxWidth: "min(100vw - 2rem, 28rem)",
    maxHeight: "min(70vh, 28rem)",
    overflowY: "auto",
    overflowX: "auto",
    overscrollBehavior: "contain",
    boxSizing: "border-box",
    padding: 0,
    WebkitOverflowScrolling: "touch",
  };

  return (
    <Popover
      trigger="hover"
      position="top"
      triggerProps={{ popupStyle: popoverPopupStyle }}
      content={
        <div className="box-border min-w-0 max-w-full p-3">
          <Markdown
            className={cn(
              "min-w-0 max-w-full text-xs leading-5 text-neutral-800 [overflow-wrap:anywhere] [word-break:break-word]",
              "[&>div]:min-w-0",
              "[&_p]:my-0 [&_p]:min-w-0 [&_p]:max-w-full [&_p]:whitespace-pre-wrap [&_p]:break-words [&_p+*]:mt-2",
              "[&_ul]:my-2 [&_ol]:my-2 [&_li]:min-w-0 [&_li]:max-w-full [&_li]:break-words [&_li]:leading-5",
              "[&_blockquote]:min-w-0 [&_blockquote]:max-w-full [&_blockquote]:break-words",
              "[&_table]:block [&_table]:w-max [&_table]:max-w-none",
              "[&_pre]:my-2 [&_pre]:min-w-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-neutral-200",
              "[&_code]:break-words",
            )}
            components={threadMessagePopoverMarkdownComponents}
          >
            {full}
          </Markdown>
        </div>
      }
    >
      <span className="block min-w-0 cursor-pointer select-text" data-row-click-stop>
        {body}
      </span>
    </Popover>
  );
}

export function ThreadsOpikTable({
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
  emptyBody,
  hiddenOptional,
  showColumnManager = true,
}: {
  rows: ThreadRecordRow[];
  sortKey: ObserveListSortParam;
  listOrder: "asc" | "desc";
  onColumnSort: (sort: ObserveListSortParam, order: "asc" | "desc") => void;
  onRowClick?: (row: ThreadRecordRow) => void;
  channelFilter?: string;
  channelOptions?: string[];
  onChannelFilterChange?: (next: string) => void;
  agentFilter?: string;
  agentOptions?: string[];
  onAgentFilterChange?: (next: string) => void;
  emptyBody?: ReactNode;
  hiddenOptional?: Set<string>;
  showColumnManager?: boolean;
}) {
  const t = useTranslations("Traces");

  const { hiddenOptional: localHiddenOptional, toggleOptional, resetOptional } = useObserveTableColumnVisibility(
    OBSERVE_THREADS_TABLE_ID,
    THREADS_OPTIONAL_KEYS,
  );
  const effectiveHiddenOptional = hiddenOptional ?? localHiddenOptional;

  const columnManagerItems = useMemo(
    () => [
      { key: "thread_id", mandatory: true as const, label: t("colTableSessionId") },
      { key: "status", mandatory: true as const, label: t("colStatus") },
      { key: "last_message_preview", mandatory: true as const, label: t("threadsColLatestMessage") },
      { key: "agent_name", label: t("threadsColAgent") },
      { key: "channel_name", label: t("threadsColChannel") },
      { key: "trace_count", label: t("threadsColMessageCount") },
      { key: "total_tokens", label: t("colTotalTokens") },
    ],
    [t],
  );

  const onTableChange = useCallback<NonNullable<TableProps<ThreadRecordRow>["onChange"]>>(
    (_pagination, sorter, _filters, extra) => {
      applyObserveTableSortChange(sorter, extra, onColumnSort, sortKey, listOrder);
    },
    [onColumnSort, sortKey, listOrder],
  );

  const sortedRows = useMemo(
    () =>
      sortObserveRows(
        rows,
        sortKey,
        listOrder,
        (row) => row.first_seen_ms,
        (row) => row.total_tokens,
      ),
    [rows, sortKey, listOrder],
  );

  const allColumns: TableColumnProps<ThreadRecordRow>[] = useMemo(
    () => [
      {
        title: <ObserveTableHeaderLabel>{t("colTableSessionId")}</ObserveTableHeaderLabel>,
        dataIndex: "thread_id",
        key: "thread_id",
        fixed: "left",
        width: 260,
        render: (_, row) => <ThreadIdCell row={row} />,
      },
      {
        title: <ObserveTableHeaderLabel>{t("colStatus")}</ObserveTableHeaderLabel>,
        dataIndex: "status",
        key: "status",
        render: (_, row) => {
          const statusBand = traceListStatusBandFromApiStatus(row.status ?? null);
          return row.status ? (
            <span
              className={cn(
                "inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
                statusBandPillClass(statusBand),
              )}
            >
              {statusBandLabel(statusBand, row.status ?? "", t)}
            </span>
          ) : (
            <EmptyDash />
          );
        },
      },
      {
        title: onAgentFilterChange ? (
          <ObserveFacetColumnFilter
            label={t("threadsColAgent")}
            value={agentFilter}
            options={agentOptions}
            onChange={onAgentFilterChange}
            ariaLabelKey="agentColumnFilterAria"
          />
        ) : (
          <ObserveTableHeaderLabel>{t("threadsColAgent")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "agent_name",
        key: "agent_name",
        render: (_, row) => <TruncatedTextCell text={row.agent_name} />,
      },
      {
        title: onChannelFilterChange ? (
          <ObserveFacetColumnFilter
            label={t("threadsColChannel")}
            value={channelFilter}
            options={channelOptions}
            onChange={onChannelFilterChange}
            ariaLabelKey="channelColumnFilterAria"
          />
        ) : (
          <ObserveTableHeaderLabel>{t("threadsColChannel")}</ObserveTableHeaderLabel>
        ),
        dataIndex: "channel_name",
        key: "channel_name",
        render: (_, row) => <TruncatedTextCell text={row.channel_name} />,
      },
      {
        title: <ObserveTableHeaderLabel>{t("threadsColLatestMessage")}</ObserveTableHeaderLabel>,
        dataIndex: "last_message_preview",
        key: "last_message_preview",
        width: 320,
        render: (_, row) => (
          <div className="flex min-w-0 w-[20rem] max-w-full flex-col gap-0.5">
            <ThreadMessageCell
              raw={row.latest_input_preview ?? row.last_message_preview}
              ariaLabel={t("threadsLastMessageFullAria")}
              extractText={extractThreadListMessageText}
              previewLineClamp={1}
            />
            <span className="inline-flex min-w-0 items-center gap-1 text-[10px] leading-4 text-neutral-500 tabular-nums">
              <IconClockCircle className="size-3 shrink-0 text-neutral-400" aria-hidden />
              {formatTraceDateTimeFromMs(row.last_message_created_at_ms ?? null)}
            </span>
          </div>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("threadsColMessageCount")}</ObserveTableHeaderLabel>,
        dataIndex: "trace_count",
        key: "trace_count",
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-700">
            {row.trace_count.toLocaleString()}
          </span>
        ),
      },
      {
        title: <ObserveTableHeaderLabel>{t("colTotalTokens")}</ObserveTableHeaderLabel>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        sorter: (a, b) => (a.total_tokens ?? 0) - (b.total_tokens ?? 0),
        sortOrder: observeColumnSortOrder("total_tokens", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-800">
            {row.total_tokens > 0 ? row.total_tokens.toLocaleString() : "—"}
          </span>
        ),
      },
    ],
    [
      t,
      agentFilter,
      agentOptions,
      channelFilter,
      channelOptions,
      listOrder,
      onAgentFilterChange,
      onChannelFilterChange,
      sortKey,
    ],
  );

  const columns = useMemo(
    () =>
      allColumns.filter((column) => {
        const key = String(column.key);
        if (THREADS_COLUMN_MANDATORY.has(key)) {
          return true;
        }
        return !effectiveHiddenOptional.has(key);
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
          <Table<ThreadRecordRow>
            tableLayoutFixed
            size="small"
            border={{ wrapper: false, cell: false, headerCell: false, bodyCell: false }}
            columns={columns}
            data={sortedRows}
            rowKey={(row) => threadRowStableId(row)}
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
