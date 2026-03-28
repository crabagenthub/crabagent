"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  ariaLabelKey: "channelColumnFilterAria" | "agentColumnFilterAria";
};

/** Funnel + popover list, same interaction as {@link ObserveStatusColumnFilter}. */
export function ObserveFacetColumnFilter({ label, value, options, onChange, ariaLabelKey }: Props) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(false);
  const applied = value.trim();

  const pick = (next: string) => {
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
                applied ? "text-primary" : "text-neutral-500",
              )}
              aria-label={t(ariaLabelKey)}
              aria-expanded={open}
            />
          }
        >
          <Filter className="size-3.5" strokeWidth={2} aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="max-h-[min(24rem,70vh)] w-auto min-w-[10rem] max-w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto p-1 shadow-md"
        >
          <ul className="m-0 list-none p-0">
            <li>
              <button
                type="button"
                onClick={() => pick("")}
                className={cn(
                  "flex w-full rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80",
                  !applied ? "font-medium text-primary" : "text-foreground",
                )}
              >
                {t("filterAll")}
              </button>
            </li>
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => pick(opt)}
                  className={cn(
                    "flex w-full rounded-sm px-3 py-2 text-left text-sm break-words transition-colors hover:bg-muted/80",
                    applied === opt ? "font-medium text-primary" : "text-foreground",
                  )}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
