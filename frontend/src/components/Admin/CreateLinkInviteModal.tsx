import Modal from "../Modal";
import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";

type ExpiresInDays = 1 | 7 | 30;

interface CreateLinkInviteModalProps {
  onCreate: (expiresInDays: ExpiresInDays) => Promise<void> | void;
  onClose: () => void;
  creating: boolean;
}

export default function CreateLinkInviteModal({
  onCreate,
  onClose,
  creating,
}: CreateLinkInviteModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [expiresInDays, setExpiresInDays] = useState<ExpiresInDays>(7);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void onCreate(expiresInDays);
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={creating}
      title={t("admin:invitations.createLinkModal.title")}
      maxWidth={448}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("common:buttons.cancel")}
          </button>
          <button
            type="submit"
            form="create-link-invite"
            disabled={creating}
            className="btn-primary"
            aria-label={t("admin:invitations.createLinkModal.submit")}
          >
            {creating
              ? t("admin:invitations.createLinkModal.creating")
              : t("admin:invitations.createLinkModal.submit")}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
        {t("admin:invitations.createLinkModal.description")}
      </p>

      {/* The submit button lives in the shared footer, which sits outside the
          form element — `form="…"` is what keeps Enter and the click on the
          same submit path. */}
      <form id="create-link-invite" onSubmit={handleSubmit} className="space-y-4">
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
                aria-label={t(`admin:invitations.expires.${days === 1 ? "24h" : days + "d"}`)}
              />
              <span>{t(`admin:invitations.expires.${days === 1 ? "24h" : days + "d"}`)}</span>
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}
