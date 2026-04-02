"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** `card`: slightly stronger than `from-card` so fades read on `bg-card` tables (e.g. threads). */
const fadeFrom = {
  card: "from-muted/75 dark:from-muted/55",
  neutral: "from-white dark:from-card",
} as const;

export type ScrollableTableFrameVariant = keyof typeof fadeFrom;

/**
 * Wraps a wide table: shows left/right edge fades when there is horizontal overflow,
 * opacity transitions as the user scrolls (scroll-linked “底色” hint).
 */
export function ScrollableTableFrame({
  children,
  className,
  scrollClassName,
  variant = "card",
  /** When table data changes without resizing the viewport, bump this so edge fades recalc (e.g. rows.length). */
  contentKey,
}: {
  children: ReactNode;
  className?: string;
  /** Classes on the horizontal scroll container (e.g. max-h, overflow-y). */
  scrollClassName?: string;
  variant?: ScrollableTableFrameVariant;
  contentKey?: string | number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    const eps = 3;
    setShowLeft(scrollLeft > eps);
    setShowRight(max > eps && scrollLeft < max - eps);
  }, [contentKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const first = el.firstElementChild;
    if (first) {
      ro.observe(first);
    }
    return () => ro.disconnect();
  }, [update, contentKey]);

  useEffect(() => {
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  const from = fadeFrom[variant];

  return (
    <div className={cn("relative min-w-0 w-full", className)}>
      <div
        ref={ref}
        onScroll={update}
        className={cn("min-w-0 w-full overflow-x-auto [scrollbar-gutter:stable]", scrollClassName)}
      >
        {children}
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r to-transparent transition-opacity duration-300 ease-out",
          from,
          showLeft ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l to-transparent transition-opacity duration-300 ease-out",
          from,
          showRight ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
    </div>
  );
}
