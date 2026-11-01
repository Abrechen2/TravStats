const KEY = "travstats.settings.lastPage";

/**
 * The settings page the account was last on, so a bare `/settings` returns to
 * it (design §6.2). A per-browser convenience: private windows and blocked
 * storage simply mean "no last page", and the first-visit page opens instead.
 */
export function readLastPage(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeLastPage(pageId: string): void {
  try {
    window.localStorage.setItem(KEY, pageId);
  } catch {
    // Storage is a convenience here; the page works without it.
  }
}
