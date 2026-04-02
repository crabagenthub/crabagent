/** Keys for `SiteNav` persisted UI; keep in sync with any inline init script in layout. */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "crabagent-sidebar-collapsed";
export const SIDEBAR_BOTTOM_EXPANDED_STORAGE_KEY = "crabagent-sidebar-bottom-expanded";

/** Client-only: `SiteNav` 非 SSR，首帧可用，避免先展开再折叠。 */
export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function readSidebarBottomExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SIDEBAR_BOTTOM_EXPANDED_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
