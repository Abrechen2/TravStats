import { useEffect, useState, type JSX } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { useTranslation } from "../../hooks/useTranslation";
import { twoFactorApi } from "../../lib/api/twoFactor";
import { passkeyApi } from "../../lib/api/passkeys";
import { recoveryKeyApi, type RevealedRecoveryKey } from "../../lib/api/recoveryKey";
import { apiErrorMachineCode } from "../../lib/apiError";
import { secondFactorField } from "../../lib/secondFactorInput";
import { logger } from "../../lib/logger";
import Button from "../ui/Button";
import { ErrorLine, LinkButton } from "../ui/settings";

/** Why the re-authentication was refused, by the server's stable code. */
const KNOWN_REFUSALS = [
  "REAUTH_PASSWORD_INCORRECT",
  "REAUTH_SECOND_FACTOR_REQUIRED",
  "REAUTH_SECOND_FACTOR_INVALID",
  "DELETE_PASSKEY_INVALID",
  "REAUTH_PASSKEY_TOO_NEW",
  "PASSKEY_UNAVAILABLE",
  "RATE_LIMITED",
] as const;
type Refusal = (typeof KNOWN_REFUSALS)[number] | "passkeyCancelled" | "offline" | "other";

function refusalOf(error: unknown): Refusal {
  if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return "passkeyCancelled";
  }
  if (!(error as { response?: unknown } | null)?.response) return "offline";
  const code = apiErrorMachineCode(error);
  return code && (KNOWN_REFUSALS as readonly string[]).includes(code) ? (code as Refusal) : "other";
}

/**
 * Step 1 of the recovery-key flow: prove it is still you. The password (plus the
 * authenticator code where the account has two-factor), or a passkey — the same
 * re-authentication the account deletion uses. Only then does the server answer
 * with the key.
 */
export default function RecoveryKeyReauthStep({
  notice,
  onRevealed,
}: {
  /** Shown above the form, e.g. after the half-hour confirm window ran out. */
  notice?: string | null;
  onRevealed: (revealed: RevealedRecoveryKey) => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [hasTwoFactor, setHasTwoFactor] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [method, setMethod] = useState<"password" | "passkey">("password");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    let alive = true;
    twoFactorApi
      .getTwoFactorStatus()
      .then((status) => alive && setHasTwoFactor(status.enabled))
      .catch((error: unknown) => logger.warn("Failed to read two-factor status", error));
    passkeyApi
      .list()
      .then((keys) => alive && setHasPasskey(keys.length > 0))
      .catch((error: unknown) => logger.warn("Failed to read passkeys", error));
    return () => {
      alive = false;
    };
  }, []);

  const usePasskey = method === "passkey" && hasPasskey;
  const ready = usePasskey || (password !== "" && (!hasTwoFactor || code.trim() !== ""));

  const submit = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const revealed = usePasskey
        ? await recoveryKeyApi.reveal({
            passkeyResponse: await startAuthentication({
              optionsJSON: await passkeyApi.reauthOptions(),
            }),
          })
        : await recoveryKeyApi.reveal({
            password,
            ...(hasTwoFactor ? secondFactorField(code) : {}),
          });
      setPassword("");
      setCode("");
      onRevealed(revealed);
    } catch (error) {
      const why = refusalOf(error);
      // A visible error plus a console line (owner, 2026-11-18) — never the input.
      logger.warn(`Recovery key re-authentication refused: ${why}`);
      setRefusal(why);
      if (why === "REAUTH_SECOND_FACTOR_REQUIRED") setHasTwoFactor(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {notice ? <ErrorLine>{notice}</ErrorLine> : null}
      <p className="t-body" style={{ margin: 0 }}>
        {t("settings:recoveryKey.reauth.intro")}
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
      {hasPasskey && (
        <span>
          <LinkButton
            onClick={() => {
              setRefusal(null);
              setMethod(usePasskey ? "password" : "passkey");
            }}
          >
            {usePasskey
              ? t("settings:recoveryKey.reauth.usePassword")
              : t("settings:recoveryKey.reauth.usePasskey")}
          </LinkButton>
        </span>
      )}
      {hasTwoFactor && !usePasskey && (
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
      )}
      {refusal && <ErrorLine>{t(`settings:recoveryKey.reauth.refused.${refusal}`)}</ErrorLine>}
      <span>
        <Button
          variant="primary"
          type="submit"
          disabled={!ready || busy}
          aria-busy={busy || undefined}
        >
          {t("settings:recoveryKey.reauth.submit")}
        </Button>
      </span>
    </form>
  );
}
