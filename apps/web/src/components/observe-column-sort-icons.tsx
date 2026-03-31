"use client";

import { IconArrowUp, IconArrowDown } from "@arco-design/web-react/icon";
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
        <IconArrowUp className={`size-3.5 ${ascEmph ? emph : muted}`} />
        <IconArrowDown className={`-ml-1.5 size-3.5 ${descEmph ? emph : muted}`} />
      </span>
    </Button>
  );
}
