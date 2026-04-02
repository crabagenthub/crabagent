"use client";

import { IconRefresh, IconSearch } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ObserveDateRangeTrigger } from "@/components/observe-date-range-trigger";
import type { ObserveDateRange } from "@/lib/observe-date-range";

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
  /** 紧挨搜索框：筛选 Popover 等 */
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
      <div className="flex flex-wrap items-center gap-2 gap-y-3 xl:flex-nowrap">
        {toolbarTop ? <div className="min-w-0 shrink-0 max-sm:w-full">{toolbarTop}</div> : null}
        <div className="flex min-w-[min(100%,18rem)] max-w-[min(80rem,94vw)] shrink flex-1 basis-[min(100%,44rem)] items-center gap-2 sm:min-w-[22rem] md:basis-[min(100%,48rem)] lg:max-w-[min(88rem,94vw)]">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60">
              <IconSearch className="h-4 w-4" aria-hidden />
            </span>
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-lg border border-input bg-muted/50 py-2 pl-9 pr-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              autoComplete="off"
            />
          </div>
          {filtersSlot ? <div className="shrink-0">{filtersSlot}</div> : null}
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
          <ObserveDateRangeTrigger value={dateRange} onChange={onDateRangeChange} />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            disabled={isFetching}
            onClick={() => onRefresh()}
            title={t("refreshList")}
            aria-label={t("refreshList")}
            aria-busy={isFetching}
            className={cn(isFetching && "disabled:!opacity-100")}
          >
            <IconRefresh
              className={cn(
                "h-4 w-4 origin-center will-change-transform",
                isFetching && "motion-reduce:animate-none motion-reduce:opacity-80 animate-spin",
              )}
              aria-hidden
            />
          </Button>
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
