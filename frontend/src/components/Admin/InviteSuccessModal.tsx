import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { copyToClipboard } from "../../lib/clipboard";

interface InviteSuccessModalProps {
  inviteUrl: string;
  emailSent: boolean | undefined;
  emailError: string | null;
  recipientEmail: string | null;
  onClose: () => void;
}

export default function InviteSuccessModal({
  inviteUrl,
  emailSent,
  emailError,
  recipientEmail,
  onClose,
}: InviteSuccessModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const copyLink = async (): Promise<void> => {
    try {
      await copyToClipboard(inviteUrl);
      addToast("success", t("admin:invitations.success.copiedToClipboard"));
    } catch {
      addToast("error", t("admin:invitations.success.copyFailed"));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:invitations.success.title")}
        </h2>

        {emailSent === true && recipientEmail && (
          <p className="mb-4 text-sm" style={{ color: "#16a34a" }}>
            ✉ {t("admin:invitations.success.emailSent")}{" "}
            <span className="font-medium">{recipientEmail}</span>
          </p>
        )}

        {emailSent === false && (
          <div
            className="mb-4 rounded-lg p-3 text-sm"
            style={{
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.4)",
              color: "#d97706",
            }}
          >
            <p>
              <strong>{t("admin:invitations.success.emailFailed")}</strong>
            </p>
            {emailError && <p className="mt-1 font-mono text-xs">{emailError}</p>}
            <p className="mt-2 text-xs">{t("admin:invitations.success.linkStillValid")}</p>
          </div>
        )}

        <div className="mb-4">
          <label className="label">{t("admin:invitations.success.linkLabel")}</label>
          <div
            className="rounded-lg p-3 font-mono text-xs break-all"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
          >
            {inviteUrl}
          </div>
          <button type="button" onClick={copyLink} className="btn-secondary mt-2 text-sm">
            📋 {t("admin:invitations.success.copyLink")}
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary">
            {t("admin:invitations.success.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
