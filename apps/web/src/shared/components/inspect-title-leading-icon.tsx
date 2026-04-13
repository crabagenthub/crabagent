"use client";

import { IconBranch, IconList, IconMessage } from "@arco-design/web-react/icon";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/** 与会话 / 消息 / 执行步骤详情头图一致：观测列表 tabs 对齐（threads=list, traces=message, spans=branch）。 */
export type InspectTitleVisualKind = "session" | "message" | "step";

const KIND_ICONS: Record<
  InspectTitleVisualKind,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  session: IconList,
  message: IconMessage,
  step: IconBranch,
};

type Props = {
  kind: InspectTitleVisualKind;
  iconClassName?: string;
  className?: string;
};

export function InspectTitleLeadingIcon({ kind, iconClassName, className }: Props) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      className={cn(
        "inline-flex w-9 min-w-9 shrink-0 items-center justify-center self-stretch rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-400",
        className,
      )}
      aria-hidden
    >
      <Icon className={cn("size-5 shrink-0", iconClassName)} strokeWidth={2} aria-hidden />
    </span>
  );
}
