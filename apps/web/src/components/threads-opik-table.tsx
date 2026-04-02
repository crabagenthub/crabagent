"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps, TableProps } from "@arco-design/web-react";
import { Table } from "@arco-design/web-react";
import { IconCopy } from "@arco-design/web-react/icon";
import type { KeyboardEvent, ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover } from "@arco-design/web-react";
import type { ObserveListSortParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_CLASSNAME, OBSERVE_TABLE_FRAME_CLASSNAME } from "@/lib/observe-table-style";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import {
  statusBandLabel,
  statusBandPillClass,
  traceListStatusBandFromApiStatus,
} from "@/lib/trace-records";
import { extractThreadListMessageText } from "@/lib/strip-inbound-meta";
import { threadRowStableId, type ThreadRecordRow } from "@/lib/thread-records";
import { cn, formatShortId } from "@/lib/utils";

const TABLE_MIN_WIDTH = 1820;

export const OBSERVE_THREADS_TABLE_ID = "observe-threads";

const THREADS_COLUMN_MANDATORY = new Set(["thread_id", "status", "last_message_preview"]);

export const THREADS_OPTIONAL_KEYS: readonly string[] = [
  "agent_name",
  "channel_name",
  "trace_count",
  "total_tokens",
  "total_cost",
];

const headerCellClass =
  "inline-flex items-center whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-600";

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

function HeaderLabel({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={headerCellClass} title={title}>
      {children}
    </span>
  );
}

function TruncatedTextCell({ text, widthClass, className }: { text: string | null | undefined; widthClass: string; className?: string }) {
  const value = (text ?? "").trim();
  if (!value) {
    return <EmptyDash />;
  }
  return (
    <span
      className={cn(
        "block min-w-0 truncate whitespace-nowrap text-xs text-neutral-800",
        widthClass,
        className,
      )}
    >
      {value}
    </span>
  );
}

