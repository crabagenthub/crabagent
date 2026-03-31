"use client";

import "@/lib/arco-react19-setup";
import type { TableColumnProps } from "@arco-design/web-react";
import { Table } from "@arco-design/web-react";
import { IconCopy } from "@arco-design/web-react/icon";
import type { KeyboardEvent, ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ObserveColumnSortIcons } from "@/components/observe-column-sort-icons";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ObserveListSortParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_COMPACT_CLASSNAME, OBSERVE_TABLE_FRAME_CLASSNAME } from "@/lib/observe-table-style";
import { shouldIgnoreRowClick } from "@/lib/table-row-click-guard";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import {
  formatDurationMs,
  statusBandLabel,
  statusBandPillClass,
  traceListStatusBandFromApiStatus,
} from "@/lib/trace-records";
import { extractThreadListLastMessageText, extractThreadListMessageText } from "@/lib/strip-inbound-meta";
import { threadRowStableId, type ThreadRecordRow } from "@/lib/thread-records";
import { cn, formatShortId } from "@/lib/utils";

function clipOneLine(s: string | null | undefined, max: number): string {
  const raw = (s ?? "").trim().replace(/\s+/g, " ");
  if (!raw.length) {
    return "";
  }
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

const lastMessageBadgeCls =
  "h-auto min-h-5 max-w-full min-w-0 border-transparent bg-blue-50 py-0.5 font-normal text-blue-700 dark:bg-blue-950 dark:text-blue-300";

const headerCellClass =
  "text-xs font-semibold uppercase tracking-wide text-neutral-600 [&_.arco-table-th-item]:text-neutral-600";

function ThreadIdCell({ threadId }: { threadId: string }) {
  const t = useTranslations("Traces");

  if (!threadId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
       <span className="block truncate whitespace-nowrap text-xs text-neutral-800" title={threadId}>
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
              className="shrink-0 p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              onClick={async (e) => {
                e.stopPropagation();
                triggerProps.onClick?.(e);
                try {
                  await navigator.clipboard.writeText(threadId);
                  toast.success(t("copied"));
                } catch {
                  // ignore
                }
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                triggerProps.onKeyDown?.(e);
              }}
              aria-label={t("threadDrawerCopyThreadId")}
            >
              <IconCopy className="size-3.5" />
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
  asLastMessageBadge = false,
}: {
  raw: string | null | undefined;
  ariaLabel: string;
  extractText: (raw: string | null | undefined) => string;
  asLastMessageBadge?: boolean;
}) {
  const full = extractText(raw).trim();
  const spanRef = useRef<HTMLSpanElement>(null);
  const [layoutClipped, setLayoutClipped] = useState(false);

  const oneLine = full ? clipOneLine(full, 200) : "";
  const multiline = full ? full.includes("\n") : false;
  const logicClipped = full ? oneLine.endsWith("…") || full.length > 200 : false;
  const longChars = full ? full.length > 56 : false;
  const lastMessageAlwaysPreview = Boolean(full && asLastMessageBadge);
  const obviousHover = Boolean(full && (multiline || logicClipped || longChars || lastMessageAlwaysPreview));

  useLayoutEffect(() => {
    if (!full) {
      setLayoutClipped(false);
      return;
    }
    if (obviousHover) {
      setLayoutClipped(false);
      return;
    }
    const el = spanRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      setLayoutClipped(el.scrollWidth > el.clientWidth + 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, obviousHover, oneLine]);

  const needsHoverPreview = Boolean(full && (obviousHover || layoutClipped));

  if (!full) {
    return <span className="text-neutral-400">—</span>;
  }

  const preview = (
    <span
      ref={spanRef}
      className={cn(
        "block max-w-full min-w-0 truncate whitespace-nowrap text-xs",
        asLastMessageBadge ? "text-inherit" : "text-neutral-800",
      )}
    >
      {oneLine}
    </span>
  );

  const wrapBadge = (node: ReactNode) =>
    asLastMessageBadge ? <Badge className={lastMessageBadgeCls}>{node}</Badge> : node;

  if (!needsHoverPreview) {
    return wrapBadge(<div className="max-w-[8rem] min-w-0">{preview}</div>);
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={ariaLabel}
            className={cn(
              "inline-flex max-w-[8rem] min-w-0 w-full cursor-default rounded-md border border-transparent bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              asLastMessageBadge ? "hover:opacity-90" : "hover:bg-neutral-50/80",
            )}
          >
            {wrapBadge(<div className="min-w-0 max-w-full">{preview}</div>)}
          </span>
        }
      />
      <TooltipContent side="top" className="w-[min(100vw-1rem,20rem)] max-w-[min(100vw-1rem,20rem)]">
        <p className="m-0 max-h-[min(70vh,28rem)] overflow-y-auto whitespace-pre-wrap break-words text-xs text-neutral-800">
          {full}
        </p>
      </TooltipContent>
    </Tooltip>
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
}) {
  const t = useTranslations("Traces");

  const columns: TableColumnProps<ThreadRecordRow>[] = useMemo(
    () => [
      {
        title: <span className={headerCellClass}>{t("colTableSessionId")}</span>,
        dataIndex: "thread_id",
        key: "thread_id",
        width: 108,
        render: (_, row) => <ThreadIdCell threadId={row.thread_id} />,
      },
      {
        title: <span className={headerCellClass}>{t("colStatus")}</span>,
        dataIndex: "status",
        key: "status",
        width: 58,
        render: (_, row) => {
          const statusBand = traceListStatusBandFromApiStatus(row.status ?? null);
          return row.status ? (
            <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium leading-tight ${statusBandPillClass(statusBand)}`}>
              {statusBandLabel(statusBand, row.status ?? "", t)}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          );
        },
      },
      {
        title: (
          <span className={headerCellClass}>
            <div className="flex flex-nowrap items-center gap-1">
              <span className="whitespace-nowrap">{t("colStartTime")}</span>
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
        dataIndex: "first_seen_ms",
        key: "first_seen_ms",
        width: 118,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs text-neutral-700">
            {formatTraceDateTimeFromMs(row.first_seen_ms)}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
            {onAgentFilterChange ? (
              <ObserveFacetColumnFilter
                label={t("threadsColAgent")}
                value={agentFilter}
                options={agentOptions}
                onChange={onAgentFilterChange}
                ariaLabelKey="agentColumnFilterAria"
              />
            ) : (
              t("threadsColAgent")
            )}
          </span>
        ),
        dataIndex: "agent_name",
        key: "agent_name",
        width: 84,
        render: (_, row) =>
          row.agent_name ? (
            <span className="block truncate whitespace-nowrap text-xs text-neutral-800" title={row.agent_name}>
              {row.agent_name}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          ),
      },
      {
        title: (
          <span className={headerCellClass}>
            {onChannelFilterChange ? (
              <ObserveFacetColumnFilter
                label={t("threadsColChannel")}
                value={channelFilter}
                options={channelOptions}
                onChange={onChannelFilterChange}
                ariaLabelKey="channelColumnFilterAria"
              />
            ) : (
              t("threadsColChannel")
            )}
          </span>
        ),
        dataIndex: "channel_name",
        key: "channel_name",
        width: 72,
        render: (_, row) =>
          row.channel_name ? (
            <span className="block truncate whitespace-nowrap text-xs text-neutral-800" title={row.channel_name}>
              {row.channel_name}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          ),
      },
      {
        title: <span className={headerCellClass}>{t("threadsColFirstMessage")}</span>,
        dataIndex: "first_message_preview",
        key: "first_message_preview",
        width: 108,
        render: (_, row) => (
          <ThreadMessageCell
            raw={row.first_message_preview}
            ariaLabel={t("threadsFirstMessageFullAria")}
            extractText={extractThreadListMessageText}
          />
        ),
      },
      {
        title: <span className={headerCellClass}>{t("threadsColLastMessage")}</span>,
        dataIndex: "last_message_preview",
        key: "last_message_preview",
        width: 108,
        render: (_, row) => (
          <ThreadMessageCell
            raw={row.last_message_preview}
            ariaLabel={t("threadsLastMessageFullAria")}
            extractText={extractThreadListLastMessageText}
            asLastMessageBadge
          />
        ),
      },
      {
        title: <span className={headerCellClass}>{t("threadsColMessageCount")}</span>,
        dataIndex: "trace_count",
        key: "trace_count",
        width: 48,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-700">{row.trace_count}</span>
        ),
      },
      {
        title: <span className={headerCellClass}>{t("colDuration")}</span>,
        dataIndex: "duration_ms",
        key: "duration_ms",
        width: 56,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-800">
            {row.duration_ms != null && row.duration_ms > 0 ? formatDurationMs(row.duration_ms) : "—"}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass}>
            <div className="flex flex-nowrap items-center gap-1">
              <span className="whitespace-nowrap">{t("colTotalTokens")}</span>
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
        width: 72,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-800">
            {row.total_tokens > 0 ? row.total_tokens.toLocaleString() : "—"}
          </span>
        ),
      },
      {
        title: (
          <span className={headerCellClass} title={t("threadsCostHint")}>
            {t("colEstCost")}
          </span>
        ),
        dataIndex: "total_cost",
        key: "total_cost",
        width: 64,
        render: (_, row) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-neutral-600">
            {row.total_cost != null && Number.isFinite(row.total_cost) ? row.total_cost.toFixed(4) : "—"}
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
    ],
  );

  return (
    <div className={OBSERVE_TABLE_FRAME_CLASSNAME}>
      <ScrollableTableFrame variant="neutral" contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}>
        <div className="min-w-[900px]">
          <Table<ThreadRecordRow>
            className={OBSERVE_TABLE_COMPACT_CLASSNAME}
            size="small"
            border={false}
            columns={columns}
            data={rows}
            rowKey={(row) => threadRowStableId(row)}
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
