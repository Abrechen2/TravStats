import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The close path of a dialog that holds unsaved input (forgejo#248).
 *
 * Every form in the app closed on Escape, on a click beside it and on the ×
 * without a word, and took the draft with it — measured across all eight
 * domains on 2026-10-08. A stray Escape while a long stay was half typed was
 * enough to lose it. This hook is the one place that decides whether a close
 * request closes or asks first; `Modal` and `ui/Dialog` both route Escape, the
 * scrim, the × and their own dismiss button through `requestClose`.
 *
 * - **Unchanged closes at once.** A question on every close teaches people to
 *   click through it, and then it protects nothing.
 * - **`busy` closes not at all**, the existing contract: cancelling a save in
 *   flight leaves the user not knowing whether it happened.
 * - **Changed asks**; the caller renders the question from `question`.
 *
 * In-app navigation is NOT guarded here, and cannot be cheaply: the app mounts
 * `<BrowserRouter>`, not a data router, so react-router's `useBlocker` is not
 * available, and migrating the router for this would touch every route. It
 * matters less than it sounds — the dialog covers the page, so reaching a link
 * means a click on the scrim first, and that click is guarded. A full page
 * unload (reload, closing the tab, typing a URL) is guarded through
 * `beforeunload` below.
 */
export interface DiscardGuard {
  /** Close now, ask first, or ignore — see above. */
  requestClose: () => void;
  /** True while the "discard changes?" question is on screen. */
  asking: boolean;
  /** "Verwerfen": close and drop the draft. */
  discard: () => void;
  /** "Weiter bearbeiten": stay in the form. */
  keepEditing: () => void;
}

interface Options {
  open: boolean;
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
}

/**
 * How many open dialogs hold unsaved input. One listener for all of them,
 * counted like the scroll lock in `useDialogChrome`: with one listener per
 * dialog a nested picker that closed would remove a listener the form under
 * it still needed.
 */
let dirtyCount = 0;

function onBeforeUnload(event: BeforeUnloadEvent): void {
  // Both, because browsers disagree on which one they read; neither shows our
  // text — every browser substitutes its own fixed sentence.
  event.preventDefault();
  event.returnValue = "";
}

/** Exposed for the test that checks the listener is only there while dirty. */
export function openDirtyDialogCount(): number {
  return dirtyCount;
}

export function useDiscardGuard({ open, dirty, busy, onClose }: Options): DiscardGuard {
  const [asking, setAsking] = useState(false);
  const stateRef = useRef({ dirty, busy, onClose });
  useEffect(() => {
    stateRef.current = { dirty, busy, onClose };
  });

  const guarding = open && dirty;
  useEffect(() => {
    if (!guarding) return;
    dirtyCount += 1;
    if (dirtyCount === 1) window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      dirtyCount -= 1;
      if (dirtyCount === 0) window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [guarding]);

  // A dialog that closed (or saved, which also ends "dirty") must not come
  // back still asking.
  if (asking && !guarding) setAsking(false);

  const requestClose = useCallback((): void => {
    const current = stateRef.current;
    if (current.busy) return;
    if (current.dirty) {
      setAsking(true);
      return;
    }
    current.onClose();
  }, []);

  const discard = useCallback((): void => {
    setAsking(false);
    stateRef.current.onClose();
  }, []);

  const keepEditing = useCallback((): void => setAsking(false), []);

  return { requestClose, asking, discard, keepEditing };
}
