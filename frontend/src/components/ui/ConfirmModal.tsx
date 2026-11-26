import { useEffect, useRef, type JSX, type ReactNode } from "react";
import Dialog from "./Dialog";
import { useTranslation } from "../../hooks/useTranslation";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** A title that is more than text; wins over `title` when given. */
  titleNode?: ReactNode;
  /** What is asked, in one or two sentences. Name WHAT and HOW MANY. */
  message?: string;
  /** More body under the message: a preview, a form, a typed-word field. */
  children?: ReactNode;
  /** Keeps the confirm button off until the question is fully answered. */
  confirmDisabled?: boolean;
  /** Focus starts on "Abbrechen", so a stray Enter cannot destroy anything. */
  focusCancel?: boolean;
  /** Accessible name of the ×, when "Schließen" would repeat a button. */
  closeLabel?: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  isLoading?: boolean;
}

/**
 * A question with two answers — the one dialog the design system lets wear
 * `danger`, because it is where the object, the reach and the consequence are
 * already stated.
 *
 * It built its own overlay until 2026-09-15, and that overlay carried the
 * defect the shared frame exists to prevent: the backdrop was `fixed`, which
 * outranks an unpositioned sibling in the stacking order no matter the DOM
 * order, so it covered the buttons. Every click landed on the backdrop, which
 * closes the dialog — confirming LOOKED like it had worked while nothing
 * happened. The class beside it, `bg-[var(--bg-base)]0`, was a typo that
 * rendered no colour, which is why an invisible blocker went unnoticed for
 * months (found in the 2.6.0-rc.9 browser UAT).
 *
 * It is `Modal` now, so it inherits the escape hatch, the focus trap, the
 * focus return and the mobile docking rather than owning a third copy of
 * them — and it had no focus trap of its own at all.
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  titleNode,
  message,
  confirmText,
  cancelText,
  confirmButtonClass = "btn-primary",
  isLoading = false,
  children,
  confirmDisabled = false,
  focusCancel = false,
  closeLabel,
}: ConfirmModalProps): JSX.Element | null {
  const { t } = useTranslation(["training", "common"]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // After the shell has given the panel focus.
    if (isOpen && focusCancel) cancelRef.current?.focus();
  }, [isOpen, focusCancel]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      busy={isLoading}
      title={titleNode ?? title}
      maxWidth={512}
      testId="confirm-modal"
      closeLabel={closeLabel ?? t("common:buttons.close")}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--bg-base) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelText || t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading || confirmDisabled}
            className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${confirmButtonClass}`}
          >
            {isLoading
              ? t("training:modal.processing")
              : confirmText || t("common:buttons.confirm")}
          </button>
        </>
      }
    >
      {message && <p className="text-sm whitespace-pre-line text-(--text-muted)">{message}</p>}
      {children}
    </Dialog>
  );
}
