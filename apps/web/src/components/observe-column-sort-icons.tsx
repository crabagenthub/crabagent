"use client";

import { Button } from "@/components/ui/button";
import type { ObserveListSortParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_SORT_BUTTON_CLASSNAME } from "@/lib/observe-table-control-style";

type Props = {
  dimension: ObserveListSortParam;
  sortKey: ObserveListSortParam;
  listOrder: "asc" | "desc";
  onSort: (dimension: ObserveListSortParam, order: "asc" | "desc") => void;
  ascLabel: string;
  descLabel: string;
};

export function ObserveColumnSortIcons({
  dimension,
  sortKey,
  listOrder,
  onSort,
  ascLabel,
  descLabel,
}: Props) {
  const active = sortKey === dimension;
  const ascEmph = active && listOrder === "asc";
  const descEmph = active && listOrder === "desc";
  const muted = "text-neutral-400";
  const emph = "text-primary";

  const onClick = () => {
    if (sortKey !== dimension) {
      onSort(dimension, "desc");
      return;
    }
    onSort(dimension, listOrder === "desc" ? "asc" : "desc");
  };

  const ariaLabel =
    sortKey === dimension ? (listOrder === "asc" ? ascLabel : descLabel) : `${ascLabel}. ${descLabel}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={ariaLabel}
      className={OBSERVE_TABLE_SORT_BUTTON_CLASSNAME}
    >
      <span className="inline-flex items-center gap-0" aria-hidden>
        <svg
          className={`size-3.5 ${ascEmph ? emph : muted}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 5v14M8 9l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg
          className={`-ml-1.5 size-3.5 ${descEmph ? emph : muted}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 19V5M8 15l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Button>
  );
}
