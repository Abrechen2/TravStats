import { useRef, type MouseEvent, type RefObject } from "react";

/**
 * Close on a click beside the panel — but only when the press STARTED there.
 *
 * A click event fires on the common ancestor of where the button went down
 * and where it came up. So a drag that starts inside the panel (selecting the
 * text of a field) and ends on the scrim is, to the scrim, a click: the dialog
 * closed and took the form with it (tester report 2026-10-03; the issue is
 * named in `__tests__/scrimDismiss.test.tsx` — an issue reference in this
 * folder reads as a hex colour to the primitives guard).
 * `stopPropagation` on the panel never saw that click, because it does not
 * pass through the panel at all.
 *
 * The flag starts out `true` and is reset to `true` after every click, so a
 * click that arrives without a mousedown of its own — a synthetic one, an
 * assistive tool's — still dismisses as it always did.
 */
export function useScrimDismiss(
  panelRef: RefObject<HTMLElement | null>,
  onDismiss: () => void
): { onMouseDown: (event: MouseEvent) => void; onClick: () => void } {
  const pressStartedOutside = useRef(true);
  return {
    onMouseDown: (event) => {
      const panel = panelRef.current;
      pressStartedOutside.current = !(panel && panel.contains(event.target as Node));
    },
    onClick: () => {
      const outside = pressStartedOutside.current;
      pressStartedOutside.current = true;
      if (outside) onDismiss();
    },
  };
}
