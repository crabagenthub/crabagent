"use client";

import dynamic from "next/dynamic";
import { SiteNav } from "./site-nav";

// 导出非 SSR 版本的 SiteNav
export const SiteNavNoSSR = dynamic(() => Promise.resolve(SiteNav), {
  ssr: false,
  loading: () => (
    <aside className="flex h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar w-[272px] transition-[width] duration-200 ease-out">
      <div className="flex shrink-0 items-center border-0 justify-between gap-2 px-3 py-3 pb-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-1">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-sidebar ring-1 ring-sidebar-border animate-pulse bg-muted" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="h-4 w-20 bg-muted rounded animate-pulse mb-1" />
            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="h-8 w-8 bg-muted rounded animate-pulse" />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2">
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2.5">
              <div className="h-7 w-7 bg-muted rounded animate-pulse" />
              <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      </nav>
    </aside>
  ),
});

export default SiteNavNoSSR;
