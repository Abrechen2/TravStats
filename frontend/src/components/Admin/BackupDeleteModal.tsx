import { useState } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import type { Backup } from "./backupTypes";

export default function BackupDeleteModal({
  backup,
  busy,
  onClose,
  onConfirm,
}: {
  backup: Backup;
  busy: boolean;
  onClose: () => void;
  onConfirm: (remote: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [remote, setRemote] = useState(false);
  return (
    <Modal
      open
      busy={busy}
      onClose={onClose}
      title={t("common:buttons.delete")}
      footer={
        <>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            {t("common:buttons.cancel")}
          </button>
          <button className="btn-danger" disabled={busy} onClick={() => onConfirm(remote)}>
            {t("common:buttons.delete")}
          </button>
        </>
      }
    >
      <p>{t("admin:backup.deleteLocalOnly")}</p>
      {backup.syncedToCloud && (
        <label className="flex items-center gap-3 mt-4">
          <input
            type="checkbox"
            checked={remote}
            disabled={busy}
            onChange={(e) => setRemote(e.target.checked)}
          />
          {t("admin:backup.deleteRemote")}
        </label>
      )}
      {remote && !backup.cloudTarget && (
        <p role="status" className="mt-3">
          {t("admin:backup.remoteTargetUnknown")}
        </p>
      )}
    </Modal>
  );
}
