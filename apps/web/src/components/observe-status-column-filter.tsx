"use client";

import "@/lib/arco-react19-setup";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Dropdown } from "@arco-design/web-react";
import { IconFilter } from "@arco-design/web-react/icon";
import { Button } from "@/components/ui/button";
import { OBSERVE_LIST_STATUS_OPTIONS, type ObserveListStatusParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_ICON_BUTTON_CLASSNAME } from "@/lib/observe-table-control-style";
import { cn } from "@/lib/utils";

type Props = {
  /** 表头文案，如「状态」 */
  label: string;
  /** 空数组表示不限（全部） */
  value: ObserveListStatusParam[];
  onChange: (next: ObserveListStatusParam[]) => void;
};

export function ObserveStatusColumnFilter({ label, value, onChange }: Props) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(false);

  const statusLabel = (s: ObserveListStatusParam) =>
    s === "running"
      ? t("filterStatusRunning")
      : s === "success"
        ? t("filterStatusSuccess")
        : s === "error"
          ? t("filterStatusError")
          : t("filterStatusTimeout");

  const toggle = (s: ObserveListStatusParam, checked: boolean) => {
    if (checked) {
      onChange([...new Set([...value, s])]);
    } else {
      onChange(value.filter((x) => x !== s));
    }
  };

  const clearAll = () => {
    onChange([]);
    setOpen(false);
  };

  const active = value.length > 0;

  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {label}
      </span>
      <Dropdown
        popupVisible={open}
        onVisibleChange={setOpen}
        trigger="click"
        position="bl"
        droplist={
          <div
            className="min-w-[11rem] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-2 h-8 w-full justify-start px-2 text-xs font-normal"
              onClick={clearAll}
            >
              {t("filterAll")}
            </Button>
            <div className="space-y-1 border-t border-border pt-2">
              {OBSERVE_LIST_STATUS_OPTIONS.map((s) => (
                <Checkbox
                  key={s}
                  checked={value.includes(s)}
                  onChange={(c) => toggle(s, Boolean(c))}
                  className="!flex !w-full !items-center py-0.5 [&_.arco-checkbox-text]:text-xs"
                >
                  {statusLabel(s)}
                </Checkbox>
              ))}
            </div>
          </div>
        }
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            OBSERVE_TABLE_ICON_BUTTON_CLASSNAME,
            active ? "!text-primary hover:!text-primary" : "!text-neutral-600 hover:!text-neutral-700",
          )}
          aria-label={t("statusColumnFilterAria")}
          aria-expanded={open}
        >
          <IconFilter
            className={cn("size-3.5", active ? "text-primary" : "text-neutral-600")}
            strokeWidth={2}
            aria-hidden
          />
        </Button>
      </Dropdown>
    </div>
  );
}
