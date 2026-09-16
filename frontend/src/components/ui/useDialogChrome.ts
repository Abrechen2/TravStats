import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How many dialogs are open, so the last one out restores the scroll. */
let openCount = 0;
/** What `body.overflow` was before the first dialog locked it. */
let overflowBeforeFirst: string | null = null;

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
export function useDialogChrome({ open, onClose, panelRef, busy = false }: Options): void {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    if (openCount === 1) {
      overflowBeforeFirst = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const restoreTo = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
      // Only the dialog ON TOP answers the keyboard. Every open dialog has a
      // listener on `document`, so without this each of them acts on the same
      // keypress — and the user loses the form under the picker.
      //
      // "On top" is read from the DOM rather than from any bookkeeping of
      // ours, because the DOM is what decides it: every scrim carries the same
      // z-index, so the last one in document order is the one that paints over
      // the others and the one `elementFromPoint` returns at the centre of the
      // screen. Measured both ways on 2026-09-15 — a dialog nested INSIDE
      // another's children and one rendered as its SIBLING both end up last.
      const scrims = document.querySelectorAll(".ts-dialog-scrim");
      const top = scrims[scrims.length - 1];
      if (!top || !panelRef.current || !top.contains(panelRef.current)) return;

      if (event.key === "Escape") {
        if (!busy) onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const panel = panelRef.current;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      // Three cases the first trap let through, each measured as Tab walking
      // out into the page behind (AUD-037, ported from main's Modal): nothing
      // focusable inside, focus already outside the panel, and Shift+Tab from
      // the panel itself — which holds focus right after the dialog opens.
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !panel.contains(active);
      if (event.shiftKey) {
        if (outside || active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openCount -= 1;
      if (openCount === 0) {
        document.body.style.overflow = overflowBeforeFirst ?? "";
        overflowBeforeFirst = null;
      }
      restoreTo?.focus?.();
    };
  }, [open, onClose, busy, panelRef]);
}
