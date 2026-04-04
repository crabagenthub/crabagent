"use client";

import "@/lib/arco-react19-setup";
import { Popover } from "@arco-design/web-react";
import type { CSSProperties } from "react";
import type { Components } from "react-markdown";
import { Markdown } from "@/components/prompt-kit/markdown";
import { cn } from "@/lib/utils";

const markdownComponents: Partial<Components> = {
  pre: ({ children }) => (
    <pre className="my-2 box-border min-w-0 max-w-full overflow-x-auto rounded-lg bg-neutral-50 px-3 py-2 text-[12px] leading-5 text-neutral-800 whitespace-pre">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isInline =
      !props.node?.position?.start.line ||
      props.node?.position?.start.line === props.node?.position?.end.line;

    if (isInline) {
      return (
        <code className={cn("rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800", className)}>
          {children}
        </code>
      );
    }

    return (
      <code className={cn("font-mono text-[12px] text-neutral-800", className)}>
        {children}
      </code>
    );
  },
};

function EmptyDash() {
  return <span className="text-xs text-neutral-400">—</span>;
}

/**
 * Two-line clamp in table cell; hover popover with Markdown when content is long or multiline.
 */
export function ObserveIoPreviewPopoverCell({
  fullText,
  ariaLabel,
  previewClassName,
}: {
  fullText: string;
  ariaLabel: string;
  /** Applied to the clamped preview span (e.g. fixed column width). */
  previewClassName?: string;
}) {
  const full = fullText.trim();
  if (!full) {
    return <EmptyDash />;
  }

  const normalized = full.replace(/\s+/g, " ").trim();
  const needsPopover = full.includes("\n") || normalized.length > 72;

  const body = (
    <span
      aria-label={ariaLabel}
      className={cn(
        "block min-w-0 whitespace-normal break-words text-xs leading-snug text-neutral-800",
        previewClassName,
      )}
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {full}
    </span>
  );

  if (!needsPopover) {
    return body;
  }

  /** 滚动约束在气泡根节点（Trigger 合并到 `arco-popover-content`），避免内层 max-height 不生效导致内容溢出 */
  const popoverPopupStyle: CSSProperties = {
    maxWidth: "min(100vw - 2rem, 28rem)",
    maxHeight: "min(70vh, 28rem)",
    overflowY: "auto",
    overflowX: "auto",
    overscrollBehavior: "contain",
    boxSizing: "border-box",
    padding: 0,
    WebkitOverflowScrolling: "touch",
  };

  return (
    <Popover
      trigger="hover"
      position="top"
      triggerProps={{ popupStyle: popoverPopupStyle }}
      content={
        <div className="box-border min-w-0 max-w-full p-3">
          <Markdown
            className={cn(
              "min-w-0 max-w-full text-xs leading-5 text-neutral-800 [overflow-wrap:anywhere] [word-break:break-word]",
              "[&>div]:min-w-0",
              "[&_p]:my-0 [&_p]:min-w-0 [&_p]:max-w-full [&_p]:whitespace-pre-wrap [&_p]:break-words [&_p+*]:mt-2",
              "[&_ul]:my-2 [&_ol]:my-2 [&_li]:min-w-0 [&_li]:max-w-full [&_li]:break-words [&_li]:leading-5",
              "[&_blockquote]:min-w-0 [&_blockquote]:max-w-full [&_blockquote]:break-words",
              "[&_table]:block [&_table]:w-max [&_table]:max-w-none",
              "[&_pre]:my-2 [&_pre]:min-w-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-neutral-200",
              "[&_code]:break-words",
            )}
            components={markdownComponents}
          >
            {full}
          </Markdown>
        </div>
      }
    >
      <span className="block min-w-0 cursor-default" data-row-click-stop>
        {body}
      </span>
    </Popover>
  );
}
