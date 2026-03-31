"use client";

import "@/lib/arco-react19-setup";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dropdown, Menu } from "@arco-design/web-react";
import { IconFilter } from "@arco-design/web-react/icon";
import { Button } from "@/components/ui/button";
import { OBSERVE_LIST_STATUS_OPTIONS, type ObserveListStatusParam } from "@/lib/observe-facets";
import { OBSERVE_TABLE_ICON_BUTTON_CLASSNAME } from "@/lib/observe-table-control-style";
import { cn } from "@/lib/utils";

type Props = {
  /** 表头文案，如「状态」 */
  label: string;
  value: ObserveListStatusParam | "";
  onChange: (next: ObserveListStatusParam | "") => void;
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

  const pick = (next: ObserveListStatusParam | "") => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="whitespace-nowrap">{label}</span>
      <Dropdown
        popupVisible={open}
        onVisibleChange={setOpen}
        trigger="click"
        droplist={
          <Menu
            selectedKeys={value ? [value] : ["__all__"]}
            onClickMenuItem={(key) => {
              pick(key === "__all__" ? "" : (key as ObserveListStatusParam));
            }}
            className="min-w-[9rem]"
          >
            <Menu.Item key="__all__">{t("filterAll")}</Menu.Item>
            {OBSERVE_LIST_STATUS_OPTIONS.map((s) => (
              <Menu.Item key={s}>{statusLabel(s)}</Menu.Item>
            ))}
          </Menu>
        }
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            OBSERVE_TABLE_ICON_BUTTON_CLASSNAME,
            value ? "text-primary" : "text-neutral-500",
          )}
          aria-label={t("statusColumnFilterAria")}
          aria-expanded={open}
        >
          <IconFilter className="size-3.5" strokeWidth={2} aria-hidden />
        </Button>
      </Dropdown>
    </div>
  );
}
