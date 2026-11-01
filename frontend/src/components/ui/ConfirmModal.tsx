import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
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
  message,
  confirmText,
  cancelText,
  confirmButtonClass = "btn-primary",
  isLoading = false,
}: ConfirmModalProps): JSX.Element | null {
  const { t } = useTranslation(["training", "common"]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      busy={isLoading}
      title={title}
      maxWidth={512}
      testId="confirm-modal"
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
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
            disabled={isLoading}
            className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${confirmButtonClass}`}
          >
            {isLoading
              ? t("training:modal.processing")
              : confirmText || t("common:buttons.confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm whitespace-pre-line text-(--text-muted)">{message}</p>
    </Modal>
  );
}
