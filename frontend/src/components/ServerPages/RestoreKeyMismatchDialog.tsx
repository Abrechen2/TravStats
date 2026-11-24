import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import Button from "../ui/Button";
import { ErrorLine } from "../ui/settings";
import type { DialogCopy } from "../Settings/rowCopy";
import { twoFactorApi } from "../../lib/api/twoFactor";
import { secondFactorField } from "../../lib/secondFactorInput";
import { logger } from "../../lib/logger";

/** The fresh re-authentication a key replacement needs (the server refuses without it). */
export type RestoreReauth = { password: string; code?: string; recoveryCode?: string };

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
  onRestoreWithKey: (recoveryKey: string, reauth: RestoreReauth) => void;
  onRestoreWithout: () => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [hasTwoFactor, setHasTwoFactor] = useState(false);
  const pasted = key.replace(/[\s-]+/g, "");
  const ready = pasted.length > 0 && password !== "" && (!hasTwoFactor || code.trim() !== "");

  useEffect(() => {
    let alive = true;
    twoFactorApi
      .getTwoFactorStatus()
      .then((status) => alive && setHasTwoFactor(status.enabled))
      .catch((err: unknown) => logger.warn("Failed to read two-factor status", err));
    return () => {
      alive = false;
    };
  }, []);

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
            onClick={() =>
              onRestoreWithKey(key, {
                password,
                ...(hasTwoFactor ? secondFactorField(code) : {}),
              })
            }
            disabled={busy || !ready}
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
        <p className="t-caption" style={{ margin: 0 }}>
          {t("settings:recoveryKey.restore.reauth")}
        </p>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("settings:recoveryKey.reauth.password")}</span>
          <input
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {hasTwoFactor ? (
          <label className="flex flex-col" style={{ gap: 4 }}>
            <span className="t-caption">{t("settings:recoveryKey.reauth.code")}</span>
            <input
              type="text"
              inputMode="numeric"
              className="input"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        ) : null}
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <p className="t-caption" style={{ margin: 0 }}>
          {copy.after}
        </p>
      </div>
    </Modal>
  );
}
