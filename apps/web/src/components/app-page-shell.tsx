import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 与侧栏菜单一一对应，各页顶部渐变配色不同。 */
export type AppPageShellVariant =
  | "home"
  | "overview"
  | "traces"
  | "logs"
  | "analytics"
  | "machines"
  | "alerts"
  | "settings";

export function AppPageShell({
  variant,
  className,
  children,
}: {
  variant: AppPageShellVariant;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("ca-page-bg", `ca-page-bg--${variant}`, className)}>{children}</div>;
}
