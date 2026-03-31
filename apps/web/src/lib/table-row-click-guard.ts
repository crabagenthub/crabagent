/**
 * Guard row-level click handlers from interactive descendants.
 * This keeps row navigation and inner action controls from conflicting.
 */
export function shouldIgnoreRowClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      "[data-row-click-stop],button,a,input,textarea,select,[role='button'],[role='menuitem']",
    ),
  );
}
