"use client";

import { Popover } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { IconCommon } from "@arco-design/web-react/icon";
import { normalizeTokenUsageEntriesForDisplay } from "@/lib/span-token-display";
import { cn } from "@/lib/utils";

const CANON_ORDER = ["prompt_tokens", "completion_tokens", "cache_read_tokens", "total_tokens"];

function sortedTokenKeysFlat(entries: Record<string, number>): string[] {
  return Object.keys(entries).sort((a, b) => {
    const ia = CANON_ORDER.indexOf(a);
    const ib = CANON_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

/** 第二段：总计优先，其余与扩展键一致。 */
function sortedSecondaryKeys(keys: string[]): string[] {
  const rest = keys.filter((k) => k !== "total_tokens");
  const sortedRest = [...rest].sort((a, b) => {
    const ia = CANON_ORDER.indexOf(a);
    const ib = CANON_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  return keys.includes("total_tokens") ? ["total_tokens", ...sortedRest] : sortedRest;
}

function partitionKeys(keys: string[]): { primary: string[]; secondary: string[] } {
  const primary = ["prompt_tokens", "completion_tokens"].filter((k) => keys.includes(k));
  const secondary = sortedSecondaryKeys(keys.filter((k) => !primary.includes(k)));
  return { primary, secondary };
}

export function TokenUsageDetailsCard({
  entries: rawEntries,
  className,
  hideHeader = false,
  variant = "grouped",
}: {
  entries: Record<string, number>;
  className?: string;
  /** 侧栏等场景仅展示表格行，不显示标题条。 */
  hideHeader?: boolean;
  /**
   * `grouped`：输入/输出 + 分隔线 + 其余明细（与执行步骤模型 token Popover 一致）；
   * `flat`：单行列表。
   */
  variant?: "grouped" | "flat";
}) {
  const t = useTranslations("Traces");
  const entries = normalizeTokenUsageEntriesForDisplay(rawEntries);
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return <p className={cn("text-xs text-neutral-500 dark:text-neutral-400", className)}>—</p>;
  }
  const labelFor = (key: string) => {
    switch (key) {
      case "prompt_tokens":
        return t("detailAttrTokenPrompt");
      case "completion_tokens":
        return t("detailAttrTokenCompletion");
      case "cache_read_tokens":
        return t("detailAttrTokenCacheRead");
      case "total_tokens":
        return t("colTotalTokens");
      default:
        return key;
    }
  };

  const row = (k: string): ReactNode => {
    const isTotal = k === "total_tokens";
    return (
      <div key={k} className="flex items-center justify-between gap-4 text-xs">
        <span
          className={cn(
            "text-neutral-500 dark:text-neutral-400",
            isTotal && "font-bold text-neutral-700 dark:text-neutral-300",
          )}
        >
          {labelFor(k)}
        </span>
        <span
          className={cn(
            "tabular-nums text-neutral-800 dark:text-neutral-100",
            isTotal && "font-bold text-violet-600 dark:text-violet-400",
          )}
        >
          {entries[k]!.toLocaleString()}
        </span>
      </div>
    );
  };

  const flatKeys = variant === "flat" ? sortedTokenKeysFlat(entries) : [];
  const { primary, secondary } = variant === "grouped" ? partitionKeys(keys) : { primary: [], secondary: [] as string[] };

  return (
    <div className={cn("min-w-[14rem] space-y-3 py-1 text-left", className)}>
      {!hideHeader ? (
        <div className="flex items-center gap-2 border-b border-neutral-100 pb-2 dark:border-neutral-800">
          <IconCommon className="size-4 text-violet-500" aria-hidden />
          <span className="text-sm font-bold text-neutral-800 dark:text-neutral-100">{t("semanticTokenUsageTitle")}</span>
        </div>
      ) : null}
      {variant === "flat" ? (
        <div className={cn("grid grid-cols-1 gap-y-2.5", hideHeader && "pt-0")}>
          {flatKeys.map((k) => {
            const isTotal = k === "total_tokens";
            return (
              <div
                key={k}
                className={cn(
                  "flex items-center justify-between gap-4 text-xs",
                  isTotal && "mt-1 border-t border-neutral-100 pt-2 font-bold dark:border-neutral-800",
                )}
              >
                <span
                  className={cn(
                    "text-neutral-500 dark:text-neutral-400",
                    isTotal && "text-neutral-700 dark:text-neutral-300",
                  )}
                >
                  {labelFor(k)}
                </span>
                <span
                  className={cn(
                    "tabular-nums text-neutral-800 dark:text-neutral-100",
                    isTotal && "text-violet-600 dark:text-violet-400",
                  )}
                >
                  {entries[k]!.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={cn("grid grid-cols-1 gap-y-2.5", hideHeader && "pt-0")}>
          {primary.length > 0 ? <div className="space-y-2">{primary.map((k) => row(k))}</div> : null}
          {primary.length > 0 && secondary.length > 0 ? (
            <div className="border-t border-neutral-100 pt-2 dark:border-neutral-800" />
          ) : null}
          {secondary.length > 0 ? <div className="space-y-2">{secondary.map((k) => row(k))}</div> : null}
        </div>
      )}
    </div>
  );
}

/** 执行步骤 / 会话抽屉等处共用的「悬停展示 Token 明细」浮层。 */
export function TokenUsagePopover({
  entries,
  children,
  trigger = "hover",
  position = "top",
  disabled,
}: {
  entries: Record<string, number>;
  children: React.ReactNode;
  trigger?: React.ComponentProps<typeof Popover>["trigger"];
  position?: React.ComponentProps<typeof Popover>["position"];
  /** 为 true 时不包 Popover，仅渲染 children。 */
  disabled?: boolean;
}) {
  if (disabled || Object.keys(entries).length === 0) {
    return <>{children}</>;
  }
  return (
    <Popover trigger={trigger} position={position} content={<TokenUsageDetailsCard entries={entries} />}>
      {children}
    </Popover>
  );
}
