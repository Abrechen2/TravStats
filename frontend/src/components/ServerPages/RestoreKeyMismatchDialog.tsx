import { useEffect, useState, type JSX } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { useTranslation } from "../../hooks/useTranslation";
import Modal from "../Modal";
import Button from "../ui/Button";
import { ErrorLine, LinkButton } from "../ui/settings";
import type { DialogCopy } from "../Settings/rowCopy";
import { twoFactorApi } from "../../lib/api/twoFactor";
import { passkeyApi } from "../../lib/api/passkeys";
import { secondFactorField } from "../../lib/secondFactorInput";
import { logger } from "../../lib/logger";

/**
 * The fresh re-authentication a key replacement needs (the server refuses
 * without it): the password (+ second factor), or a passkey assertion — the
 * same two ways the reveal step accepts.
 */
export type RestoreReauth =
  | { password: string; code?: string; recoveryCode?: string }
  | { passkeyResponse: Record<string, unknown> };

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
  const [hasPasskey, setHasPasskey] = useState(false);
  const [method, setMethod] = useState<"password" | "passkey">("password");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyFailed, setPasskeyFailed] = useState<"cancelled" | "failed" | null>(null);
  const usePasskey = method === "passkey" && hasPasskey;
  const pasted = key.replace(/[\s-]+/g, "");
  const ready =
    pasted.length > 0 && (usePasskey || (password !== "" && (!hasTwoFactor || code.trim() !== "")));
  const working = busy || passkeyBusy;

  const submit = async (): Promise<void> => {
    if (!usePasskey) {
      onRestoreWithKey(key, { password, ...(hasTwoFactor ? secondFactorField(code) : {}) });
      return;
    }
    setPasskeyBusy(true);
    setPasskeyFailed(null);
    try {
      const passkeyResponse = (await startAuthentication({
        optionsJSON: await passkeyApi.reauthOptions(),
      })) as unknown as Record<string, unknown>;
      onRestoreWithKey(key, { passkeyResponse });
    } catch (error) {
      const cancelled =
        error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
      // A visible error plus a console line (owner, 2026-11-18).
      logger.warn(`Restore passkey confirmation failed: ${cancelled ? "cancelled" : "failed"}`);
      setPasskeyFailed(cancelled ? "cancelled" : "failed");
    } finally {
      setPasskeyBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    twoFactorApi
      .getTwoFactorStatus()
      .then((status) => alive && setHasTwoFactor(status.enabled))
      .catch((err: unknown) => logger.warn("Failed to read two-factor status", err));
    passkeyApi
      .list()
      .then((keys) => alive && setHasPasskey(keys.length > 0))
      .catch((err: unknown) => logger.warn("Failed to read passkeys", err));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Modal
      open
      onClose={onCancel}
      busy={working}
      title={copy.title}
      testId="restore-key-mismatch"
      footer={(requestClose) => (
        <div className="flex w-full flex-wrap justify-end" style={{ gap: 8 }}>
          <Button onClick={requestClose} disabled={working}>
            {t("settings:recoveryKey.restore.cancel")}
          </Button>
          <Button variant="danger" onClick={onRestoreWithout} disabled={working}>
            {copy.confirmLabel}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={working || !ready}
            aria-busy={working || undefined}
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
        {usePasskey ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("settings:recoveryKey.reauth.passkeyHint")}
          </p>
        ) : (
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
        )}
        {hasPasskey ? (
          <span>
            <LinkButton
              onClick={() => {
                setPasskeyFailed(null);
                setMethod(usePasskey ? "password" : "passkey");
              }}
            >
              {usePasskey
                ? t("settings:recoveryKey.reauth.usePassword")
                : t("settings:recoveryKey.reauth.usePasskey")}
            </LinkButton>
          </span>
        ) : null}
        {hasTwoFactor && !usePasskey ? (
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
        {passkeyFailed === "cancelled" ? (
          <ErrorLine>{t("settings:recoveryKey.reauth.refused.passkeyCancelled")}</ErrorLine>
        ) : passkeyFailed === "failed" ? (
          <ErrorLine>{t("settings:recoveryKey.reauth.refused.other")}</ErrorLine>
        ) : null}
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <p className="t-caption" style={{ margin: 0 }}>
          {copy.after}
        </p>
      </div>
    </Modal>
  );
}
