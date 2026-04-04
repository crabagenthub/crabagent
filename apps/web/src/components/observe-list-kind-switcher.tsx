"use client";

import { IconBranch, IconList, IconMessage } from "@arco-design/web-react/icon";
import type { ComponentType } from "react";

import "@/lib/arco-react19-setup";
import { cn } from "@/lib/utils";

export type ObserveListKind = "threads" | "traces" | "spans";

export type ObserveListKindOption = {
  id: ObserveListKind;
  label: string;
};

type IconProps = { className?: string; strokeWidth?: number };

const KIND_ICONS: Record<ObserveListKind, ComponentType<IconProps>> = {
  threads: IconList,
  traces: IconMessage,
  spans: IconBranch,
};

type Props = {
  value: ObserveListKind;
  onChange: (kind: ObserveListKind) => void;
  options: ObserveListKindOption[];
  /** 各列表总条数；`null` 表示尚未加载完成，显示占位 */
  counts?: Partial<Record<ObserveListKind, number | null>>;
  className?: string;
  "aria-label": string;
};

function formatParenCount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "(…)";
  }
  return `(${value.toLocaleString()})`;
}

export function ObserveListKindSwitcher({
  value,
  onChange,
  options,
  counts,
  className,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex flex-wrap items-center gap-1.5 sm:gap-2", className)}>
      {options.map((opt) => {
        const selected = value === opt.id;
        const Icon = KIND_ICONS[opt.id];
        const raw = counts?.[opt.id];
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.id)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[color,background-color] sm:px-3",
              /** 选中 / 悬停统一浅灰底，无描边 */
              selected
                ? "bg-[#f2f5fa] font-semibold text-neutral-800 dark:bg-zinc-800/75 dark:text-zinc-100"
                : "text-neutral-600 hover:bg-[#f2f5fa] hover:text-neutral-900 dark:text-zinc-400 dark:hover:bg-zinc-800/75 dark:hover:text-zinc-100",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                selected ? "text-neutral-800 dark:text-zinc-100" : "text-neutral-600 dark:text-zinc-400",
              )}
              strokeWidth={selected ? 3 : 2}
              aria-hidden
            />
            <span className="whitespace-nowrap">{opt.label}</span>
            <span
              className={cn(
                "tabular-nums text-[13px]",
                selected ? "text-neutral-700 dark:text-zinc-300" : "text-neutral-500 dark:text-zinc-500",
              )}
            >
              {formatParenCount(raw)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
