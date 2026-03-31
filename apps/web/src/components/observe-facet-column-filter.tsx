"use client";

import "@/lib/arco-react19-setup";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dropdown, Menu } from "@arco-design/web-react";
import { IconFilter } from "@arco-design/web-react/icon";
import { Button } from "@/components/ui/button";
import { OBSERVE_TABLE_ICON_BUTTON_CLASSNAME } from "@/lib/observe-table-control-style";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  ariaLabelKey: "channelColumnFilterAria" | "agentColumnFilterAria";
};

/** Funnel + popover list, same interaction as {@link ObserveStatusColumnFilter}. */
export function ObserveFacetColumnFilter({ label, value, options, onChange, ariaLabelKey }: Props) {
  const t = useTranslations("Traces");
  const [open, setOpen] = useState(false);
  const applied = value.trim();

  const pick = (next: string) => {
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
            selectedKeys={applied ? [applied] : ["__all__"]}
            onClickMenuItem={(key) => {
              pick(key === "__all__" ? "" : String(key));
            }}
            className="min-w-[10rem]"
          >
            <Menu.Item key="__all__">{t("filterAll")}</Menu.Item>
            {options.map((opt) => (
              <Menu.Item key={opt}>{opt}</Menu.Item>
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
            applied ? "text-primary" : "text-neutral-500",
          )}
          aria-label={t(ariaLabelKey)}
          aria-expanded={open}
        >
          <IconFilter className="size-3.5" strokeWidth={2} aria-hidden />
        </Button>
      </Dropdown>
    </div>
  );
}
