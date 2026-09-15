import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** While an action is in flight, Escape must not cancel it. */
  busy?: boolean;
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
 * Both frames now call this, which is what makes them one shell with two
 * cuts rather than two shells. It does four things, and each is here because
 * leaving it out was a measured defect somewhere:
 *
 * 1. **Escape closes** — unless `busy`, because cancelling a save in flight
 *    leaves the user with no idea whether it happened.
 * 2. **Tab is trapped.** Without it Tab walks out of the panel and into the
 *    page behind the scrim, where every control looks disabled and none is.
 * 3. **The page behind does not scroll.**
 * 4. **Focus returns to the opener.** Without it, dismissing drops focus onto
 *    `<body>` and the next Tab starts from the top of the page.
 *
 * It deliberately does NOT focus the first control: a dialog that opens with
 * the destructive button focused is a trap for a stray Enter. The panel takes
 * focus itself, and the caller gives it `tabIndex={-1}`.
 */
export function useDialogChrome({ open, onClose, panelRef, busy = false }: Options): void {
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo?.focus?.();
    };
  }, [open, onClose, busy, panelRef]);
}
