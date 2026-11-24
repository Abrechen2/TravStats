import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import type { DialogCopy } from "../Settings/rowCopy";

/**
 * A restore refused with RESTORE_ENCRYPTION_KEY_MISMATCH: the archive was
 * written under another instance key. Two ways on (owner request 2026-11-24):
 * paste the recovery key of the instance that wrote it — checked against the
 * archive and installed before the restore, so the services' credentials stay
 * readable — or restore without it and enter those credentials again (the
 * acknowledgement that existed before, unchanged).
 */
export default function RestoreKeyMismatchDialog({
  copy,
  busy,
  error,
  onCancel,
  onRestoreWithKey,
  onRestoreWithout,
}: {
  copy: DialogCopy;
  busy: boolean;
  /** Why the pasted key was refused, already worded. */
  error: string | null;
  onCancel: () => void;
  onRestoreWithKey: (recoveryKey: string) => void;
  onRestoreWithout: () => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [key, setKey] = useState("");
  const pasted = key.replace(/[\s-]+/g, "");

  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      title={copy.title}
      testId="restore-key-mismatch"
      footer={(requestClose) => (
        <div className="flex w-full flex-wrap justify-end" style={{ gap: 8 }}>
          <Button onClick={requestClose} disabled={busy}>
            {t("settings:recoveryKey.restore.cancel")}
          </Button>
          <Button variant="danger" onClick={onRestoreWithout} disabled={busy}>
            {copy.confirmLabel}
          </Button>
          <Button
            variant="primary"
            onClick={() => onRestoreWithKey(key)}
            disabled={busy || pasted.length === 0}
            aria-busy={busy || undefined}
          >
            {t("settings:recoveryKey.restore.withKey")}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-caption" style={{ margin: 0 }}>
          {copy.affects}
        </p>
        <p className="t-body" style={{ margin: 0 }}>
          {t("settings:recoveryKey.restore.intro")}
        </p>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("settings:recoveryKey.restore.label")}</span>
          <textarea
            className="input t-mono"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <p className="t-caption" style={{ margin: 0 }}>
          {copy.after}
        </p>
      </div>
    </Modal>
  );
}
