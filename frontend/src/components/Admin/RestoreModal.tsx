import type { Backup } from "./backupTypes";
import { useState } from "react";
import { profileDateTime } from "../../lib/profileInstant";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";

interface RestoreModalProps {
  backup: Backup;
  onClose: () => void;
  onConfirm: (
    scope: "full" | "database" | "files",
    createBackupBefore: boolean,
    acceptEncryptionKeyChange: boolean
  ) => void;
  /**
   * The server refused the last attempt because the archive's encrypted values
   * were written with a different instance key (audit SRV-RESTORE-001). The
   * dialog stays open and asks for that acknowledgement rather than closing on
   * a toast: the admin is mid-recovery, and what is needed from them is a
   * decision, not an error message.
   */
  encryptionKeyMismatch?: boolean;
  /** The restore job is running: the dialog says so and cannot be sent twice. */
  restoring?: boolean;
}

/** Exported for its own test — the dialog contract is worth holding on its
 *  own, without driving the whole backup page to reach it. */
export function RestoreModal({
  backup,
  onClose,
  onConfirm,
  encryptionKeyMismatch = false,
  restoring = false,
}: RestoreModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [scope, setScope] = useState<"full" | "database" | "files">("full");
  const [createBackupBefore, setCreateBackupBefore] = useState(true);
  const [acceptKeyChange, setAcceptKeyChange] = useState(false);

  const [confirmText, setConfirmText] = useState("");

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return t("common:labels.unknown");
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return t("common:labels.unknown");
      }
      // A backup belongs to no place: the user's profile clock (ADR 0002 Q1).
      return profileDateTime(date) ?? t("common:labels.unknown");
    } catch {
      return t("common:labels.unknown");
    }
  };

  const mayConfirm =
    confirmText === t("admin:backup.restore.confirmText") &&
    (!encryptionKeyMismatch || acceptKeyChange);

  const handleConfirm = () => {
    if (!mayConfirm) {
      return;
    }
    onConfirm(scope, createBackupBefore, acceptKeyChange);
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={restoring}
      title={<span style={{ color: "var(--danger)" }}>⚠️ {t("admin:backup.restore.title")}</span>}
      maxWidth={672}
      closeLabel={t("common:buttons.cancel")}
      footer={
        <>
          <button onClick={onClose} disabled={restoring} className="btn-secondary">
            {t("common:buttons.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!mayConfirm || restoring}
            className="btn-danger disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {restoring
              ? t("admin:backup.restore.inProgress")
              : t("admin:backup.restore.confirmButton")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className="border rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--danger)" }}
        >
          <p className="font-semibold" style={{ color: "var(--danger)" }}>
            {t("admin:backup.restore.warning")}
          </p>
          <p className="text-sm mt-2" style={{ color: "var(--danger)" }}>
            {t("admin:backup.restore.backupFrom", { date: formatDate(backup.completedAt) })}
          </p>
        </div>

        {encryptionKeyMismatch && (
          <div
            className="border rounded-lg p-4"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--danger)" }}
          >
            <p className="font-semibold" style={{ color: "var(--danger)" }}>
              {t("admin:backup.restore.keyMismatchTitle")}
            </p>
            <p className="text-sm mt-2">{t("admin:backup.restore.keyMismatchBody")}</p>
            <label className="flex items-start gap-3 mt-3">
              <input
                type="checkbox"
                checked={acceptKeyChange}
                onChange={(e) => setAcceptKeyChange(e.target.checked)}
                className="checkbox"
              />
              <span>{t("admin:backup.restore.keyMismatchAcknowledge")}</span>
            </label>
          </div>
        )}

        <div>
          <label className="label" htmlFor="restore-scope">
            {t("admin:backup.restore.scope")}
          </label>
          <select
            id="restore-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as "full" | "database" | "files")}
            className="input"
          >
            <option value="full">{t("admin:backup.restore.scopeFull")}</option>
            <option value="database">{t("admin:backup.restore.scopeDatabase")}</option>
            <option value="files">{t("admin:backup.restore.scopeFiles")}</option>
          </select>
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={createBackupBefore}
            onChange={(e) => setCreateBackupBefore(e.target.checked)}
            className="checkbox"
          />
          <span>{t("admin:backup.restore.createBackupBefore")}</span>
        </label>

        <div>
          <label className="label" htmlFor="restore-confirm">
            {t("admin:backup.restore.confirmLabel", {
              text: t("admin:backup.restore.confirmText"),
            })}
          </label>
          <input
            id="restore-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="input"
            placeholder={t("admin:backup.restore.confirmText")}
          />
        </div>
      </div>
    </Modal>
  );
}
