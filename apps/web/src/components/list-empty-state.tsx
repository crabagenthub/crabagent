"use client";

import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export function ListEmptyState(props: {
  title: string;
  description?: string;
  /** 例如「前往设置」链接或按钮 */
  footer?: ReactNode;
  className?: string;
  /** `card`：外层实线白底卡片，内区沿用 shadcn Empty 布局 */
  variant?: "plain" | "card";
  /** 覆盖默认图标；传 `null` 可去掉图标区 */
  media?: ReactNode | null;
}) {
  const { title, description, footer, className = "", variant = "plain", media } = props;

  const hideMedia = media === null;

  const body = (
    <>
      <EmptyHeader>
        {!hideMedia ? (
          <EmptyMedia variant="icon">{media ?? <Inbox aria-hidden className="size-4" />}</EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {footer ? <EmptyContent>{footer}</EmptyContent> : null}
    </>
  );

  if (variant === "card") {
    return (
      <div className={cn("overflow-hidden rounded-2xl border border-border bg-white shadow-sm", className)}>
        <Empty className="min-h-[min(48vh,360px)] border-0 bg-transparent shadow-none">{body}</Empty>
      </div>
    );
  }

  return <Empty className={cn("min-h-[min(48vh,360px)]", className)}>{body}</Empty>;
}
