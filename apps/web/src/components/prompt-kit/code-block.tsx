"use client";

import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export type CodeBlockProps = {
  children?: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

/** Wrapper for fenced code in [prompt-kit](https://github.com/ibelick/prompt-kit) Markdown (no Shiki — lighter bundle for the trace console). */
function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  code: string;
  language?: string;
  className?: string;
} & HTMLAttributes<HTMLDivElement>;

function CodeBlockCode({ code, className, ...props }: CodeBlockCodeProps) {
  return (
    <div
      className={cn("w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4", className)}
      {...props}
    >
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type CodeBlockGroupProps = HTMLAttributes<HTMLDivElement>;

function CodeBlockGroup({ children, className, ...props }: CodeBlockGroupProps) {
  return (
    <div className={cn("flex items-center justify-between", className)} {...props}>
      {children}
    </div>
  );
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock };
