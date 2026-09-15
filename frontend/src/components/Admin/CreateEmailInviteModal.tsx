import Modal from "../Modal";
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
    <Modal
      open
      onClose={onClose}
      busy={creating}
      title={t("admin:invitations.createEmailModal.title")}
      maxWidth={448}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("common:buttons.cancel")}
          </button>
          <button
            type="submit"
            form="create-email-invite"
            disabled={creating}
            className="btn-primary"
            aria-label={t("admin:invitations.createEmailModal.submit")}
          >
            {creating
              ? t("admin:invitations.createEmailModal.sending")
              : t("admin:invitations.createEmailModal.submit")}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
        {t("admin:invitations.createEmailModal.description")}
      </p>

      {/* The submit button lives in the shared footer, outside the form —
          `form="…"` keeps Enter and the click on the same submit path. */}
      <form id="create-email-invite" onSubmit={handleSubmit} className="space-y-4" noValidate>
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
      </form>
    </Modal>
  );
}
