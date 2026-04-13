"use client";

import "@/lib/arco-react19-setup";
import { Checkbox, Dropdown } from "@arco-design/web-react";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Button } from "@/shared/ui/button";
import {
  observeTableColumnStorageKey,
  readHiddenOptionalKeys,
  writeHiddenOptionalKeys,
} from "@/lib/observe-table-column-storage";
import { OBSERVE_CONTROL_OUTLINE_CLASSNAME, OBSERVE_TOOLBAR_HOVER_FG_ICO } from "@/lib/observe-table-style";
import { cn } from "@/lib/utils";

export type ObserveColumnManagerItem = {
  key: string;
  label: string;
  mandatory?: boolean;
};

export function useObserveTableColumnVisibility(
  tableId: string,
  optionalKeys: readonly string[],
  /** First load / reset: hide these optional columns unless user has saved preferences. */
  defaultHiddenOptional?: readonly string[],
) {
  const storageKey = useMemo(() => observeTableColumnStorageKey(tableId), [tableId]);
  const [hiddenOptional, setHiddenOptional] = useState<Set<string>>(() =>
    readHiddenOptionalKeys(storageKey, optionalKeys, defaultHiddenOptional),
  );

  useLayoutEffect(() => {
    setHiddenOptional(readHiddenOptionalKeys(storageKey, optionalKeys, defaultHiddenOptional));
  }, [storageKey, optionalKeys, defaultHiddenOptional]);

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
    const next = new Set(
      (defaultHiddenOptional ?? []).filter((k) => optionalKeys.includes(k)),
    );
    persist(next);
  }, [defaultHiddenOptional, optionalKeys, persist]);

  return { hiddenOptional, toggleOptional, resetOptional };
}

type ManagerProps = {
  items: ObserveColumnManagerItem[];
  hiddenOptional: Set<string>;
  onToggleOptional: (key: string) => void;
  onReset: () => void;
};

function ColumnManagerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M351.372549 742.901961H170.666667c-22.086275 0-40.156863 18.070588-40.156863 40.156863s18.070588 40.156863 40.156863 40.156862h180.705882c22.086275 0 40.156863-18.070588 40.156863-40.156862s-18.070588-40.156863-40.156863-40.156863zM351.372549 461.803922H170.666667c-22.086275 0-40.156863 18.070588-40.156863 40.156862s18.070588 40.156863 40.156863 40.156863h180.705882c22.086275 0 40.156863-18.070588 40.156863-40.156863s-18.070588-40.156863-40.156863-40.156862zM853.333333 180.705882H170.666667c-22.086275 0-40.156863 18.070588-40.156863 40.156863s18.070588 40.156863 40.156863 40.156863h682.666666c22.086275 0 40.156863-18.070588 40.156863-40.156863s-18.070588-40.156863-40.156863-40.156863z"
        fill="currentColor"
      />
      <path
        d="M662.588235 612.392157m-70.27451 0a70.27451 70.27451 0 1 0 140.54902 0 70.27451 70.27451 0 1 0-140.54902 0Z"
        fill="currentColor"
      />
      <path
        d="M831.247059 465.819608l-124.486275-72.282353-6.023529-2.007843c-24.094118-12.047059-52.203922-12.047059-76.298039 0l-6.02353 2.007843-124.486274 72.282353c-26.101961 16.062745-42.164706 44.172549-42.164706 74.290196v144.564706c0 30.117647 16.062745 58.227451 42.164706 74.290196l124.486274 72.282353c26.101961 16.062745 58.227451 16.062745 86.337255 0l124.486275-72.282353c26.101961-16.062745 42.164706-44.172549 42.164706-74.290196v-144.564706c2.007843-30.117647-14.054902-60.235294-40.156863-74.290196z m-34.133334 218.854902c0 4.015686-2.007843 6.023529-4.015686 8.031372l-124.486274 72.282353c-2.007843 2.007843-6.023529 2.007843-10.039216 0L532.078431 692.705882c-2.007843-2.007843-4.015686-4.015686-4.015686-8.031372v-146.572549c0-4.015686 2.007843-6.023529 4.015686-8.031373l124.486275-72.282353c2.007843-2.007843 6.023529-2.007843 10.039216 0l124.486274 72.282353c4.015686 2.007843 4.015686 4.015686 4.015686 8.031373v146.572549z"
        fill="currentColor"
      />
    </svg>
  );
}

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
          "group/ico shrink-0 rounded-md bg-white dark:bg-zinc-950/50",
          OBSERVE_CONTROL_OUTLINE_CLASSNAME,
          "!inline-flex !h-9 !w-9 !min-h-9 !min-w-9 !items-center !justify-center !gap-0 !p-0 !leading-none",
        )}
        data-row-click-stop
      >
        <ColumnManagerIcon
          className={cn(
            "block h-5 w-5 shrink-0 text-neutral-500 transition-colors duration-150 dark:text-zinc-400",
            OBSERVE_TOOLBAR_HOVER_FG_ICO,
          )}
        />
      </Button>
    </Dropdown>
  );
}
