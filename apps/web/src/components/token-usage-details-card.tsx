"use client";

import { useTranslations } from "next-intl";
import { IconCommon } from "@arco-design/web-react/icon";
import { cn } from "@/lib/utils";

const CANON_ORDER = ["prompt_tokens", "completion_tokens", "cache_read_tokens", "total_tokens"];

function sortedTokenKeys(entries: Record<string, number>): string[] {
  return Object.keys(entries).sort((a, b) => {
    const ia = CANON_ORDER.indexOf(a);
    const ib = CANON_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

export function TokenUsageDetailsCard({
  entries,
  className,
  hideHeader = false,
}: {
  entries: Record<string, number>;
  className?: string;
  /** 侧栏等场景仅展示表格行，不显示标题条。 */
  hideHeader?: boolean;
}) {
  const t = useTranslations("Traces");
  const keys = sortedTokenKeys(entries);
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
  return (
    <div className={cn("min-w-[14rem] space-y-3 py-1 text-left", className)}>
      {!hideHeader ? (
        <div className="flex items-center gap-2 border-b border-neutral-100 pb-2 dark:border-neutral-800">
          <IconCommon className="size-4 text-violet-500" aria-hidden />
          <span className="text-sm font-bold text-neutral-800 dark:text-neutral-100">{t("semanticTokenUsageTitle")}</span>
        </div>
      ) : null}
      <div className={cn("grid grid-cols-1 gap-y-2.5", hideHeader && "pt-0")}>
        {keys.map((k) => {
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
    </div>
  );
}