function ThreadIdCell({ threadId }: { threadId: string }) {
  const t = useTranslations("Traces");

  if (!threadId.trim()) {
    return <EmptyDash />;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="block min-w-0 truncate whitespace-nowrap text-xs text-neutral-800" title={threadId}>
        {formatShortId(threadId)}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={(triggerProps) => (
            <Button
              {...triggerProps}
              type="button"
              variant="ghost"
              size="icon-sm"
              data-row-click-stop
              className="shrink-0 p-1 text-neutral-800 hover:bg-neutral-100 hover:text-neutral-800"
              onClick={async (e) => {
                e.stopPropagation();
                triggerProps.onClick?.(e);
                try {
                  await navigator.clipboard.writeText(threadId);
                  toast.success(t("copied"));
                } catch {
                  // ignore clipboard failures
                }
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                triggerProps.onKeyDown?.(e);
              }}
              aria-label={t("threadDrawerCopyThreadId")}
            >
              <IconCopy className="size-3.5 text-neutral-800" />
            </Button>
          )}
        />
        <TooltipContent>{t("copy")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ThreadMessageCell({
  raw,
  ariaLabel,
  extractText,
}: {
  raw: string | null | undefined;
  ariaLabel: string;
  extractText: (raw: string | null | undefined) => string;
}) {
  const full = extractText(raw).trim();
  if (!full) {
    return <EmptyDash />;
  }

  const normalized = full.replace(/\s+/g, " ").trim();
  const needsPopover = full.includes("\n") || normalized.length > 72;

  const body = (
    <span
      aria-label={ariaLabel}
      className="block min-w-0 whitespace-normal break-words text-xs leading-5 text-neutral-800"
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
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

  return (
    <Popover
      trigger="hover"
      position="top"
      triggerProps={{ popupStyle: { maxWidth: "min(100vw - 2rem, 28rem)", boxSizing: "border-box" } }}
      content={
        <div className="box-border w-[min(100vw-2rem,28rem)] max-w-[min(100vw-2rem,28rem)] min-w-0 overflow-hidden p-3">
          <div className="max-h-[min(70vh,28rem)] min-w-0 max-w-full overflow-x-auto overflow-y-auto overscroll-x-contain overscroll-y-auto touch-pan-x touch-pan-y [scrollbar-gutter:stable]">
            <Markdown
              className={cn(
                "min-w-0 max-w-full text-xs leading-5 text-neutral-800 [overflow-wrap:anywhere] [word-break:break-word]",
                "[&>div]:min-w-0",
                "[&_p]:my-0 [&_p]:min-w-0 [&_p]:max-w-full [&_p]:whitespace-pre-wrap [&_p]:break-words [&_p+*]:mt-2",
                "[&_ul]:my-2 [&_ol]:my-2 [&_li]:min-w-0 [&_li]:max-w-full [&_li]:break-words [&_li]:leading-5",
                "[&_blockquote]:min-w-0 [&_blockquote]:max-w-full [&_blockquote]:break-words",
                "[&_table]:block [&_table]:w-max [&_table]:max-w-none",
                "[&_pre]:my-2 [&_pre]:min-w-0 [&_pre]:border [&_pre]:border-neutral-200",
                "[&_code]:break-words",
              )}
              components={threadMessagePopoverMarkdownComponents}
            >
              {full}
            </Markdown>
          </div>
        </div>
      }
    >
      <span className="block min-w-0 cursor-pointer">{body}</span>
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
      { key: "total_cost", label: t("colEstCost") },
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
        title: <HeaderLabel>{t("colTableSessionId")}</HeaderLabel>,
        dataIndex: "thread_id",
        key: "thread_id",
        width: 220,
        render: (_, row) => <ThreadIdCell threadId={row.thread_id} />,
      },
      {
        title: <HeaderLabel>{t("colStatus")}</HeaderLabel>,
        dataIndex: "status",
        key: "status",
        width: 128,
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
          <HeaderLabel>{t("threadsColAgent")}</HeaderLabel>
        ),
        dataIndex: "agent_name",
        key: "agent_name",
        width: 160,
        render: (_, row) => <TruncatedTextCell text={row.agent_name} widthClass="max-w-[8.5rem]" />,
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
          <HeaderLabel>{t("threadsColChannel")}</HeaderLabel>
        ),
        dataIndex: "channel_name",
        key: "channel_name",
        width: 160,
        render: (_, row) => <TruncatedTextCell text={row.channel_name} widthClass="max-w-[8.5rem]" />,
      },
      {
        title: <HeaderLabel>{t("threadsColLatestMessage")}</HeaderLabel>,
        dataIndex: "last_message_preview",
        key: "last_message_preview",
        width: 360,
        render: (_, row) => (
          <div className="min-w-0">
            <ThreadMessageCell
              raw={row.latest_input_preview ?? row.last_message_preview}
              ariaLabel={t("threadsLastMessageFullAria")}
              extractText={extractThreadListMessageText}
            />
          </div>
        ),
      },
      {
        title: <HeaderLabel>{t("threadsColMessageCount")}</HeaderLabel>,
        dataIndex: "trace_count",
        key: "trace_count",
        width: 120,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-700">
            {row.trace_count.toLocaleString()}
          </span>
        ),
      },
      {
        title: <HeaderLabel>{t("colTotalTokens")}</HeaderLabel>,
        dataIndex: "total_tokens",
        key: "total_tokens",
        width: 144,
        sorter: (a, b) => (a.total_tokens ?? 0) - (b.total_tokens ?? 0),
        sortOrder: observeColumnSortOrder("total_tokens", sortKey, listOrder),
        sortDirections: ["descend", "ascend"],
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-800">
            {row.total_tokens > 0 ? row.total_tokens.toLocaleString() : "—"}
          </span>
        ),
      },
      {
        title: <HeaderLabel title={t("threadsCostHint")}>{t("colEstCost")}</HeaderLabel>,
        dataIndex: "total_cost",
        key: "total_cost",
        width: 136,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-600">
            {row.total_cost != null && Number.isFinite(row.total_cost) ? row.total_cost.toFixed(4) : "—"}
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
        scrollClassName="touch-pan-x overscroll-x-contain"
      >
        <div style={{ minWidth: TABLE_MIN_WIDTH }}>
          <Table<ThreadRecordRow>
            className={cn(
              OBSERVE_TABLE_CLASSNAME,
              "[&_.arco-table-th]:whitespace-nowrap [&_.arco-table-td]:align-top [&_.arco-table-cell]:min-w-0 [&_.arco-table-th-item]:whitespace-nowrap",
            )}
            size="small"
            border={false}
            columns={columns}
            data={sortedRows}
            rowKey={(row) => threadRowStableId(row)}
            pagination={false}
            tableLayoutFixed
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
