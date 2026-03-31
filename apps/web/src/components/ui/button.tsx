"use client";

import ArcoButton from "@arco-design/web-react/es/Button";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import "@/lib/arco-react19-setup";
import { cn } from "@/lib/utils";

type ArcoButtonVisual = Pick<React.ComponentProps<typeof ArcoButton>, "type" | "status" | "size" | "iconOnly">;

/**
 * Tailwind 配方：给 `LocalizedLink`、Dropdown 触发器等非 Arco `Button` 的场景复用同一套尺寸/描边。
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function mapVariantToArco(variant: VariantProps<typeof buttonVariants>["variant"]): Pick<ArcoButtonVisual, "type" | "status"> {
  switch (variant) {
    case "outline":
      return { type: "outline", status: "default" };
    case "secondary":
      return { type: "secondary", status: "default" };
    case "ghost":
      return { type: "text", status: "default" };
    case "destructive":
      return { type: "outline", status: "danger" };
    case "link":
      return { type: "text", status: "default" };
    default:
      return { type: "primary", status: "default" };
  }
}

function mapSizeToArco(size: VariantProps<typeof buttonVariants>["size"]): Pick<ArcoButtonVisual, "size" | "iconOnly"> {
  switch (size) {
    case "xs":
      return { size: "mini", iconOnly: false };
    case "sm":
      return { size: "small", iconOnly: false };
    case "lg":
      return { size: "large", iconOnly: false };
    case "icon":
      return { size: "default", iconOnly: true };
    case "icon-xs":
      return { size: "mini", iconOnly: true };
    case "icon-sm":
      return { size: "small", iconOnly: true };
    case "icon-lg":
      return { size: "large", iconOnly: true };
    default:
      return { size: "default", iconOnly: false };
  }
}

export type ButtonProps = Omit<React.ComponentPropsWithoutRef<"button">, "type"> &
  VariantProps<typeof buttonVariants> & {
    type?: "button" | "submit" | "reset";
    htmlType?: "button" | "submit" | "reset";
    loading?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      type = "button",
      htmlType,
      loading,
      ...props
    },
    ref,
  ) => {
    const { type: arcoType, status } = mapVariantToArco(variant);
    const { size: arcoSize, iconOnly } = mapSizeToArco(size);
    const mergedClass = cn(
      variant === "link" && "underline-offset-4 hover:underline",
      className,
    );
    return (
      <ArcoButton
        ref={ref as React.Ref<unknown>}
        className={mergedClass}
        htmlType={htmlType ?? type}
        type={arcoType}
        status={status}
        size={arcoSize}
        iconOnly={iconOnly}
        loading={loading}
        {...(props as Record<string, unknown>)}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
