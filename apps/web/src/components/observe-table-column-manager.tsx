"use client";

import "@/lib/arco-react19-setup";
import { Checkbox, Dropdown } from "@arco-design/web-react";
import { IconList } from "@arco-design/web-react/icon";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  observeTableColumnStorageKey,
  readHiddenOptionalKeys,
  writeHiddenOptionalKeys,
} from "@/lib/observe-table-column-storage";
import { OBSERVE_CONTROL_OUTLINE_CLASSNAME } from "@/lib/observe-table-style";
import { cn } from "@/lib/utils";

export type ObserveColumnManagerItem = {
  key: string;
  label: string;
  mandatory?: boolean;
};

export function useObserveTableColumnVisibility(tableId: string, optionalKeys: readonly string[]) {
  const storageKey = useMemo(() => observeTableColumnStorageKey(tableId), [tableId]);
  const [hiddenOptional, setHiddenOptional] = useState<Set<string>>(() => new Set());

  useLayoutEffect(() => {
    setHiddenOptional(readHiddenOptionalKeys(storageKey, optionalKeys));
  }, [storageKey, optionalKeys]);

  const persist = useCallback(
    (next: Set<string>) => {
      setHiddenOptional(next);
      writeHiddenOptionalKeys(storageKey, next);
    },
    [storageKey],
  );

  const toggleOptional = useCallback(
    (key: string) => {
      const next = new Set(hiddenOptional);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      persist(next);
    },
    [hiddenOptional, persist],
  );

  const resetOptional = useCallback(() => {
    persist(new Set());
  }, [persist]);

  return { hiddenOptional, toggleOptional, resetOptional };
}

type ManagerProps = {
  items: ObserveColumnManagerItem[];
  hiddenOptional: Set<string>;
  onToggleOptional: (key: string) => void;
  onReset: () => void;
};

export function ObserveTableColumnManager({ items, hiddenOptional, onToggleOptional, onReset }: ManagerProps) {
  const t = useTranslations("Traces");

  const sortedItems = useMemo(() => {
    const m = items.filter((i) => i.mandatory);
    const o = items.filter((i) => !i.mandatory);
    return [...m, ...o];
  }, [items]);

  const droplist = (
    <div
      className="box-border min-w-[14rem] max-w-[min(100vw-2rem,20rem)] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      onClick={(e) => e.stopPropagation()}
    >
      <ul className="m-0 max-h-[min(60vh,22rem)] list-none space-y-0 overflow-y-auto p-0">
        {sortedItems.map((it) => {
          const mandatory = Boolean(it.mandatory);
          const checked = mandatory || !hiddenOptional.has(it.key);
          return (
            <li key={it.key} className="px-1 py-0.5">
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm",
                  mandatory ? "cursor-default opacity-60" : "hover:bg-accent/80",
                )}
              >
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={checked}
                  disabled={mandatory}
                  onChange={(c) => {
                    if (mandatory) {
                      return;
                    }
                    const wantVisible = Boolean(c);
                    const isVisible = !hiddenOptional.has(it.key);
                    if (wantVisible !== isVisible) {
                      onToggleOptional(it.key);
                    }
                  }}
                />
                <span className="min-w-0 leading-snug text-foreground">{it.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
          onClick={() => onReset()}
        >
          {t("columnManagerResetDefault")}
        </button>
      </div>
    </div>
  );

  return (
    <Dropdown droplist={droplist} trigger="click" position="br">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        title={t("columnManagerTitle")}
        aria-label={t("columnManagerAria")}
        className={cn(
          "shrink-0 bg-white text-neutral-600 hover:text-neutral-800 dark:bg-zinc-950/50 dark:text-zinc-400 dark:hover:text-zinc-200",
          OBSERVE_CONTROL_OUTLINE_CLASSNAME,
        )}
        data-row-click-stop
      >
        <IconList className="h-4 w-4 text-neutral-500 dark:text-zinc-400" aria-hidden />
      </Button>
    </Dropdown>
  );
}
