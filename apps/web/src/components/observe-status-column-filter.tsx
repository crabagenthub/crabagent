"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OBSERVE_LIST_STATUS_OPTIONS, type ObserveListStatusParam } from "@/lib/observe-facets";
import { cn } from "@/lib/utils";

type Props = {
  /** 表头文案，如「状态」 */
  label: string;
  value: ObserveListStatusParam | "";
  onChange: (next: ObserveListStatusParam | "") => void;
};

export function ObserveStatusColumnFilter({ label, value, onChange }: Props) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(false);

  const statusLabel = (s: ObserveListStatusParam) =>
    s === "running"
      ? t("filterStatusRunning")
      : s === "success"
        ? t("filterStatusSuccess")
        : s === "error"
          ? t("filterStatusError")
          : t("filterStatusTimeout");

  const pick = (next: ObserveListStatusParam | "") => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                value ? "text-primary" : "text-neutral-500",
              )}
              aria-label={t("statusColumnFilterAria")}
              aria-expanded={open}
            />
          }
        >
          <Filter className="size-3.5" strokeWidth={2} aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-auto min-w-[9rem] p-1 shadow-md">
          <ul className="m-0 list-none p-0">
            <li>
              <button
                type="button"
                onClick={() => pick("")}
                className={cn(
                  "flex w-full rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80",
                  !value ? "font-medium text-primary" : "text-foreground",
                )}
              >
                {t("filterAll")}
              </button>
            </li>
            {OBSERVE_LIST_STATUS_OPTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className={cn(
                    "flex w-full rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80",
                    value === s ? "font-medium text-primary" : "text-foreground",
                  )}
                >
                  {statusLabel(s)}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
