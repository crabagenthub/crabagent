"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

import "react-day-picker/style.css";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "rdp-root rounded-md border border-border bg-background p-2 [--rdp-accent-color:var(--primary)] [--rdp-background-color:var(--accent)]",
        className,
      )}
      components={{
        Chevron: ({ className: chClass, orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", chClass)} aria-hidden />
          ) : (
            <ChevronRight className={cn("size-4", chClass)} aria-hidden />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
