"use client";

import { Message } from "@arco-design/web-react";
import { IconCopy } from "@arco-design/web-react/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  ariaLabel: string;
  tooltipLabel: string;
  successLabel: string;
  className?: string;
  iconClassName?: string;
  stopPropagation?: boolean;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function TraceCopyIconButton({
  text,
  ariaLabel,
  tooltipLabel,
  successLabel,
  className,
  iconClassName,
  stopPropagation = false,
}: Props) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() =>
              void copyText(text).then((ok) => {
                if (ok) {
                  Message.success(successLabel);
                }
              })
            }
            onMouseDown={(e) => {
              if (stopPropagation) {
                e.stopPropagation();
              }
            }}
            onClickCapture={(e) => {
              if (stopPropagation) {
                e.stopPropagation();
              }
            }}
            className={cn(
              "inline-flex shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200/80 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200",
              className,
            )}
            aria-label={ariaLabel}
          >
            <IconCopy className={cn("size-3.5 text-neutral-400", iconClassName)} />
          </button>
        }
      />
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}
