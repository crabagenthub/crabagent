"use client";

import { IconCopy } from "@arco-design/web-react/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/feedback";
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
            onClick={(e) => {
              // 勿在 onClickCapture 里 stopPropagation：会阻断同一 button 上 onClick（冒泡阶段），复制永远不执行。
              if (stopPropagation) {
                e.stopPropagation();
              }
              void copyText(text).then((ok) => {
                if (ok) {
                  toast.success(successLabel);
                }
              });
            }}
            onMouseDown={(e) => {
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
