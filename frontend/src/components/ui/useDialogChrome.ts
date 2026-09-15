import { createContext, useContext, useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * How deeply nested this dialog is. 0 outside any dialog, 1 for the first,
 * 2 for a picker the first one opened.
 *
 * It is a context rather than mount order, and that distinction is the whole
 * fix: React runs CHILD effects before parent ones, so a dialog nested inside
 * another registers FIRST and the outer one registers last. Ordering by
 * registration therefore puts the outer dialog on top — the exact opposite of
 * what is on screen, and the reason one Escape closed the form under the map
 * picker instead of the picker.
 */
export const DialogDepthContext = createContext(0);

/** Every open dialog by depth, so the innermost can be found by value. */
const openDepths = new Map<symbol, number>();
/** What `body.overflow` was before the first dialog locked it. */
let overflowBeforeFirst: string | null = null;

interface Options {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** While an action is in flight, Escape must not cancel it. */
  busy?: boolean;
}

/** The depth this dialog sits at — call inside the dialog component. */
export function useDialogDepth(): number {
  return useContext(DialogDepthContext) + 1;
}

/**
 * What every blocking overlay owes the keyboard, in one place.
 *
 * Measured across the frontend on 2026-08-23: 48 full-screen overlays, of
 * which 26 announced themselves as dialogs, 32 closed on a click beside them
 * and 11 closed on Escape. Three closing contracts and an accessibility
 * announcement decided by coin flip — because each overlay brought its own key
 * handling.
 *
 * Both frames call this, which is what makes them one shell with two cuts
 * rather than two shells. It does four things, and each is here because
 * leaving it out was a measured defect somewhere:
 *
 * 1. **Escape closes the TOP dialog only** — and not while it is `busy`,
 *    because cancelling a save in flight leaves the user with no idea whether
 *    it happened.
 * 2. **Tab is trapped.** Without it Tab walks out of the panel and into the
 *    page behind the scrim, where every control looks disabled and none is.
 * 3. **The page behind does not scroll**, and it scrolls again once the LAST
 *    dialog closes.
 * 4. **Focus returns to the opener.** Without it, dismissing drops focus onto
 *    `<body>` and the next Tab starts from the top of the page.
 *
 * Points 1 and 3 say "top" and "last" because of a defect measured in the
 * browser on 2026-09-15, the day this hook was written. With a per-dialog
 * Escape listener, one keypress closed the map picker AND the place form
 * underneath it, discarding a half-filled form the user never asked to leave.
 * "Top" is decided by nesting depth, NOT by which dialog registered last —
 * see `DialogDepthContext` for why those are opposites.
 * And with a per-dialog scroll lock, the second dialog saved the value the
 * first had already set — so closing both restored `hidden`, and the page
 * could not be scrolled again at all. Neither is visible to a unit test:
 * both need two dialogs open at once, which only happens when a form opens a
 * picker.
 *
 * It deliberately does NOT focus the first control: a dialog that opens with
 * the destructive button focused is a trap for a stray Enter. The panel takes
 * focus itself, and the caller gives it `tabIndex={-1}`.
 */
export function useDialogChrome({
  open,
  onClose,
  panelRef,
  busy = false,
  depth,
}: Options & { depth: number }): void {
  useEffect(() => {
    if (!open) return;
    const id = Symbol("dialog");
    openDepths.set(id, depth);
    if (openDepths.size === 1) {
      overflowBeforeFirst = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const restoreTo = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
      // Only the innermost dialog answers the keyboard. Every open dialog has
      // a listener on `document`, so without this each of them would act on
      // the same keypress.
      if (depth < Math.max(...openDepths.values())) return;

      if (event.key === "Escape") {
        if (!busy) onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openDepths.delete(id);
      if (openDepths.size === 0) {
        document.body.style.overflow = overflowBeforeFirst ?? "";
        overflowBeforeFirst = null;
      }
      restoreTo?.focus?.();
    };
  }, [open, onClose, busy, panelRef, depth]);
}
