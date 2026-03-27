"use client";

import { endOfDay, format, startOfDay } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ObserveDatePreset, ObserveDateRange } from "@/lib/observe-date-range";
import { cn } from "@/lib/utils";

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

  const [menuOpen, setMenuOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<DateRange | undefined>();

  const triggerLabel = (() => {
    if (value.kind === "custom") {
      const a = format(new Date(value.startMs), dateFmt, { locale: dfLocale });
      const b = format(new Date(value.endMs), dateFmt, { locale: dfLocale });
      return `${a} – ${b}`;
    }
    return t(presetTranslationKey(value.preset));
  })();

  const radioValue = value.kind === "preset" ? value.preset : "";

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
    const from = customDraft?.from;
    const to = customDraft?.to ?? customDraft?.from;
    if (!from || !to) {
      return;
    }
    onChange({
      kind: "custom",
      startMs: startOfDay(from).getTime(),
      endMs: endOfDay(to).getTime(),
    });
    setMenuOpen(false);
  }, [customDraft, onChange]);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "h-9 gap-2 px-3 font-medium shadow-sm",
          className,
        )}
        aria-label={t("dateRangeLabel")}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="max-w-[11rem] truncate sm:max-w-[14rem]">{triggerLabel}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuRadioGroup value={radioValue} onValueChange={onPresetChange}>
          {MENU_PRESETS.map((p) => (
            <DropdownMenuRadioItem key={p} value={p}>
              {t(presetTranslationKey(p))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub
          onOpenChange={(open) => {
            if (open) {
              if (value.kind === "custom") {
                setCustomDraft({
                  from: new Date(value.startMs),
                  to: new Date(value.endMs),
                });
              } else {
                setCustomDraft(undefined);
              }
            }
          }}
        >
          <DropdownMenuSubTrigger className="gap-2">
            <span className="flex-1">{t("dateRangeCustom")}</span>
            <CalendarIcon className="size-4 text-muted-foreground" aria-hidden />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto p-3" alignOffset={-4} sideOffset={6}>
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={customDraft}
              onSelect={setCustomDraft}
              locale={dfLocale}
            />
            <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setMenuOpen(false)}>
                {t("dateRangeCancel")}
              </Button>
              <Button type="button" size="sm" disabled={!customDraft?.from} onClick={() => applyCustom()}>
                {t("dateRangeApply")}
              </Button>
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
