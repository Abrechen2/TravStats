/**
 * Passkeys, the last row of "Anmeldung".
 *
 * A passkey REPLACES the password here rather than adding a step to it, and it
 * also satisfies two-factor on its own — the backend only allows that because
 * it demands user verification. Because a passkey is that strong, adding one
 * asks for the password again (and the authenticator code where the account has
 * one): a stolen session cookie must not be able to plant its own.
 */

import { useEffect, useState, type JSX } from "react";
import { startRegistration } from "@simplewebauthn/browser";

import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { passkeyApi, type Passkey, type PasskeyUnavailableReason } from "../../lib/api";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { formatDate } from "../../lib/displayFormat";
import Button from "../ui/Button";
import { Input } from "../ui/Field";
import { ActionControl, SettingItem } from "../ui/settings";

/** Cancelling the OS or password-manager dialog rejects with this. It is a
 *  normal user action, not an error worth showing. */
function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

type AddFailure =
  | "REAUTH_PASSWORD_INCORRECT"
  | "REAUTH_SECOND_FACTOR_REQUIRED"
  | "REAUTH_SECOND_FACTOR_INVALID"
  | "failed";

const REAUTH_CODES: readonly string[] = [
  "REAUTH_PASSWORD_INCORRECT",
  "REAUTH_SECOND_FACTOR_REQUIRED",
  "REAUTH_SECOND_FACTOR_INVALID",
];

export default function PasskeySection(): JSX.Element | null {
  const { t } = useTranslation(["settings", "common"]);
  const isDemo = useIsDemoAccount();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState<PasskeyUnavailableReason | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [failure, setFailure] = useState<AddFailure | "removeFailed" | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      setPasskeys(await passkeyApi.list());
      setListFailed(false);
    } catch (err) {
      logger.error("Failed to list passkeys", err);
      setListFailed(true);
    }
  };

  // Empty dep array on purpose: the project's useTranslation wrapper does not
  // give a stable `t`.
  useEffect(() => {
    void (async () => {
      try {
        const status = await passkeyApi.availability();
        // The server judges its CONFIGURED origins; the browser judges the page
        // we are actually on. Strict false, not falsy: every real browser
        // defines the field; only test DOMs leave it undefined.
        if (window.isSecureContext === false) {
          setAvailable(false);
          setReason("insecureOrigin");
          return;
        }
        setAvailable(status.available);
        setReason(status.reason);
        if (status.available) await refresh();
      } catch (err) {
        logger.error("Failed to read passkey availability", err);
        setAvailable(false);
        setReason("notConfigured");
      }
    })();
  }, []);

  const close = (): void => {
    setAdding(false);
    setName("");
    setPassword("");
    setCode("");
    setNeedsCode(false);
    setFailure(null);
  };

  const add = async (): Promise<void> => {
    setFailure(null);
    setBusy(true);
    try {
      const options = await passkeyApi.registerOptions({
        password,
        ...(needsCode ? { code: code.trim() } : {}),
      });
      const response = await startRegistration({ optionsJSON: options });
      await passkeyApi.registerVerify(name.trim(), response);
      close();
      await refresh();
    } catch (err) {
      if (isUserCancellation(err)) {
        close();
        return;
      }
      logger.error("Passkey registration failed", err);
      const machine = apiErrorMachineCode(err);
      if (machine && REAUTH_CODES.includes(machine)) {
        if (machine === "REAUTH_SECOND_FACTOR_REQUIRED") setNeedsCode(true);
        setFailure(machine as AddFailure);
      } else {
        setFailure("failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setFailure(null);
    try {
      await passkeyApi.remove(id);
      await refresh();
    } catch (err) {
      logger.error("Passkey removal failed", err);
      setFailure("removeFailed");
    }
  };

  if (available === null) return null;

  const unavailable = !available
    ? {
        reason:
          reason === "insecureOrigin"
            ? t("settings:passkeys.insecureOrigin")
            : t("settings:passkeys.notConfigured"),
      }
    : undefined;
  const failureText =
    failure === null
      ? undefined
      : failure === "removeFailed"
        ? t("settings:passkeys.removeFailed")
        : failure === "failed"
          ? t("settings:passkeys.addFailed")
          : t(`settings:passkeys.reauth.${failure}`);

  return (
    <SettingItem
      title={t("settings:rows.passkeys.name")}
      sub={t("settings:rows.passkeys.sub")}
      help={t("settings:rows.passkeys.help")}
      locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
      dependency={unavailable}
      error={failureText}
      control={
        available && !adding && !isDemo ? (
          <ActionControl label={t("settings:passkeys.add")} onClick={() => setAdding(true)} />
        ) : undefined
      }
    >
      {available && listFailed && (
        <p className="t-caption" style={{ margin: 0 }}>
          {t("settings:passkeys.listFailed")}
        </p>
      )}
      {available && !listFailed && passkeys.length === 0 && (
        <p className="t-caption" style={{ margin: 0 }}>
          {t("settings:passkeys.none")}
        </p>
      )}
      {available && passkeys.length > 0 && (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)", margin: 0, padding: 0 }}>
          {passkeys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between"
              style={{ gap: "var(--ts-space-md)", listStyle: "none" }}
            >
              <div className="min-w-0">
                <p className="truncate" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                  {key.name}
                </p>
                <p className="t-caption" style={{ margin: 0 }}>
                  {t("settings:passkeys.rpIdLabel")}: {key.rpId}
                  {key.lastUsedAt
                    ? ` · ${t("settings:passkeys.lastUsed")} ${formatDate(key.lastUsedAt)}`
                    : ` · ${t("settings:passkeys.neverUsed")}`}
                </p>
              </div>
              <Button variant="secondary" disabled={isDemo} onClick={() => void remove(key.id)}>
                {t("settings:passkeys.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <label className="flex flex-col" style={{ gap: 4 }}>
            <span className="t-caption">{t("settings:passkeys.nameLabel")}</span>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings:passkeys.namePlaceholder")}
            />
          </label>
          <label className="flex flex-col" style={{ gap: 4 }}>
            <span className="t-caption">{t("settings:passkeys.passwordLabel")}</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {needsCode && (
            <label className="flex flex-col" style={{ gap: 4 }}>
              <span className="t-caption">{t("settings:passkeys.codeLabel")}</span>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            <Button
              variant="primary"
              disabled={busy || name.trim().length === 0 || password === ""}
              onClick={() => void add()}
            >
              {t("settings:passkeys.confirmAdd")}
            </Button>
            <Button variant="secondary" onClick={close}>
              {t("common:buttons.cancel")}
            </Button>
          </span>
        </div>
      )}
    </SettingItem>
  );
}
