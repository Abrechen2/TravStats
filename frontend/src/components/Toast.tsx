import { useToastStore, type Toast } from "../store/toastStore";
import { useTranslation } from "../hooks/useTranslation";

const ToastItem = ({ toast }: { toast: Toast }) => {
  const removeToast = useToastStore((state) => state.removeToast);
  const { t } = useTranslation("common");

  const bgColors = {
    success: "border-(--success)",
    error: "border-(--danger)",
    warning: "border-(--warning)",
    info: "border-border",
  };

  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <div
      className={`
        ${bgColors[toast.type]}
        border rounded-lg p-4 mb-3 shadow-lg
        flex items-start gap-3
        animate-in slide-in-from-top-5 fade-in duration-300
      `}
      style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
      role="alert"
    >
      <div className="shrink-0 text-lg">{icons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium wrap-break-word">{toast.message}</p>
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="shrink-0 transition-colors"
        style={{ color: "var(--text-muted)" }}
        aria-label={t("buttons.close")}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
};

export default function Toast(): JSX.Element | null {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-9999 max-w-md w-full space-y-2 pointer-events-none">
      <div className="pointer-events-auto">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </div>
    </div>
  );
}
