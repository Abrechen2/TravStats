/**
 * Recovery for a browser that still runs the PREVIOUS build.
 *
 * Every build renames its chunks (`DashboardPage-<hash>.js`). A tab opened
 * before an update — or one whose `index.html` came from a cache, which on
 * the public instance Cloudflare kept for four hours (forgejo#88 P15) — asks
 * for chunk names the server no longer has, and the view it was opening
 * never appears. One reload fetches the new `index.html` and with it the
 * current chunk names, so that is the first answer.
 *
 * The second answer exists because a reload is not guaranteed to help: if
 * the cached `index.html` is served again, the same chunks fail again, and an
 * unguarded "reload on failure" becomes a reload loop that locks the reader
 * out of the app. So a reload is attempted at most once per
 * `RELOAD_WINDOW_MS`, remembered in sessionStorage (per tab, survives the
 * reload, gone when the tab closes); inside that window the failure is left
 * to surface, and `StaleBundleNotice` says what happened and offers a reload
 * by hand.
 */

/** sessionStorage key holding the epoch ms of the last automatic reload. */
export const STALE_RELOAD_KEY = "ts.staleBundle.reloadedAt";

/** Query parameter that makes the reloaded document URL differ from the cached one. */
export const STALE_RELOAD_PARAM = "ts-reload";

/**
 * How long one automatic reload covers. Long enough that a reload which
 * comes back with the same stale page cannot trigger another one; short
 * enough that the NEXT update, hours later in the same tab, gets its own.
 */
export const RELOAD_WINDOW_MS = 5 * 60 * 1000;

/**
 * The messages browsers use for "a module script / chunk could not be
 * loaded". They are not standardised, so the list is per engine:
 * Chromium, Firefox, Safari, and Vite's own preload helper (`Unable to
 * preload CSS for …`). A chunk URL answered with `index.html` (an SPA
 * fallback) fails on the MIME type instead.
 */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /is not a valid JavaScript MIME type/i,
  /Loading chunk [\w-]+ failed/i,
];

/** True when `error` is the browser failing to load a code chunk. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  if (typeof message !== "string") return false;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export interface RecoveryDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  now: () => number;
  /** Navigates to the given URL, replacing the current history entry. */
  replace: (url: string) => void;
  /** The current URL, the reload target before the cache-busting param. */
  href: string;
}

function defaultDeps(): RecoveryDeps {
  let storage: RecoveryDeps["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Blocked storage (sandboxed frame, strict privacy mode): see below.
  }
  return {
    storage,
    now: () => Date.now(),
    replace: (url) => window.location.replace(url),
    href: window.location.href,
  };
}

/** `href` with a fresh `ts-reload` value, so no cache can answer with the old page. */
export function cacheBustedUrl(href: string, stamp: number): string {
  const url = new URL(href);
  url.searchParams.set(STALE_RELOAD_PARAM, String(stamp));
  return url.toString();
}

/**
 * Reloads the page once if no automatic reload happened within the window.
 * Returns `true` when it navigated (the caller should stop handling the
 * error), `false` when the guard held and the error should surface.
 *
 * Without storage the guard cannot remember anything across the reload, so
 * it never reloads automatically — a missing guard is exactly the loop this
 * file exists to prevent.
 */
export function tryReloadForStaleBundle(deps: RecoveryDeps = defaultDeps()): boolean {
  const { storage, now, replace, href } = deps;
  if (!storage) return false;
  const current = now();
  let last: number;
  try {
    last = Number(storage.getItem(STALE_RELOAD_KEY));
  } catch {
    return false;
  }
  if (Number.isFinite(last) && last > 0 && current - last < RELOAD_WINDOW_MS) return false;
  try {
    storage.setItem(STALE_RELOAD_KEY, String(current));
  } catch {
    return false;
  }
  replace(cacheBustedUrl(href, current));
  return true;
}

/**
 * The reload the reader asks for from the notice: no guard (a person clicked
 * it), but still cache-busted, and it re-arms the automatic one.
 */
export function reloadNowForStaleBundle(deps: RecoveryDeps = defaultDeps()): void {
  const current = deps.now();
  try {
    deps.storage?.setItem(STALE_RELOAD_KEY, String(current));
  } catch {
    // Nothing to remember it in; the reload still happens.
  }
  deps.replace(cacheBustedUrl(deps.href, current));
}

/**
 * Removes the cache-busting parameter again once the new page has booted,
 * so it never ends up in a bookmark or a shared link. Router state is
 * untouched: this runs before React mounts.
 */
export function stripStaleReloadParam(
  location: Pick<Location, "href"> = window.location,
  history: Pick<History, "replaceState" | "state"> = window.history
): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(STALE_RELOAD_PARAM)) return;
  url.searchParams.delete(STALE_RELOAD_PARAM);
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

/**
 * Wires the two places a stale chunk shows up outside React's error
 * boundaries: Vite's `vite:preloadError` (a failed preload of a dynamic
 * import's dependencies) and an unhandled rejection from a bare `import()`.
 * A failing lazy ROUTE is caught by `ErrorBoundary`, which calls the same
 * `tryReloadForStaleBundle`.
 */
export function installStaleBundleRecovery(target: Window = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    // preventDefault stops Vite from re-throwing; only do that when the
    // reload is actually under way, otherwise the error must reach the UI.
    if (tryReloadForStaleBundle()) event.preventDefault();
  });
  target.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason) && tryReloadForStaleBundle()) event.preventDefault();
  });
}
