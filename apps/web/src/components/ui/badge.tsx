"use client";

import ArcoTag from "@arco-design/web-react/es/Tag";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import "@/lib/arco-react19-setup";
import { cn } from "@/lib/utils";

const badgeVariants = cva("", {
  variants: {
    variant: {
      default: "",
      secondary: "",
      destructive: "",
      outline: "",
      ghost: "",
      link: "",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export type BadgeProps = React.ComponentPropsWithoutRef<typeof ArcoTag> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const color =
    variant === "destructive"
      ? "red"
      : variant === "secondary"
        ? "gray"
        : variant === "outline" || variant === "ghost"
          ? undefined
          : "arcoblue";
  return (
    <ArcoTag
      size="small"
      bordered={variant === "outline"}
      color={color}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
