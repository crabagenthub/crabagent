"use client";

import dynamic from "next/dynamic";
import { SiteNav } from "./site-nav";

// 导出非 SSR 版本的 SiteNav
export const SiteNavNoSSR = dynamic(() => Promise.resolve(SiteNav), {
  ssr: false,
  loading: () => (
    <aside className="site-nav-loading-skeleton flex h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="site-nav-skeleton-header-expanded shrink-0 items-center border-0 justify-between gap-2 px-3 py-3 pb-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-1">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-sidebar-accent/70 ring-1 ring-sidebar-border animate-pulse" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="mb-1 h-4 w-20 rounded bg-sidebar-accent/70 animate-pulse" />
            <div className="h-3 w-16 rounded bg-sidebar-accent/60 animate-pulse" />
          </div>
        </div>
        <div className="h-8 w-8 shrink-0 rounded bg-sidebar-accent/70 animate-pulse" />
      </div>
      <div className="site-nav-skeleton-header-collapsed shrink-0 items-center justify-between gap-1 border-0 px-1.5 py-2.5 pb-4">
        <div className="h-7 w-7 shrink-0 rounded-md bg-sidebar-accent/70 animate-pulse" />
        <div className="h-7 w-7 shrink-0 rounded-md bg-sidebar-accent/70 animate-pulse" />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2">
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="site-nav-skeleton-nav-row flex items-center gap-2.5 px-2.5">
              <div className="h-7 w-7 shrink-0 rounded bg-sidebar-accent/60 animate-pulse" />
              <div className="site-nav-skeleton-nav-label h-4 w-24 rounded bg-sidebar-accent/50 animate-pulse" />
            </div>
          ))}
        </div>
      </nav>
    </aside>
  ),
});

export default SiteNavNoSSR;
