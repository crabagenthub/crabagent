"use client";

import ArcoEmpty from "@arco-design/web-react/es/Empty";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

import "@/lib/arco-react19-setup";
import { cn } from "@/lib/utils";

export function ListEmptyState(props: {
  title: string;
  description?: string;
  /** 例如「前往设置」链接或按钮 */
  footer?: ReactNode;
  className?: string;
  /** `card`：外层实线白底卡片，内区为 Arco Empty */
  variant?: "plain" | "card";
  /** 覆盖默认图标；传 `null` 可去掉图标区 */
  media?: ReactNode | null;
}) {
  const { title, description, footer, className = "", variant = "plain", media } = props;

  const hideMedia = media === null;

  const descriptionNode = (
    <div className="flex flex-col items-center gap-2 text-balance">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      {footer ? <div className="w-full">{footer}</div> : null}
    </div>
  );

  const inner = (
    <ArcoEmpty
      className={cn(
        "min-h-[min(48vh,360px)] flex-col justify-center",
        variant === "card" && "border-0 bg-transparent",
        hideMedia && "[&_.arco-empty-image]:hidden",
      )}
      icon={hideMedia ? undefined : (media ?? <Inbox aria-hidden className="size-8 text-muted-foreground" />)}
      description={descriptionNode}
    />
  );

  if (variant === "card") {
    return (
      <div className={cn("overflow-hidden rounded-2xl border border-border bg-white shadow-sm", className)}>{inner}</div>
    );
  }

  return <div className={className}>{inner}</div>;
}
