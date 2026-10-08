import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { leaveThroughHistory, registerDirtyDialog } from "./unsavedChanges";

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
 * Leaving the PAGE is guarded too, through `unsavedChanges`: `beforeunload`
 * for a reload or closing the tab, and a history sentinel for the browser's
 * Back (button, Alt+←, the iPad's swipe), which asks this same question.
 * In-app links need no guard of their own: the dialog covers the page, so
 * reaching one means a click on the scrim first, and that click is guarded.
 * Not covered: a reload or tab close on iOS Safari (it ignores
 * `beforeunload`), and a jump several entries back through the long-press
 * history menu.
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
  /**
   * The dialog's panel. With it, "Weiter bearbeiten" hands focus back to the
   * field the user was in — see `keepEditing`.
   */
  panelRef?: RefObject<HTMLElement | null>;
}

export function useDiscardGuard({ open, dirty, busy, onClose, panelRef }: Options): DiscardGuard {
  const [asking, setAsking] = useState(false);
  const stateRef = useRef({ dirty, busy, onClose });
  useEffect(() => {
    stateRef.current = { dirty, busy, onClose };
  });

  /** The open question came from the browser's Back, not from a close. */
  const fromHistory = useRef(false);

  // Where focus goes back to after "Weiter bearbeiten". Without this it went
  // to <body> after a click beside the form: the press on the scrim blurs the
  // field BEFORE the question opens, so the question's own focus return had
  // nothing better to return to, and the next keystroke went nowhere. So the
  // last element focused inside the panel is remembered as it happens.
  const lastFocused = useRef<HTMLElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const restorePending = useRef(false);
  useEffect(() => {
    const panel = panelRef?.current;
    if (!open || !panel) return;
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    panel.addEventListener("focusin", onFocusIn);
    return () => panel.removeEventListener("focusin", onFocusIn);
  }, [open, panelRef]);

  const rememberFocus = useCallback((): void => {
    const panel = panelRef?.current ?? null;
    const active = document.activeElement;
    returnTo.current =
      panel && active instanceof HTMLElement && active !== panel && panel.contains(active)
        ? active
        : lastFocused.current;
  }, [panelRef]);

  // Runs after the question's own focus return (an unmounting child's effects
  // are cleaned up before a parent's effects run), so this one has the last word.
  useEffect(() => {
    if (asking || !restorePending.current) return;
    restorePending.current = false;
    const target = returnTo.current;
    if (target?.isConnected) target.focus();
  }, [asking]);

  const guarding = open && dirty;
  useEffect(() => {
    if (!guarding) return;
    return registerDirtyDialog({
      askFromHistory: () => {
        fromHistory.current = true;
        rememberFocus();
        setAsking(true);
      },
    });
  }, [guarding, rememberFocus]);

  // A dialog that closed (or saved, which also ends "dirty") must not come
  // back still asking.
  if (asking && !guarding) setAsking(false);

  const requestClose = useCallback((): void => {
    const current = stateRef.current;
    if (current.busy) return;
    if (current.dirty) {
      rememberFocus();
      setAsking(true);
      return;
    }
    current.onClose();
  }, [rememberFocus]);

  const discard = useCallback((): void => {
    setAsking(false);
    if (fromHistory.current) {
      fromHistory.current = false;
      leaveThroughHistory();
    }
    stateRef.current.onClose();
  }, []);

  const keepEditing = useCallback((): void => {
    fromHistory.current = false;
    restorePending.current = true;
    setAsking(false);
  }, []);

  return { requestClose, asking, discard, keepEditing };
}
