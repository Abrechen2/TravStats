/**
 * What guards unsaved input against leaving the PAGE, shared by every dirty
 * dialog (forgejo#248, review fix round 1).
 *
 * Two mechanisms, one registry, because both must exist exactly once however
 * many dialogs are dirty — with one per dialog, a nested picker that closed
 * would tear down a guard the form underneath still needed:
 *
 * 1. **`beforeunload`** — a reload, closing the tab, typing a URL. The browser
 *    asks in its own words. iOS Safari ignores it entirely; nothing can be
 *    done about that from a page.
 * 2. **A history sentinel** — the browser's Back (button, Alt+←, the iPad's
 *    swipe) fires `popstate`, which `<BrowserRouter>` follows, unmounting the
 *    form without asking. react-router's `useBlocker` would catch it, but it
 *    needs a data router and this app mounts `<BrowserRouter>`. So while
 *    anything is dirty, ONE extra entry (same URL, a marker in
 *    `history.state`) sits on top: Back lands on the real entry for the same
 *    URL — the router renders the same page, the form stays — and we put the
 *    sentinel back and ask the top dirty dialog the discard question.
 *    "Verwerfen" then goes back for real, past the sentinel.
 *
 * Not covered: leaving via the long-press history menu several entries at
 * once (it jumps past the sentinel), and a reload or tab close on iOS.
 */

export const HISTORY_SENTINEL_KEY = "__travstatsUnsavedChanges";

export interface DirtyRegistration {
  /** The user pressed Back: ask the discard question. */
  askFromHistory: () => void;
}

const registered: DirtyRegistration[] = [];
/** We believe the current history entry is our sentinel. */
let sentinelOnTop = false;
/** `popstate` events we caused ourselves and must not answer. */
let ownPops = 0;
let listeningToPop = false;

/** How many open dialogs hold unsaved input. */
export function openDirtyDialogCount(): number {
  return registered.length;
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  // Both, because browsers disagree on which one they read; neither shows our
  // text — every browser substitutes its own fixed sentence.
  event.preventDefault();
  event.returnValue = "";
}

function currentStateIsSentinel(): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state?.[HISTORY_SENTINEL_KEY]);
}

function pushSentinel(): void {
  // A copy of the router's own state, so the entry is the same location to
  // it; only the marker is new.
  const state = (window.history.state as Record<string, unknown> | null) ?? {};
  window.history.pushState({ ...state, [HISTORY_SENTINEL_KEY]: true }, "", window.location.href);
  sentinelOnTop = true;
}

function onPopState(): void {
  if (ownPops > 0) {
    ownPops -= 1;
    return;
  }
  if (!sentinelOnTop || currentStateIsSentinel()) return;
  const top = registered[registered.length - 1];
  if (!top) {
    sentinelOnTop = false;
    return;
  }
  // The user left the sentinel. Put it back first, so that a second Back
  // while the question is open is caught too.
  pushSentinel();
  top.askFromHistory();
}

/** Called when a dialog becomes dirty (and stays open). Returns the unregister. */
export function registerDirtyDialog(entry: DirtyRegistration): () => void {
  registered.push(entry);
  if (registered.length === 1) {
    window.addEventListener("beforeunload", onBeforeUnload);
    if (!listeningToPop) {
      // Never removed: our own `history.back()` below resolves asynchronously,
      // and its popstate must still find someone to swallow it.
      window.addEventListener("popstate", onPopState);
      listeningToPop = true;
    }
    pushSentinel();
  }
  return () => {
    const index = registered.indexOf(entry);
    if (index >= 0) registered.splice(index, 1);
    if (registered.length > 0) return;
    window.removeEventListener("beforeunload", onBeforeUnload);
    // Clean again (saved, or discarded through a close): take the sentinel
    // away without navigating anywhere — and without asking about it.
    if (sentinelOnTop && currentStateIsSentinel()) {
      ownPops += 1;
      window.history.back();
    }
    sentinelOnTop = false;
  };
}

/**
 * "Verwerfen" on a question that a Back raised: go where the user was going —
 * past the sentinel we re-armed AND the entry their Back had landed on.
 */
export function leaveThroughHistory(): void {
  sentinelOnTop = false;
  ownPops += 1;
  window.history.go(-2);
}
