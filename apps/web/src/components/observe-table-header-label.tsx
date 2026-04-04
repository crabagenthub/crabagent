"use client";

import type { ReactNode } from "react";

/**
 * 会话 / 消息 / 执行步骤列表表头「纯文案」列统一用此样式；
 * 筛选项列请直接使用 `ObserveFacetColumnFilter` / `ObserveStatusColumnFilter`（与 threads 一致，不再外包一层 span）。
 */
export const OBSERVE_TABLE_HEADER_LABEL_CLASS =
  "inline-flex items-center whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-600";

export function ObserveTableHeaderLabel({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className={OBSERVE_TABLE_HEADER_LABEL_CLASS} title={title}>
      {children}
    </span>
  );
}
