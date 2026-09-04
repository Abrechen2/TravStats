import { useState } from "react";
import { z } from "zod";
import { useTranslation } from "../../hooks/useTranslation";

type ExpiresInDays = 1 | 7 | 30;

interface CreateEmailInviteModalProps {
  onCreate: (email: string, expiresInDays: ExpiresInDays) => Promise<void> | void;
  onClose: () => void;
  creating: boolean;
}

const emailSchema = z.string().email();

export default function CreateEmailInviteModal({
  onCreate,
  onClose,
  creating,
}: CreateEmailInviteModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [email, setEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<ExpiresInDays>(7);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t("admin:invitations.createEmailModal.emailRequired"));
      return;
    }
    if (!emailSchema.safeParse(email).success) {
      setError(t("admin:invitations.createEmailModal.emailInvalid"));
      return;
    }
    setError(null);
    void onCreate(email, expiresInDays);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:invitations.createEmailModal.title")}
        </h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("admin:invitations.createEmailModal.description")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="invite-email" className="label">
              {t("admin:invitations.createEmailModal.emailLabel")}
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
              placeholder={t("admin:invitations.createEmailModal.emailPlaceholder")}
              autoFocus
            />
            {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
          </div>

          <fieldset>
            <legend className="label mb-2">{t("admin:invitations.expiresLegend")}</legend>
            {([1, 7, 30] as ExpiresInDays[]).map((days) => (
              <label key={days} className="flex items-center gap-2 mb-1">
                <input
                  type="radio"
                  name="expiresInDays"
                  value={days}
                  checked={expiresInDays === days}
                  onChange={() => setExpiresInDays(days)}
                />
                <span>{t(`admin:invitations.expires.${days === 1 ? "24h" : days + "d"}`)}</span>
              </label>
            ))}
          </fieldset>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("common:buttons.cancel")}
            </button>
            <button
              type="submit"
              disabled={creating}
              className="btn-primary"
              aria-label={t("admin:invitations.createEmailModal.submit")}
            >
              {creating
                ? t("admin:invitations.createEmailModal.sending")
                : t("admin:invitations.createEmailModal.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
