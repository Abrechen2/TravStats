import { useTranslation } from "../../hooks/useTranslation";

interface PasswordFormState {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface PasswordModalProps {
  passwordForm: PasswordFormState;
  passwordError: string;
  changingPassword: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onSetPasswordForm: (form: PasswordFormState) => void;
}

export default function PasswordModal({
  passwordForm,
  passwordError,
  changingPassword,
  onClose,
  onSubmit,
  onSetPasswordForm,
}: PasswordModalProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

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
          {t("settings:password.title")}
        </h3>
        <div className="space-y-4">
          {passwordError && (
            <div
              className="px-4 py-3 rounded-sm"
              style={{
                background: "rgba(248,81,73,0.1)",
                border: "1px solid rgba(248,81,73,0.3)",
                color: "var(--danger)",
              }}
            >
              {passwordError}
            </div>
          )}
          <div>
            <label className="label">{t("settings:password.oldPassword")}</label>
            <input
              type="password"
              value={passwordForm.oldPassword}
              onChange={(e) => onSetPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
              className="input"
              placeholder={t("settings:password.oldPassword")}
              disabled={changingPassword}
            />
          </div>
          <div>
            <label className="label">{t("settings:password.newPassword")}</label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) => onSetPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              className="input"
              placeholder={t("settings:password.newPassword")}
              disabled={changingPassword}
            />
          </div>
          <div>
            <label className="label">{t("settings:password.confirmPassword")}</label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                onSetPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
              }
              className="input"
              placeholder={t("settings:password.confirmPassword")}
              disabled={changingPassword}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors"
            style={{ background: "var(--bg-muted)", color: "var(--text-primary)" }}
            disabled={changingPassword}
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            onClick={onSubmit}
            className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "var(--accent)",
              color: "#0d1117",
              boxShadow: "0 0 16px rgba(240,169,71,0.25)",
            }}
            disabled={changingPassword}
          >
            {changingPassword ? t("settings:password.changing") : t("settings:password.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
