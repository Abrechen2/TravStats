import { useRef } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, JSX, ReactNode } from "react";
import { useDialogChrome } from "./ui/useDialogChrome";
import { useScrimDismiss } from "./ui/useScrimDismiss";
import { useDiscardGuard } from "./form/useDiscardGuard";
import { useTranslation } from "../hooks/useTranslation";
import { DELETE_BUTTON_CLASS } from "../lib/deleteConfirm";
import { useCoarsePointer } from "../hooks/useCoarsePointer";

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
 * Since 2026-09-15 it is the SAME shell as `components/ui/Dialog` — same
 * scrim, radius, shadow, entry animation and bottom docking below 640px, and
 * the same keyboard contract from `useDialogChrome`. The difference is the
 * layout and nothing else: `Dialog` is a question with a short body, this is
 * the frame whose body scrolls under a header and a footer that stay put.
 * Two frames that merely looked alike were the drift this round was sent to
 * remove.
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
  /**
   * The action row. Omit for a dialog that is only read.
   *
   * As a function it receives `requestClose` — the guarded close — so a form's
   * own Cancel button asks the same "discard changes?" question as Escape,
   * the scrim and the ×. A Cancel wired straight to `onClose` would be the
   * one close path the guard does not cover.
   */
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  /** Blocks Escape and the backdrop while an action is in flight. */
  busy?: boolean;
  /**
   * The form holds input that is not saved (see `form/useDirtyGuard`). While
   * true, every close path asks "discard changes?" first; while false, they
   * close at once, as before.
   */
  dirty?: boolean;
  /** The confirm label of that question — "Verwerfen" unless a form needs its own word. */
  discardLabel?: string;
  /**
   * The panel's maximum width in pixels, like `Dialog`'s. It was a Tailwind
   * class until 2026-09-15; once the panel moved onto the shared shell that
   * class and the shell's own `max-width` were two rules of equal specificity
   * fighting over source order, which is a coin flip, not a layout.
   */
  maxWidth?: number;
  /** The × in the header. On by default: Escape and a click beside it both
   *  close the dialog, but neither is discoverable by looking at it. */
  showClose?: boolean;
  /**
   * Accessible name for the ×.
   *
   * It must NOT repeat a footer button's label. Two controls with one
   * accessible name is ambiguous to a screen reader, and it broke three tests
   * on 2026-09-15 that could suddenly no longer say which "Abbrechen" they
   * meant. The × is "close"; the footer carries the actions.
   */
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
  dirty = false,
  discardLabel,
  maxWidth = 560,
  showClose = true,
  closeLabel = "Close",
  testId,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleIdRef = useRef<string>("");
  if (titleIdRef.current === "") {
    idCounter += 1;
    titleIdRef.current = `modal-title-${idCounter}`;
  }

  const guard = useDiscardGuard({ open, dirty, busy, onClose, panelRef });
  const { requestClose } = guard;
  // Touch sizing follows the POINTER, not the width (CLAUDE.md, forgejo#249):
  // an iPad is wide and finger-operated, and measured the × at ~28 px and the
  // footer buttons at ~36 px — under the 44 px the design's own sheet uses.
  // The layout stays width-based; only the target sizes grow.
  // Inline actions INSIDE a sentence (SaveBlockedHint's "Name") carry
  // `data-inline-action` and keep their text size: a 44 px link in the middle
  // of a line breaks the line, and WCAG exempts inline targets for that reason.
  const coarse = useCoarsePointer();
  useDialogChrome({ open, onClose: requestClose, panelRef, busy });
  const scrim = useScrimDismiss(panelRef, requestClose);

  if (!open) return null;

  const footerContent = typeof footer === "function" ? footer(requestClose) : footer;

  const frame = createPortal(
    <div className="ts-dialog-scrim" data-testid={testId} {...scrim}>
      <div
        data-testid="modal-backdrop"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0 }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        onClick={(event) => event.stopPropagation()}
        className="ts-dialog-panel relative z-10 flex w-full flex-col"
        data-layout="frame"
        style={{ "--ts-dialog-max": `${maxWidth}px` } as CSSProperties}
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
              onClick={requestClose}
              disabled={busy}
              aria-label={closeLabel}
              className="-mr-1 inline-flex shrink-0 items-center justify-center rounded-sm p-1 disabled:opacity-50"
              style={{
                color: "var(--text-muted)",
                ...(coarse && {
                  minWidth: "var(--ts-size-touch-min)",
                  minHeight: "var(--ts-size-touch-min)",
                }),
              }}
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
        {footerContent && (
          <div
            data-touch={coarse ? "coarse" : undefined}
            className={`flex shrink-0 flex-wrap justify-end gap-2 px-5 py-3 ${
              coarse ? "[&_button:not([data-inline-action])]:min-h-(--ts-size-touch-min)" : ""
            }`}
            style={{ background: "var(--ts-surface)", borderTop: "1px solid var(--ts-border)" }}
          >
            {footerContent}
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  // Rendered BESIDE the frame's portal, not inside it: a React event from the
  // question would otherwise bubble through the frame's scrim handlers, and a
  // click on the question's own scrim would count as a click beside the form.
  // Its portal lands after the form's in the DOM, which is what makes it the
  // top dialog for Escape (see `useDialogChrome`).
  return (
    <>
      {frame}
      {guard.asking && (
        <DiscardQuestion
          onDiscard={guard.discard}
          onKeepEditing={guard.keepEditing}
          discardLabel={discardLabel}
        />
      )}
    </>
  );
}

/**
 * "Änderungen verwerfen?" — drawn by `Modal` itself rather than through
 * `useConfirmDialog`, because that hook renders `ConfirmModal`, which IS a
 * `Modal`: importing it here would close a module cycle (Modal → hook →
 * ConfirmModal → Modal). Same frame, same two-button shape, same red confirm.
 * Exported for `ui/Dialog`, which asks the same question.
 */
export function DiscardQuestion({
  onDiscard,
  onKeepEditing,
  discardLabel,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  discardLabel?: string;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <Modal
      open
      onClose={onKeepEditing}
      title={t("common:discard.title")}
      maxWidth={440}
      testId="discard-question"
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            type="button"
            onClick={onKeepEditing}
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--bg-base)"
          >
            {t("common:discard.keepEditing")}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white ${DELETE_BUTTON_CLASS}`}
          >
            {discardLabel ?? t("common:discard.confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm text-(--text-muted)">{t("common:discard.message")}</p>
    </Modal>
  );
}
