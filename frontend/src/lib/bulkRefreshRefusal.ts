/**
 * Which account the server has already refused a bulk-refresh preview for.
 *
 * `rejectDemoQuota` (backend `middleware/demoGuard.ts`) refuses every
 * `isDemo` account — the preview instances' own admin and the local dev admin
 * among them — and only `isSharedDemo` reaches the frontend, so the first 403
 * is the only way to learn about the others. Remembering it stops
 * `/settings/account` asking again on every visit.
 *
 * **Keyed by user id, and cleared on logout.** The first cut was a single
 * tab-global key, which is the defect `authStore.clearSession` already carries
 * a paragraph about: logout and login are SPA navigations, no page reload, so
 * whatever a module remembers survives the change of account. A demo account
 * logging out and a real one logging in inside the same tab would have
 * inherited the refusal and never been offered the bulk refresh at all
 * (review, 2026-09-19). Both halves are needed: the id keeps two accounts
 * apart, and the clear-on-logout keeps the store from growing a row per
 * account that ever signed in here.
 *
 * `sessionStorage`, not `localStorage`: this belongs to the tab and the
 * session, never to the machine.
 */
const KEY_PREFIX = "travstats:bulkRefresh:quotaRefused:";

export function wasQuotaRefused(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return window.sessionStorage.getItem(KEY_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

export function rememberQuotaRefused(userId: string | undefined): void {
  if (!userId) return;
  try {
    window.sessionStorage.setItem(KEY_PREFIX + userId, "1");
  } catch {
    // Private window / storage disabled — the request simply goes again.
  }
}

/** Called from the auth store on every session end, for every account. */
export function forgetQuotaRefusals(): void {
  try {
    const storage = window.sessionStorage;
    const stale: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(KEY_PREFIX)) stale.push(key);
    }
    // Collected first, removed after: removing inside the loop shifts the
    // indices under it and skips every second key.
    for (const key of stale) storage.removeItem(key);
  } catch {
    // Nothing to clear if the store is unavailable.
  }
}
