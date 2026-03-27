"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul data-slot="pagination-content" className={cn("flex flex-row flex-wrap items-center gap-1", className)} {...props} />
  );
}

function PaginationItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" className={cn("", className)} {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<VariantProps<typeof buttonVariants>, "size"> &
  React.ComponentProps<typeof Button>;

function PaginationLink({ className, isActive, size = "icon", type = "button", ...props }: PaginationLinkProps) {
  return (
    <Button
      type={type}
      aria-current={isActive ? "page" : undefined}
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={cn(
        size === "icon" && "min-w-9",
        size === "default" && "min-w-9 px-2",
        className,
      )}
      {...props}
    />
  );
}

function PaginationPrevious({
  className,
  text,
  "aria-label": ariaLabel = "Go to previous page",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label={ariaLabel}
      size="default"
      className={cn("gap-1 px-2.5 sm:pr-2.5", className)}
      {...props}
    >
      <ChevronLeft className="size-4" />
      {text ? <span className="hidden sm:inline">{text}</span> : null}
    </PaginationLink>
  );
}

function PaginationNext({
  className,
  text,
  "aria-label": ariaLabel = "Go to next page",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label={ariaLabel}
      size="default"
      className={cn("gap-1 px-2.5 sm:pl-2.5", className)}
      {...props}
    >
      {text ? <span className="hidden sm:inline">{text}</span> : null}
      <ChevronRight className="size-4" />
    </PaginationLink>
  );
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4 text-muted-foreground" />
      <span className="sr-only">More pages</span>
    </span>
  );
}

function PaginationFirst({
  className,
  "aria-label": ariaLabel = "First page",
  ...props
}: Omit<PaginationLinkProps, "children" | "size">) {
  return (
    <PaginationLink size="icon" className={className} aria-label={ariaLabel} {...props}>
      <ChevronsLeft className="size-4" />
    </PaginationLink>
  );
}

function PaginationLast({
  className,
  "aria-label": ariaLabel = "Last page",
  ...props
}: Omit<PaginationLinkProps, "children" | "size">) {
  return (
    <PaginationLink size="icon" className={className} aria-label={ariaLabel} {...props}>
      <ChevronsRight className="size-4" />
    </PaginationLink>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationFirst,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
