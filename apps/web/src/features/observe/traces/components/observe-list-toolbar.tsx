"use client";

import { IconRefresh, IconSearch } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import { ObserveDateRangeTrigger } from "@/shared/components/observe-date-range-trigger";
import type { ObserveDateRange } from "@/lib/observe-date-range";
import {
  OBSERVE_CONTROL_OUTLINE_CLASSNAME,
  OBSERVE_TOOLBAR_HOVER_FG_ICO,
  OBSERVE_TOOLBAR_HOVER_FG_SCH,
} from "@/lib/observe-table-style";

export type { ObserveDateRange, ObserveDatePreset } from "@/lib/observe-date-range";

type Props = {
  /** 过滤卡片最上方（如实体切换 Toggle Group） */
  toolbarTop?: ReactNode;
  searchDraft: string;
  setSearchDraft: (v: string) => void;
  searchPlaceholder: string;
  dateRange: ObserveDateRange;
  onDateRangeChange: (v: ObserveDateRange) => void;
  onRefresh: () => void;
  isFetching: boolean;
  searchActive: boolean;
  onClearSearch: () => void;
  /** 时间选择右侧：列管理等 */
  filtersSlot?: ReactNode;
};

export function ObserveListToolbar({
  toolbarTop,
  searchDraft,
  setSearchDraft,
  searchPlaceholder,
  dateRange,
  onDateRangeChange,
  onRefresh,
  isFetching,
  searchActive,
  onClearSearch,
  filtersSlot,
}: Props) {
  const t = useTranslations("Traces");

  return (
    <section className="mb-4 space-y-3">
      {toolbarTop ? <div className="min-w-0 w-full">{toolbarTop}</div> : null}
      <div className="rounded-xl border border-neutral-200/90 bg-neutral-50/40 p-2 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900/25 sm:p-2.5">
        <div className="flex flex-wrap items-center gap-2 gap-y-3 xl:flex-nowrap">
          <div className="flex min-w-[min(100%,18rem)] max-w-[min(80rem,94vw)] shrink flex-1 basis-[min(100%,44rem)] items-center gap-2 sm:min-w-[22rem] md:basis-[min(100%,48rem)] lg:max-w-[min(88rem,94vw)]">
            <div className="group/sch relative min-w-[12rem] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2">
                <IconSearch
                  className={cn(
                    "h-4 w-4 text-neutral-500 transition-colors duration-150 dark:text-zinc-500",
                    OBSERVE_TOOLBAR_HOVER_FG_SCH,
                    "group-focus-within/sch:text-neutral-950 dark:group-focus-within/sch:text-zinc-50",
                  )}
                  aria-hidden
                />
              </span>
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={searchPlaceholder}
                className={cn(
                  "h-9 w-full rounded-md border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-800 shadow-sm outline-none transition-[color,box-shadow,border-color] placeholder:text-neutral-400 focus-visible:border-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-300/60 dark:border-zinc-600 dark:bg-zinc-950/50 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus-visible:border-zinc-500 dark:focus-visible:ring-zinc-600/50",
                  OBSERVE_TOOLBAR_HOVER_FG_SCH,
                  "group-hover/sch:placeholder:text-neutral-500 dark:group-hover/sch:placeholder:text-zinc-500",
                )}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
            <ObserveDateRangeTrigger value={dateRange} onChange={onDateRangeChange} />
            {filtersSlot ? <div className="flex shrink-0 items-center">{filtersSlot}</div> : null}
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              disabled={isFetching}
              onClick={() => onRefresh()}
              title={t("refreshList")}
              aria-label={t("refreshList")}
              aria-busy={isFetching}
              className={cn(
                "group/ico rounded-md bg-white shadow-sm dark:bg-zinc-950/50",
                OBSERVE_CONTROL_OUTLINE_CLASSNAME,
                isFetching && "disabled:!opacity-100",
              )}
            >
              <IconRefresh
                className={cn(
                  "h-4 w-4 origin-center text-neutral-500 transition-colors duration-150 dark:text-zinc-400",
                  OBSERVE_TOOLBAR_HOVER_FG_ICO,
                  "will-change-transform",
                  isFetching && "motion-reduce:animate-none motion-reduce:opacity-80 animate-spin",
                )}
                aria-hidden
              />
            </Button>
          </div>
        </div>
      </div>
      {searchActive ? (
        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => onClearSearch()}
            className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            {t("filterClearSearch")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
