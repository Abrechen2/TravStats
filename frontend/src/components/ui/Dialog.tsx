import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import IconButton from "./IconButton";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /**
   * ONE action. A dialog that offers two things to do is a dialog that has not
   * decided what it is asking. The dismiss button is not an action.
   */
  action?: ReactNode;
  /** The dismiss label — "Abbrechen" when creating, "Fertig" when editing. */
  dismissLabel?: string;
  /** Accessible name for the close button. */
  closeLabel?: string;
  maxWidth?: number;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One shell for every overlay.
 *
 * The app has `Modal.tsx` in five files and twenty-four further hand-rolled
 * `fixed inset-0` overlays, and no two of them agree on the scrim, the radius,
 * whether Escape closes, or whether focus can leave. This is the shell they
 * migrate onto: `surface2`, radius 26, the sheet shadow mirrored, a scrim
 * derived from `canvas`, a focus trap, Escape, and at most one action.
 *
 * Centred on a desktop and docked to the bottom edge below 640px — same shell,
 * different placement, which is the whole of the difference between the web's
 * dialog and the Companion's sheet.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  action,
  dismissLabel,
  closeLabel = "Schließen",
  maxWidth = 440,
}: DialogProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      // The trap. Without it, Tab walks straight out of the dialog and into
      // the page behind the scrim, where every control is visually disabled
      // and none of them actually is.
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
    // Focus the panel itself rather than its first control: landing on a
    // destructive button is how a stray Enter deletes something.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // Everything about the shell lives in `theme/ui.css`, and only the caller's
    // width comes through as a custom property. Written as inline styles it
    // looked right and was wrong: an inline `align-items: center` outranks any
    // media query, so the dialog stayed centred below 640px instead of docking
    // to the bottom edge as a sheet. Found in the browser, not by a test — the
    // tests were green while it was broken.
    <div className="ts-dialog-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="ts-dialog-panel"
        style={{ "--ts-dialog-max": `${maxWidth}px` } as CSSProperties}
      >
        <div className="flex items-start justify-between" style={{ gap: "var(--ts-space-lg)" }}>
          <div className="t-screen-title" style={{ lineHeight: 1.15 }}>
            {title}
          </div>
          <IconButton
            label={closeLabel}
            onClick={onClose}
            style={{ margin: "-8px -8px 0 0", background: "var(--ts-surface)" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </IconButton>
        </div>

        <div className="t-body" style={{ textWrap: "pretty" }}>
          {children}
        </div>

        {(action || dismissLabel) && (
          <div className="flex flex-wrap justify-end" style={{ gap: "var(--ts-space-md)" }}>
            {dismissLabel ? (
              <button
                type="button"
                onClick={onClose}
                className="ts-button"
                data-variant="secondary"
                style={{
                  height: "var(--ts-size-button-secondary)",
                  padding: "0 var(--ts-space-xl)",
                  borderRadius: "var(--ts-radius-button)",
                  border: "1px solid var(--ts-border-button)",
                  background: "transparent",
                  color: "var(--ts-text)",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                {dismissLabel}
              </button>
            ) : null}
            {action}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
