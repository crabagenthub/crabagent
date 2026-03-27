"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ObserveListStatusParam } from "@/lib/observe-facets";

const ALL = "__all__" as const;

const STATUS_OPTIONS: ObserveListStatusParam[] = ["running", "success", "error", "timeout"];

export type ObserveListFiltersDialogListKind = "threads" | "traces" | "spans";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facetFilterCount: number;
  listKind: ObserveListFiltersDialogListKind;
  draftChannel: string;
  setDraftChannel: (v: string) => void;
  draftAgent: string;
  setDraftAgent: (v: string) => void;
  draftStatus: ObserveListStatusParam | "";
  setDraftStatus: (v: ObserveListStatusParam | "") => void;
  channelOptions: string[];
  agentOptions: string[];
  onApply: () => void;
  onResetDraft: () => void;
};

export function ObserveListFiltersDialog({
  open,
  onOpenChange,
  facetFilterCount,
  listKind,
  draftChannel,
  setDraftChannel,
  draftAgent,
  setDraftAgent,
  draftStatus,
  setDraftStatus,
  channelOptions,
  agentOptions,
  onApply,
  onResetDraft,
}: Props) {
  const t = useTranslations("Traces");
  const showStatus = listKind === "traces" || listKind === "spans";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            aria-label={t("filterButtonAria")}
          />
        }
      >
        <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
        </svg>
        {t("filterButton")}
        {facetFilterCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {facetFilterCount > 9 ? "9+" : facetFilterCount}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[min(100vw-1rem,22rem)] max-w-[min(100vw-1rem,22rem)] p-4">
        <p className="text-sm font-semibold leading-tight text-foreground">{t("filterDialogTitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("filterDialogDescription")}</p>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("filterChannelLabel")}</span>
            <Select
              value={draftChannel.trim() ? draftChannel.trim() : ALL}
              onValueChange={(v) => setDraftChannel(v == null || v === ALL ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filterAll")}>
                  {(v: unknown) =>
                    v == null || v === ALL
                      ? t("filterAll")
                      : typeof v === "string" || typeof v === "number"
                        ? String(v)
                        : t("filterAll")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filterAll")}</SelectItem>
                {channelOptions.map((ch) => (
                  <SelectItem key={ch} value={ch}>
                    {ch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("filterAgentLabel")}</span>
            <Select
              value={draftAgent.trim() ? draftAgent.trim() : ALL}
              onValueChange={(v) => setDraftAgent(v == null || v === ALL ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("filterAll")}>
                  {(v: unknown) =>
                    v == null || v === ALL
                      ? t("filterAll")
                      : typeof v === "string" || typeof v === "number"
                        ? String(v)
                        : t("filterAll")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filterAll")}</SelectItem>
                {agentOptions.map((ag) => (
                  <SelectItem key={ag} value={ag}>
                    {ag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showStatus ? (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("filterStatusLabel")}</span>
              <Select
                value={draftStatus ? draftStatus : ALL}
                onValueChange={(v) =>
                  setDraftStatus(v == null || v === ALL ? "" : (v as ObserveListStatusParam))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("filterAll")}>
                    {(v: unknown) => {
                      if (v == null || v === ALL) return t("filterAll");
                      if (v === "running") return t("filterStatusRunning");
                      if (v === "success") return t("filterStatusSuccess");
                      if (v === "error") return t("filterStatusError");
                      if (v === "timeout") return t("filterStatusTimeout");
                      return String(v);
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("filterAll")}</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "running"
                        ? t("filterStatusRunning")
                        : s === "success"
                          ? t("filterStatusSuccess")
                          : s === "error"
                            ? t("filterStatusError")
                            : t("filterStatusTimeout")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" size="sm" onClick={() => onResetDraft()}>
            {t("filterReset")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("filterDialogCancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onApply();
              onOpenChange(false);
            }}
          >
            {t("filterDialogApply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
