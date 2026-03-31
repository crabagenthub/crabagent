"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ObserveListKind = "threads" | "traces" | "spans";

export type ObserveListKindOption = {
  id: ObserveListKind;
  label: string;
};

type Props = {
  value: ObserveListKind;
  onChange: (kind: ObserveListKind) => void;
  options: ObserveListKindOption[];
  className?: string;
  "aria-label": string;
};

export function ObserveListKindSwitcher({ value, onChange, options, className, "aria-label": ariaLabel }: Props) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex w-full sm:w-auto", className)}>
      <div className="flex w-full rounded-full bg-neutral-100 p-1 dark:bg-neutral-800/70 sm:inline-flex sm:w-auto">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <Button
              key={opt.id}
              type="button"
              variant={selected ? "default" : "ghost"}
              size="sm"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.id)}
              className={cn(
                "min-h-9 flex-1 rounded-full px-3 py-1.5 text-sm font-medium sm:flex-initial sm:px-4",
                selected
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-50 dark:shadow-black/20"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
              )}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
