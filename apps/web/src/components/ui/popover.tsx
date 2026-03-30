"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger className={cn(className)} {...props} />;
}

type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  sideOffset?: number;
  align?: "start" | "center" | "end";
};

function PopoverContent({
  className,
  sideOffset = 8,
  align = "start",
  children,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        sideOffset={sideOffset}
        align={align}
        /** 高于列表页 `main`/表格/横向渐变与 fixed 底栏，避免筛选层被内容盖住 */
        className="isolate z-[200]"
      >
        <PopoverPrimitive.Popup
          className={cn(
            "relative z-[200] max-h-[min(70vh,32rem)] w-[min(100vw-1rem,36rem)] max-w-[min(100vw-1rem,36rem)] overflow-y-auto rounded-md border border-border bg-popover p-3 text-sm leading-relaxed text-popover-foreground shadow-md outline-none duration-200 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-top-1 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          initialFocus={false}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverClose({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close className={cn(className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverClose };
