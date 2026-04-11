"use client";

import "@/lib/arco-react19-setup";
import { Tooltip } from "@arco-design/web-react";
import { IconMessage, IconQuestionCircle } from "@arco-design/web-react/icon";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function ChatBubbleIcon({ className }: { className?: string }) {
  return <IconMessage className={className} />;
}

type HintTooltipButtonProps = {
  text: string;
  ariaLabel: string;
  children: ReactNode;
  buttonClassName?: string;
  tooltipClassName?: string;
  tooltipStyle?: CSSProperties;
};

/**
 * Icon button with hover/focus tooltip portaled to `document.body` (avoids overflow clipping).
 */
export function HintTooltipButton({
  text,
  ariaLabel,
  children,
  buttonClassName = "",
  tooltipClassName = "max-h-[min(50vh,22rem)] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-left text-[11px] leading-snug text-white shadow-xl ring-1 ring-black/30",
  tooltipStyle: tooltipStyleExtra,
}: HintTooltipButtonProps) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tipStyle, setTipStyle] = useState<CSSProperties>({});

  useEffect(() => setMounted(true), []);

  const positionTip = () => {
    const el = btnRef.current;
    if (!el || typeof window === "undefined") {
      return;
    }
    const r = el.getBoundingClientRect();
    const maxW = Math.min(448, window.innerWidth - 16);
    let left = r.left;
    if (left + maxW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - maxW - 8);
    }
    const gap = 6;
    const preferBelow = r.bottom + gap + 160 < window.innerHeight;
    const top = preferBelow ? r.bottom + gap : Math.max(8, r.top - gap - 8);
    setTipStyle({
      position: "fixed",
      top,
      left,
      maxWidth: maxW,
      zIndex: 9999,
      transform: preferBelow ? undefined : "translateY(-100%)",
      ...tooltipStyleExtra,
    });
  };

  const show = () => {
    positionTip();
    setOpen(true);
  };
  const hide = () => setOpen(false);

  const tipEl =
    open && mounted && text.trim().length > 0 ? (
      <div
        role="tooltip"
        id={`${id}-tip`}
        style={tipStyle}
        className={tooltipClassName}
      >
        {text}
      </div>
    ) : null;

  return (
    <>
      <Button
        ref={btnRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className={buttonClassName}
        aria-describedby={open ? `${id}-tip` : undefined}
        aria-label={ariaLabel}
        title={text}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </Button>
      {mounted && tipEl ? createPortal(tipEl, document.body) : null}
    </>
  );
}

export type TitleHintIconProps = {
  /** Tooltip body (whitespace preserved). Empty / whitespace-only hides the control. */
  tooltipText: string;
  /** Defaults to `tooltipText`. */
  "aria-label"?: string;
  className?: string;
  iconClassName?: string;
  /** Extra classes for the portaled tooltip panel. */
  tooltipClassName?: string;
  /** Merged into the portaled tooltip `style` (e.g. maxWidth). */
  tooltipStyle?: CSSProperties;
};

/**
 * Arco「问号圈」帮助图标；文案通过 Tooltip 展示（通常 `t("…")`）。
 */
export function TitleHintIcon({
  tooltipText,
  "aria-label": ariaLabel,
  className = "",
  iconClassName = "h-4 w-4",
  tooltipClassName,
  tooltipStyle,
}: TitleHintIconProps) {
  if (!tooltipText.trim()) {
    return null;
  }
  const label = (ariaLabel ?? tooltipText).trim();
  return (
    <Tooltip
      content={
        <span
          className={cn(
            "block max-h-[min(50vh,22rem)] max-w-md overflow-y-auto whitespace-pre-wrap break-words text-left text-[12px] leading-snug text-white",
            tooltipClassName,
          )}
          style={tooltipStyle}
        >
          {tooltipText}
        </span>
      }
      position="top"
      trigger={["hover", "focus"]}
      getPopupContainer={() => document.body}
      color="#1d2129"
    >
      <button
        type="button"
        className={cn(
          "group relative inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0.5 outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
        aria-label={label}
      >
        <IconQuestionCircle
          className={cn(
            "shrink-0 text-muted-foreground transition-colors group-hover:text-foreground",
            iconClassName,
          )}
          aria-hidden
        />
      </button>
    </Tooltip>
  );
}

export type MessageHintProps = {
  /** Full hint copy (shown clamped beside the icon and in the tooltip bubble). */
  text: string;
  className?: string;
  textClassName?: string;
  /** Tailwind line-clamp-* or false to hide inline text (icon + tooltip only). */
  clampClass?:
    | "line-clamp-1"
    | "line-clamp-2"
    | "line-clamp-3"
    | "line-clamp-4"
    | "line-clamp-5"
    | "line-clamp-6"
    | false;
};

/**
 * Message-style icon with a hover/focus tooltip (portaled to `document.body` to avoid overflow clipping).
 */
export function MessageHint({
  text,
  className = "",
  textClassName = "text-xs leading-snug text-ca-muted",
  clampClass = "line-clamp-4",
}: MessageHintProps) {
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <HintTooltipButton
        text={text}
        ariaLabel={text}
        buttonClassName="relative mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChatBubbleIcon className="h-4 w-4" />
      </HintTooltipButton>
      {clampClass ? (
        <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${clampClass} ${textClassName}`}>
          {text}
        </span>
      ) : null}
    </div>
  );
}
