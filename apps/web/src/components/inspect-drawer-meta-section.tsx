"use client";

import { IconInfoCircle } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TraceCopyIconButton } from "@/components/trace-copy-icon-button";
import { cn } from "@/lib/utils";

export type InspectDrawerMetaField = {
  label: string;
  value: ReactNode;
  title?: string;
  mono?: boolean;
  colSpan?: 1 | 2 | 3 | 4;
  copyText?: string;
  copyAriaLabel?: string;
};

export type InspectDrawerMetaFooterItem = {
  icon?: ReactNode;
  content: ReactNode;
};

type Props = {
  /** 区域标题；省略则不展示（如抽屉顶栏仅需栅格数据） */
  title?: string;
  fields: InspectDrawerMetaField[];
  /** 与「计费信息」同一视觉层级的用量摘要条 */
  highlight?: {
    title: string;
    subtitle?: string;
    metrics: ReactNode;
    /** 默认在 subtitle 后显示 info 图标 */
    hideInfoIcon?: boolean;
  };
  footerItems?: InspectDrawerMetaFooterItem[];
  className?: string;
  variant?: "default" | "sidebar";
};

export function InspectDrawerMetaSection({ title, fields, highlight, footerItems, className, variant = "default" }: Props) {
  const isSidebar = variant === "sidebar";
  const t = useTranslations("Traces");

  return (
    <div className={cn("pt-1", className)}>
      {title ? (
        <h3 className="text-[15px] font-semibold leading-snug text-neutral-900 dark:text-neutral-50">{title}</h3>
      ) : null}

      <div
        className={cn(
          "grid grid-cols-1 gap-x-6 gap-y-4",
          isSidebar ? "md:grid-cols-1" : "md:grid-cols-4",
          title ? "mt-3" : "mt-0",
        )}
      >
        {fields.map((f, i) => (
          <div
            key={i}
            className={cn(
              "min-w-0",
              !isSidebar && f.colSpan === 2 && "md:col-span-2",
              !isSidebar && f.colSpan === 3 && "md:col-span-3",
              !isSidebar && f.colSpan === 4 && "md:col-span-4",
            )}
          >
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{f.label}</div>
            <div
              className={cn(
                "mt-1 flex min-w-0 items-center gap-1",
                f.mono && "font-mono text-sm text-neutral-900 dark:text-neutral-100",
              )}
              title={f.title}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-neutral-900 dark:text-neutral-100">
                {f.value}
              </span>
              {f.copyText && f.copyAriaLabel ? (
                <TraceCopyIconButton
                  text={f.copyText}
                  ariaLabel={f.copyAriaLabel}
                  tooltipLabel={t("copy")}
                  successLabel={t("copySuccessToast")}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {highlight ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-neutral-200/80 pt-4 text-sm dark:border-neutral-700/80">
          <span className="font-semibold text-neutral-900 dark:text-neutral-50">{highlight.title}</span>
          {highlight.subtitle ? (
            <>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden>
                |
              </span>
              <span className="text-neutral-600 dark:text-neutral-400">{highlight.subtitle}</span>
              {!highlight.hideInfoIcon ? (
                  <IconInfoCircle className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
                ) : null}
            </>
          ) : null}
          <span className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1">{highlight.metrics}</span>
        </div>
      ) : null}

      {footerItems != null && footerItems.length > 0 ? (
        <div className="mt-3 rounded-lg bg-[#f4f5f9] px-3 py-2.5 text-xs leading-relaxed text-neutral-600 dark:bg-neutral-900/55 dark:text-neutral-400">
          <ul className="m-0 list-none space-y-2 p-0">
            {footerItems.map((item, idx) => (
              <li key={idx} className="flex gap-2">
                {item.icon ? (
                  <span className="mt-0.5 shrink-0 text-neutral-400 dark:text-neutral-500">{item.icon}</span>
                ) : null}
                <span>{item.content}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
