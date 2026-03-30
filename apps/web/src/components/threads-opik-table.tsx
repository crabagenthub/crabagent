"use client";

import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { ObserveColumnSortIcons } from "@/components/observe-column-sort-icons";
import { ObserveFacetColumnFilter } from "@/components/observe-facet-column-filter";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ObserveListSortParam } from "@/lib/observe-facets";
import { ScrollableTableFrame } from "@/components/scrollable-table-frame";
import { formatTraceDateTimeFromMs } from "@/lib/trace-datetime";
import {
  formatDurationMs,
  statusBandLabel,
  statusBandPillClass,
  traceListStatusBandFromApiStatus,
} from "@/lib/trace-records";
import { extractThreadListLastMessageText, extractThreadListMessageText } from "@/lib/strip-inbound-meta";
import { threadRowStableId, type ThreadRecordRow } from "@/lib/thread-records";
import { toast } from "sonner";

function clipOneLine(s: string | null | undefined, max: number): string {
  const raw = (s ?? "").trim().replace(/\s+/g, " ");
  if (!raw.length) {
    return "";
  }
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

const lastMessageBadgeCls =
  "h-auto min-h-5 max-w-full min-w-0 border-transparent bg-blue-50 py-0.5 font-mono font-normal text-blue-700 dark:bg-blue-950 dark:text-blue-300";

function ThreadIdCell({ threadId }: { threadId: string }) {
  const t = useTranslations("Traces");

  if (!threadId.trim()) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="block min-w-0 truncate" title={threadId}>
        {threadId}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              className="inline-flex shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
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
              <Copy className="size-3.5" strokeWidth={2} />
            </button>
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
  /** 末消息列：用蓝色 Badge 展示预览文案 */
  asLastMessageBadge?: boolean;
}) {
  const full = extractText(raw).trim();
  const spanRef = useRef<HTMLSpanElement>(null);
  const [layoutClipped, setLayoutClipped] = useState(false);

  const oneLine = full ? clipOneLine(full, 200) : "";
  const multiline = full ? full.includes("\n") : false;
  /** 逻辑上被截断（超过 clip 长度，或原文明显偏长） */
  const logicClipped = full ? oneLine.endsWith("…") || full.length > 200 : false;
  const longChars = full ? full.length > 56 : false;
  /** 末消息列：只要非空就提供悬浮全文（避免 JSON 摘要后字数变短、或 Badge 内 Preview Card 不触发） */
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
        "block max-w-full min-w-0 truncate whitespace-nowrap font-mono text-xs",
        asLastMessageBadge ? "text-inherit" : "text-neutral-800",
      )}
    >
      {oneLine}
    </span>
  );

  const wrapBadge = (node: ReactNode) =>
    asLastMessageBadge ? <Badge className={lastMessageBadgeCls}>{node}</Badge> : node;

  if (!needsHoverPreview) {
    return wrapBadge(<div className="max-w-[18rem] min-w-0">{preview}</div>);
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={250}
        closeDelay={220}
        nativeButton={false}
        aria-label={ariaLabel}
        render={
          <span
            className={cn(
              "inline-flex max-w-[18rem] min-w-0 w-full cursor-default rounded-md border border-transparent bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              asLastMessageBadge ? "hover:opacity-90" : "hover:bg-neutral-50/80",
            )}
          />
        }
      >
        {wrapBadge(<div className="min-w-0 max-w-full">{preview}</div>)}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100vw-1rem,20rem)] max-w-[min(100vw-1rem,20rem)] max-h-[min(70vh,28rem)] overflow-y-auto p-3"
      >
        <p className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-neutral-800">{full}</p>
      </PopoverContent>
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

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-neutral-200/90 bg-white">
      <ScrollableTableFrame variant="neutral" contentKey={`${rows.length}:${emptyBody ? 1 : 0}`}>
        <table className="w-max min-w-[1240px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50/95 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              <th className="min-w-[10rem] max-w-[14rem] px-3 py-3 normal-case">{t("colTableSessionId")}</th>
              <th className="min-w-[5.5rem] whitespace-nowrap px-3 py-3">{t("colStatus")}</th>
              <th className="min-w-[9rem] whitespace-nowrap px-3 py-3">
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
              </th>
              <th className="min-w-[6rem] max-w-[10rem] px-3 py-3 normal-case">
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
              </th>
              <th className="min-w-[6rem] max-w-[10rem] px-3 py-3 normal-case">
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
              </th>
              <th className="min-w-[12rem] max-w-[18rem] whitespace-nowrap px-3 py-3">{t("threadsColFirstMessage")}</th>
              <th className="min-w-[12rem] max-w-[18rem] whitespace-nowrap px-3 py-3">{t("threadsColLastMessage")}</th>
              <th className="w-24 whitespace-nowrap px-3 py-3">{t("threadsColMessageCount")}</th>
              <th className="w-28 whitespace-nowrap px-3 py-3">{t("colDuration")}</th>
              <th className="w-32 whitespace-nowrap px-3 py-3">
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
              </th>
              <th className="w-28 whitespace-nowrap px-3 py-3" title={t("threadsCostHint")}>
                {t("colEstCost")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 && emptyBody ? (
              <tr>
                <td colSpan={11} className="border-0 bg-white p-0 align-top">
                  <div className="flex justify-center px-4 py-10">{emptyBody}</div>
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const id = threadRowStableId(row);
              const statusBand = traceListStatusBandFromApiStatus(row.status ?? null);
              return (
                <tr
                  key={id}
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className="cursor-pointer transition-colors hover:bg-neutral-50/80"
                  onClick={
                    onRowClick
                      ? () => {
                          onRowClick(row);
                        }
                      : undefined
                  }
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
                    <ThreadIdCell threadId={row.thread_id} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top">
                    {row.status ? (
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusBandPillClass(statusBand)}`}
                      >
                        {statusBandLabel(statusBand, row.status ?? "", t)}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs text-neutral-700">
                    {formatTraceDateTimeFromMs(row.first_seen_ms)}
                  </td>
                  <td className="max-w-[10rem] min-w-0 px-3 py-2.5 align-top text-xs text-neutral-800">
                    {row.agent_name ? (
                      <span className="block truncate whitespace-nowrap" title={row.agent_name}>
                        {row.agent_name}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="max-w-[10rem] min-w-0 px-3 py-2.5 align-top text-xs text-neutral-800">
                    {row.channel_name ? (
                      <span className="block truncate whitespace-nowrap" title={row.channel_name}>
                        {row.channel_name}
                      </span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="max-w-[18rem] min-w-0 px-3 py-2.5 align-top">
                    <ThreadMessageCell
                      raw={row.first_message_preview}
                      ariaLabel={t("threadsFirstMessageFullAria")}
                      extractText={extractThreadListMessageText}
                    />
                  </td>
                  <td className="max-w-[18rem] min-w-0 px-3 py-2.5 align-top">
                    <ThreadMessageCell
                      raw={row.last_message_preview}
                      ariaLabel={t("threadsLastMessageFullAria")}
                      extractText={extractThreadListLastMessageText}
                      asLastMessageBadge
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-700">
                    {row.trace_count}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-800">
                    {row.duration_ms != null && row.duration_ms > 0 ? formatDurationMs(row.duration_ms) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-800">
                    {row.total_tokens > 0 ? row.total_tokens.toLocaleString() : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs tabular-nums text-neutral-600">
                    {row.total_cost != null && Number.isFinite(row.total_cost) ? row.total_cost.toFixed(4) : "—"}
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
