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
 *
 * Two rules for callers (rollout):
 * - A dialog's `onClose` must NOT navigate. A discard after Back has already
 *   gone back; an `onClose` that also navigates sends the user somewhere
 *   twice.
 * - A save that moves on to another page navigates through
 *   `navigateAfterSave`, never `navigate` directly — see there.
 */

export const HISTORY_SENTINEL_KEY = "__travstatsUnsavedChanges";

export interface DirtyRegistration {
  /** The user pressed Back: ask the discard question. */
  askFromHistory: () => void;
  /** A save is running: Back is held, but not answered with a question. */
  isBusy: () => boolean;
  /** The dialog's panel, to find the dialog ON TOP — see `topmost`. */
  panel: () => HTMLElement | null;
}

const registered: DirtyRegistration[] = [];
/** We believe the current history entry is our sentinel. */
let sentinelOnTop = false;
let listeningToPop = false;
let beforeUnloadAttached = false;
let removalScheduled = false;

/**
 * "The next `popstate` is one WE caused" — a flag, not a count, and it clears
 * itself. A count went wrong in exactly the owner's setting (fix round 2): a
 * `history.go(-2)` with nothing two steps back fires NO popstate, so the count
 * stayed at 1 forever and swallowed the user's next real Back — the form
 * behind it was lost. A flag is cleared by the next pop or, if none comes,
 * by a timer; it can never outlive the navigation that set it by more than
 * that.
 */
let ownNavigation: { settle: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
let ownNavigationDone: Promise<void> = Promise.resolve();
const OWN_NAVIGATION_WINDOW_MS = 1000;

function settleOwnNavigation(): void {
  if (ownNavigation === null) return;
  clearTimeout(ownNavigation.timer);
  const { settle } = ownNavigation;
  ownNavigation = null;
  settle();
}

function navigateOurselves(step: number): void {
  settleOwnNavigation();
  ownNavigationDone = new Promise<void>((resolve) => {
    ownNavigation = {
      settle: resolve,
      timer: setTimeout(settleOwnNavigation, OWN_NAVIGATION_WINDOW_MS),
    };
  });
  window.history.go(step);
}

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

/**
 * The dirty dialog ON TOP, decided the way Escape decides it
 * (`useDialogChrome`): the one whose scrim comes last in the document, which
 * is the one painted over the others. Not "the one that became dirty last" —
 * typing into the form underneath a picker must not make Back ask the form
 * while the picker covers it. Without DOM information, the later registration.
 */
function topmost(): DirtyRegistration | undefined {
  let best: DirtyRegistration | undefined;
  let bestScrim: Element | null = null;
  for (const entry of registered) {
    const scrim = entry.panel()?.closest(".ts-dialog-scrim") ?? null;
    const later =
      best === undefined ||
      (scrim !== null &&
        (bestScrim === null ||
          Boolean(bestScrim.compareDocumentPosition(scrim) & Node.DOCUMENT_POSITION_FOLLOWING))) ||
      (scrim === null && bestScrim === null);
    if (later) {
      best = entry;
      bestScrim = scrim;
    }
  }
  return best;
}

function onPopState(): void {
  if (ownNavigation !== null) {
    settleOwnNavigation();
    return;
  }
  if (!sentinelOnTop || currentStateIsSentinel()) return;
  const top = topmost();
  if (!top) {
    sentinelOnTop = false;
    return;
  }
  // The user left the sentinel. Put it back first, so that a second Back
  // while the question is open is caught too — and so that a Back during a
  // save is HELD: no question (the save may be about to end the guard), but
  // no leaving either.
  pushSentinel();
  if (!top.isBusy()) top.askFromHistory();
}

/**
 * The guard ends: take the sentinel away without navigating anywhere and
 * without asking. Deferred, and skipped if anything registered meanwhile:
 * StrictMode (dev) unmounts and re-mounts every effect in one commit, and an
 * immediate `back()` there raced the re-registration — leaving a stale entry
 * on top and the first Back unanswered (fix round 2).
 */
function scheduleRemoval(): void {
  if (removalScheduled) return;
  removalScheduled = true;
  queueMicrotask(() => {
    removalScheduled = false;
    if (registered.length > 0) return;
    if (beforeUnloadAttached) {
      window.removeEventListener("beforeunload", onBeforeUnload);
      beforeUnloadAttached = false;
    }
    if (sentinelOnTop && currentStateIsSentinel()) navigateOurselves(-1);
    sentinelOnTop = false;
  });
}

/** Called when a dialog becomes dirty (and stays open). Returns the unregister. */
export function registerDirtyDialog(entry: DirtyRegistration): () => void {
  registered.push(entry);
  if (!beforeUnloadAttached) {
    window.addEventListener("beforeunload", onBeforeUnload);
    beforeUnloadAttached = true;
  }
  if (!listeningToPop) {
    // Never removed: our own navigations resolve asynchronously, and their
    // popstate must still find someone to recognise it.
    window.addEventListener("popstate", onPopState);
    listeningToPop = true;
  }
  if (!sentinelOnTop) pushSentinel();
  return () => {
    const index = registered.indexOf(entry);
    if (index >= 0) registered.splice(index, 1);
    if (registered.length === 0) scheduleRemoval();
  };
}

/**
 * "Verwerfen" on a question that a Back raised: go where the user was going —
 * past the sentinel we re-armed AND the entry their Back had landed on.
 *
 * How far that is comes from the history itself, never from an assumption:
 * the sentinel was just re-pushed, so nothing lies ahead of it and the current
 * index is `length - 1`. Two steps back exist only from a length of 3. With 2,
 * the page itself is the oldest entry (a fresh tab, a home-screen app): one
 * step lands on it and the dialog closes — there is nowhere further to go.
 * With 1 there is no step at all, and the sentinel is simply forgotten.
 *
 * `beforeunload` is let go first: if the step leaves the document, the
 * browser must not ask a second time what the user just answered.
 */
export function leaveThroughHistory(): void {
  sentinelOnTop = false;
  if (beforeUnloadAttached) {
    window.removeEventListener("beforeunload", onBeforeUnload);
    beforeUnloadAttached = false;
  }
  const length = window.history.length;
  const step = length >= 3 ? -2 : length >= 2 ? -1 : 0;
  if (step !== 0) navigateOurselves(step);
}

type Navigate = (to: string, options?: { replace?: boolean }) => void | Promise<void>;

/**
 * Leave the page after a successful save, for a form that moves on (to the
 * new record's page, say) instead of closing.
 *
 * A plain `navigate` raced the guard: the save ends "dirty", the sentinel's
 * removal is a `history.back()` that resolves LATER, and by then `navigate`
 * had pushed the new page on top — so the late back() landed the user on the
 * form's page again, or left a dead entry their next Back stumbled into.
 *
 * Here: while the sentinel is the current entry, the new page REPLACES it, so
 * the history reads "form page, new page" and one Back leaves the new page
 * normally. If a removal is already under way, it is awaited first.
 */
export async function navigateAfterSave(navigate: Navigate, to: string): Promise<void> {
  if (sentinelOnTop && currentStateIsSentinel()) {
    sentinelOnTop = false;
    await navigate(to, { replace: true });
    return;
  }
  await ownNavigationDone;
  await navigate(to);
}
