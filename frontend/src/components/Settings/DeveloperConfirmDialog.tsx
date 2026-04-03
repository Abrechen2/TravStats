import { useTranslation } from "../../hooks/useTranslation";

interface DeveloperConfirmDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeveloperConfirmDialog({
  onCancel,
  onConfirm,
}: DeveloperConfirmDialogProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        className="rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
      >
        <h3 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("settings:developer.confirmTitle")}
        </h3>
        <div className="space-y-3 mb-6">
          <p style={{ color: "var(--text-muted)" }}>{t("settings:developer.confirmMessage")}</p>
          <div
            className="rounded-lg p-4"
            style={{
              background: "rgba(210,153,34,0.1)",
              border: "1px solid rgba(210,153,34,0.3)",
            }}
          >
            <p className="text-sm font-semibold mb-2" style={{ color: "var(--warning)" }}>
              {t("settings:developer.risks.title")}
            </p>
            <ul
              className="text-sm space-y-1 list-disc list-inside"
              style={{ color: "var(--text-muted)" }}
            >
              <li>{t("settings:developer.risks.items.resourceUsage")}</li>
              <li>{t("settings:developer.risks.items.technicalKnowledge")}</li>
              <li>{t("settings:developer.risks.items.unexpectedResults")}</li>
              <li>{t("settings:developer.risks.items.longTraining")}</li>
            </ul>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
            style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
          >
            {t("settings:developer.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
            style={{
              background: "var(--accent)",
              color: "#0d1117",
              boxShadow: "0 0 16px rgba(232,160,69,0.25)",
            }}
          >
            {t("settings:developer.activate")}
          </button>
        </div>
      </div>
    </div>
  );
}
