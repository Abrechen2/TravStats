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
  const defaultConfirmText = confirmText || t("common:buttons.confirm");
  const defaultCancelText = cancelText || t("common:buttons.cancel");
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-[var(--bg-base)]0 bg-opacity-75"
          onClick={onClose}
        ></div>

        {/* Center modal */}
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
          &#8203;
        </span>

        <div className="inline-block align-bottom bg-(--bg-surface) rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-(--bg-surface) px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-(--text-primary) mb-2">
                  {title}
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-(--text-muted) whitespace-pre-line">{message}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-(--bg-base) px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-xs px-4 py-2 text-base font-medium text-white sm:ml-3 sm:w-auto sm:text-sm ${confirmButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isLoading ? t("training:modal.processing") : defaultConfirmText}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-border shadow-xs px-4 py-2 bg-(--bg-surface) text-base font-medium text-(--text-primary) hover:bg-(--bg-base) sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {defaultCancelText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
