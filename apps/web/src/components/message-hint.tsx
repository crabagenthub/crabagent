"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7 9.5h10M7 13h6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.5 18.5 4 21l2.2-.6c.9-.25 1.85-.4 2.8-.4h8.5a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v7.5c0 1.1.7 2.1 1.75 2.45Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** “?” in a small pill — reads as help, scales with `iconClassName` (default 28×28px). */
function TitleQuestionMarkBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 select-none items-center justify-center rounded-full",
        "border border-neutral-400/50 bg-gradient-to-b from-white to-neutral-100/95",
        "font-semibold leading-none tracking-tight text-neutral-600 tabular-nums antialiased",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] ring-1 ring-black/[0.05]",
        "transition-[color,background-color,border-color,box-shadow] duration-150",
        "group-hover:border-neutral-500/55 group-hover:bg-white group-hover:text-neutral-900 group-hover:shadow-sm",
        className,
      ].join(" ")}
      aria-hidden
    >
      ?
    </span>
  );
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
function HintTooltipButton({
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
      <button
        ref={btnRef}
        type="button"
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
      </button>
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
 * “?” help badge after a page title; tooltip content via props (usually `t("…")`).
 */
export function TitleHintIcon({
  tooltipText,
  "aria-label": ariaLabel,
  className = "",
  iconClassName = "h-7 w-7 text-[13px] md:h-8 md:w-8 md:text-[15px]",
  tooltipClassName,
  tooltipStyle,
}: TitleHintIconProps) {
  if (!tooltipText.trim()) {
    return null;
  }
  const label = (ariaLabel ?? tooltipText).trim();
  return (
    <HintTooltipButton
      text={tooltipText}
      ariaLabel={label}
      tooltipClassName={
        tooltipClassName ??
        "max-h-[min(50vh,22rem)] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-left text-[11px] leading-snug text-white shadow-xl ring-1 ring-black/30 whitespace-pre-wrap break-words"
      }
      tooltipStyle={tooltipStyle}
      buttonClassName={[
        "group relative inline-flex shrink-0 items-center justify-center rounded-full p-0.5 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ca-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        className,
      ].join(" ")}
    >
      <TitleQuestionMarkBadge className={iconClassName} />
    </HintTooltipButton>
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
        buttonClassName="relative mt-0.5 shrink-0 rounded-md p-0.5 text-ca-muted outline-none transition hover:bg-neutral-200/80 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-ca-accent/50"
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
