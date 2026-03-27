"use client";

import { Dialog } from "@base-ui/react/dialog";
import * as React from "react";

import { cn } from "@/lib/utils";

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
};

export function Drawer({ open, onOpenChange, children, className }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Viewport
          className={cn(
            "fixed inset-0 z-50 flex justify-end bg-[#0000001a] p-0 outline-none transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [&]:z-50",
            "data-[ending-style]:bg-transparent data-[starting-style]:bg-transparent",
          )}
        >
          <Dialog.Popup
            className={cn(
              "flex h-[100dvh] max-h-[100dvh] w-[min(100vw-0.5rem,64rem)] max-w-[min(100vw-0.5rem,64rem)] flex-col border-l border-border bg-background shadow-2xl outline-none",
              "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "data-[ending-style]:translate-x-2 data-[ending-style]:opacity-0",
              "data-[starting-style]:translate-x-2 data-[starting-style]:opacity-0",
              className,
            )}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const DrawerClose = Dialog.Close;
