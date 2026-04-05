"use client";

import "@/lib/arco-react19-setup";
import { IconCalendar, IconDown } from "@arco-design/web-react/icon";
import DatePicker from "@arco-design/web-react/es/DatePicker";
import { Dropdown, Menu } from "@arco-design/web-react";
import dayjs, { type Dayjs } from "dayjs";
import { endOfDay, format, startOfDay } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ObserveDatePreset, ObserveDateRange } from "@/lib/observe-date-range";
import { OBSERVE_CONTROL_OUTLINE_CLASSNAME, OBSERVE_PANEL_BORDER_CLASSNAME } from "@/lib/observe-table-style";
import { cn } from "@/lib/utils";

const RangePicker = DatePicker.RangePicker;

const MENU_PRESETS: ObserveDatePreset[] = ["24h", "3d", "7d", "30d", "60d", "all"];

type Props = {
  value: ObserveDateRange;
  onChange: (next: ObserveDateRange) => void;
  className?: string;
};

function presetTranslationKey(p: ObserveDatePreset): string {
  switch (p) {
    case "all":
      return "dateRangeAll";
    case "24h":
      return "dateRangePast24h";
    case "3d":
      return "dateRangePast3d";
    case "7d":
      return "dateRangePast7d";
    case "30d":
      return "dateRangePast30d";
    case "60d":
      return "dateRangePast60d";
    default:
      return "dateRangeAll";
  }
}

export function ObserveDateRangeTrigger({ value, onChange, className }: Props) {
  const t = useTranslations("Traces");
  const localeTag = useLocale();
  const dfLocale = localeTag.toLowerCase().startsWith("zh") ? zhCN : enUS;
  const dateFmt = localeTag.toLowerCase().startsWith("zh") ? "yyyy年M月d日" : "MMM d, yyyy";
  const dayStartOfWeek = localeTag.toLowerCase().startsWith("zh") ? 1 : 0;

  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [rangeDraft, setRangeDraft] = useState<[Dayjs, Dayjs] | null>(null);

  const triggerLabel = (() => {
    if (value.kind === "custom") {
      const a = format(new Date(value.startMs), dateFmt, { locale: dfLocale });
      const b = format(new Date(value.endMs), dateFmt, { locale: dfLocale });
      return `${a} – ${b}`;
    }
    return t(presetTranslationKey(value.preset));
  })();

  const onPresetChange = useCallback(
    (v: string) => {
      if (v === "all" || v === "24h" || v === "3d" || v === "7d" || v === "30d" || v === "60d") {
        onChange({ kind: "preset", preset: v });
        setMenuOpen(false);
      }
    },
    [onChange],
  );

  const applyCustom = useCallback(() => {
    if (!rangeDraft?.[0] || !rangeDraft[1]) {
      return;
    }
    const from = rangeDraft[0].toDate();
    const to = rangeDraft[1].toDate();
    onChange({
      kind: "custom",
      startMs: startOfDay(from).getTime(),
      endMs: endOfDay(to).getTime(),
    });
    setMenuOpen(false);
  }, [rangeDraft, onChange]);

  const openCustom = useCallback(() => {
    if (value.kind === "custom") {
      setRangeDraft([dayjs(value.startMs), dayjs(value.endMs)]);
    } else {
      setRangeDraft(null);
    }
    setCustomOpen(true);
  }, [value]);

  return (
    <Dropdown
      popupVisible={menuOpen}
      onVisibleChange={(next) => {
        setMenuOpen(next);
        if (!next) {
          setCustomOpen(false);
        }
      }}
      trigger="click"
      droplist={
        <div
          className={cn(
            "rounded-md bg-popover p-2 text-popover-foreground shadow-sm",
            customOpen ? "w-[20rem]" : "w-[13rem]",
            OBSERVE_PANEL_BORDER_CLASSNAME
          )}
        >
          {!customOpen ? (
            <div className="space-y-1">
              <Menu
                selectable
                selectedKeys={value.kind === "preset" ? [value.preset] : []}
                onClickMenuItem={(key) => {
                  onPresetChange(String(key));
                }}
              >
                {MENU_PRESETS.map((p) => (
                  <Menu.Item key={p}>{t(presetTranslationKey(p))}</Menu.Item>
                ))}
              </Menu>
              <div className="my-2 h-px bg-border" />
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between px-3 font-normal"
                onClick={openCustom}
              >
                <span>{t("dateRangeCustom")}</span>
                <IconCalendar className="size-4 text-muted-foreground" aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="w-full p-1">
              <RangePicker
                dayStartOfWeek={dayStartOfWeek}
                style={{ width: "100%" }}
                value={rangeDraft ?? undefined}
                onChange={(_, v) => {
                  if (v?.[0] && v?.[1]) {
                    setRangeDraft([v[0], v[1]]);
                  } else if (v?.[0]) {
                    setRangeDraft([v[0], v[0]]);
                  } else {
                    setRangeDraft(null);
                  }
                }}
              />
              <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCustomOpen(false);
                  }}
                >
                  {t("dateRangeCancel")}
                </Button>
                <Button type="button" size="sm" disabled={!rangeDraft?.[0] || !rangeDraft[1]} onClick={() => applyCustom()}>
                  {t("dateRangeApply")}
                </Button>
              </div>
            </div>
          )}
        </div>
      }
    >
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn(
          "h-9 gap-2 bg-white px-3 font-medium text-neutral-700 shadow-sm transition-all hover:text-neutral-900 active:scale-[0.98] dark:bg-zinc-950/50 dark:text-zinc-300 dark:hover:text-zinc-100",
          OBSERVE_CONTROL_OUTLINE_CLASSNAME,
          className
        )}
        aria-label={t("dateRangeLabel")}
      >
        <IconCalendar className="size-4 shrink-0 text-neutral-500 dark:text-zinc-400" aria-hidden />
        <span className="max-w-[11rem] truncate sm:max-w-[14rem]">{triggerLabel}</span>
        <IconDown className="size-4 shrink-0 text-neutral-400 dark:text-zinc-500" aria-hidden />
      </Button>
    </Dropdown>
  );
}
