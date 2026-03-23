"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

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

export type MessageHintProps = {
  /** Full hint copy (shown clamped beside the icon and in the tooltip bubble). */
  text: string;
  className?: string;
  textClassName?: string;
  /** Tailwind line-clamp-* or false to hide inline text (icon + tooltip only). */
  clampClass?: "line-clamp-1" | "line-clamp-2" | "line-clamp-3" | "line-clamp-4" | "line-clamp-5" | false;
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
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tipStyle, setTipStyle] = useState<React.CSSProperties>({});

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
        className="max-h-[min(50vh,22rem)] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-left text-[11px] leading-snug text-white shadow-xl ring-1 ring-black/30"
      >
        {text}
      </div>
    ) : null;

  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <button
        ref={btnRef}
        type="button"
        className="relative mt-0.5 shrink-0 rounded-md p-0.5 text-ca-muted outline-none transition hover:bg-neutral-200/80 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-ca-accent/50"
        aria-describedby={open ? `${id}-tip` : undefined}
        aria-label={text}
        title={text}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <ChatBubbleIcon className="h-4 w-4" />
      </button>
      {clampClass ? (
        <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${clampClass} ${textClassName}`}>
          {text}
        </span>
      ) : null}
      {mounted && tipEl ? createPortal(tipEl, document.body) : null}
    </div>
  );
}
