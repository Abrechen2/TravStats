import { useEffect, useRef } from "react";
import type { JSX, ReactNode } from "react";

/**
 * The frame every blocking dialog sits in.
 *
 * Measured across the frontend on 23.08.: 48 full-screen overlays, of which 26
 * announced themselves as dialogs, 32 closed on a click beside them, and 11
 * closed on Escape. Three different closing contracts and an accessibility
 * announcement decided by coin flip — because each dialog brought its own
 * backdrop, its own key handling and its own idea of what a dialog is.
 *
 * `ConfirmModal` is a specific dialog (a question with two answers), not a
 * frame, so it could never absorb the others. This is the frame.
 *
 * **Not every overlay belongs in here.** Menus, popovers and the achievement
 * toast are overlays without being dialogs — Escape and a focus trap are wrong
 * for them. The 48 is an upper bound, not a work list.
 *
 * Two details that look like decoration and are not:
 *
 * 1. The backdrop is `fixed`, which outranks an unpositioned sibling in the
 *    stacking order regardless of DOM order — so the panel carries its own
 *    `relative z-10`. Without it the backdrop covers the buttons: every click
 *    lands on the backdrop, which closes the dialog, so confirming *looks*
 *    like it worked while nothing happens. That shipped once, invisible for
 *    months, and was found in the 2.6.0-rc.9 browser UAT. Verify changes here
 *    in a browser: `document.elementFromPoint` on a button's centre must
 *    return the button.
 * 2. Focus moves into the panel on open and returns to the element that opened
 *    it on close. Without the return, dismissing a dialog drops keyboard focus
 *    onto `<body>` and the next Tab starts from the top of the page.
 */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered as the dialog's accessible name. */
  title: ReactNode;
  children: ReactNode;
  /** The action row. Omit for a dialog that is only read. */
  footer?: ReactNode;
  /** Blocks Escape and the backdrop while an action is in flight. */
  busy?: boolean;
  /** Tailwind width class for the panel. */
  widthClass?: string;
  /** The × in the header. On by default: Escape and a click beside it both
   *  close the dialog, but neither is discoverable by looking at it. */
  showClose?: boolean;
  /** Accessible name for the ×. */
  closeLabel?: string;
  testId?: string;
}

let idCounter = 0;

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  busy = false,
  widthClass = "max-w-lg",
  showClose = true,
  closeLabel = "Close",
  testId,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const titleIdRef = useRef<string>("");
  if (titleIdRef.current === "") {
    idCounter += 1;
    titleIdRef.current = `modal-title-${idCounter}`;
  }

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    // Focus the panel itself rather than guessing at a first control: a
    // dialog that opens with the destructive button focused is a trap.
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);

    // The page behind must not scroll away under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" data-testid={testId}>
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          data-testid="modal-backdrop"
          className="fixed inset-0 bg-black/70 transition-opacity"
          onClick={() => {
            if (!busy) onClose();
          }}
        />

        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleIdRef.current}
          className={`relative z-10 flex max-h-[90vh] w-full ${widthClass} flex-col overflow-hidden rounded-lg shadow-xl outline-none`}
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          {/* Header and footer stay put; only the body scrolls. A tall form —
              the lodging one grows the moment its map picker opens — used to
              push its own save button off the screen with nothing to scroll. */}
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
            <h2
              id={titleIdRef.current}
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {title}
            </h2>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label={closeLabel}
                className="-mr-1 shrink-0 rounded-sm p-1 disabled:opacity-50"
                style={{ color: "var(--text-muted)" }}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-4">{children}</div>
          {footer && (
            <div
              className="flex shrink-0 flex-wrap justify-end gap-2 px-5 py-3"
              style={{ background: "var(--bg-base)", borderTop: "1px solid var(--color-border)" }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
