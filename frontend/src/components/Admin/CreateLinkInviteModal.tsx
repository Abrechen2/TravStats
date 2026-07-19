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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:invitations.createLinkModal.title")}
        </h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("admin:invitations.createLinkModal.description")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("common:buttons.cancel")}
            </button>
            <button
              type="submit"
              disabled={creating}
              className="btn-primary"
              aria-label={t("admin:invitations.createLinkModal.submit")}
            >
              {creating
                ? t("admin:invitations.createLinkModal.creating")
                : t("admin:invitations.createLinkModal.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
