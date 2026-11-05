/**
 * The path an in-app link click would go to, or null when the click is not one
 * a page guard should hold back (modified click, new tab, download, another
 * origin). Shared by every guard that must catch `<Link>` navigation, because
 * the app mounts `<BrowserRouter>` and react-router's `useBlocker` needs a
 * data router.
 */
export function linkClickTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.origin !== window.location.origin) return null;
  return anchor.pathname + anchor.search + anchor.hash;
}

/** Whether `to` is another page than the current one (a hash/query move stays). */
export function leavesCurrentPage(to: string): boolean {
  try {
    return new URL(to, window.location.href).pathname !== window.location.pathname;
  } catch {
    return true;
  }
}
