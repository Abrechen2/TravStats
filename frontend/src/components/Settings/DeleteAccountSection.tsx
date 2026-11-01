import { useEffect, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { startAuthentication } from "@simplewebauthn/browser";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { authApi } from "../../lib/api/auth";
import { twoFactorApi } from "../../lib/api/twoFactor";
import { passkeyApi } from "../../lib/api/passkeys";
import { apiErrorMachineCode } from "../../lib/apiError";
import { secondFactorField } from "../../lib/secondFactorInput";
import { logger } from "../../lib/logger";
import { useAuthStore } from "../../store/authStore";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { ActionControl, ConfirmDialog, ErrorLine, LinkButton, SettingItem } from "../ui/settings";
import MeExportRow from "./MeExportRow";

type Refusal =
  | "DELETE_PASSWORD_INCORRECT"
  | "DELETE_SECOND_FACTOR_REQUIRED"
  | "DELETE_SECOND_FACTOR_INVALID"
  | "DELETE_PASSKEY_INVALID"
  | "REAUTH_PASSKEY_TOO_NEW"
  | "NO_PASSKEY"
  | "PASSKEY_UNAVAILABLE"
  | "passkeyCancelled"
  | "DELETE_LAST_ADMIN"
  | "DEMO_ACCOUNT_FORBIDDEN"
  | "offline"
  | "other";

const KNOWN: readonly string[] = [
  "DELETE_PASSWORD_INCORRECT",
  "DELETE_SECOND_FACTOR_REQUIRED",
  "DELETE_SECOND_FACTOR_INVALID",
  "DELETE_PASSKEY_INVALID",
  "REAUTH_PASSKEY_TOO_NEW",
  "NO_PASSKEY",
  "PASSKEY_UNAVAILABLE",
  "DELETE_LAST_ADMIN",
];

/** Closing the browser's or password manager's dialog is a choice, not a fault. */
function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

/** Why a delete was refused, by the server's stable code — never its English prose. */
export function refusalOf(error: unknown): Refusal {
  const response = (error as { response?: { status?: number; data?: { error?: string } } } | null)
    ?.response;
  if (!response) return "offline";
  if (response.data?.error === "DEMO_ACCOUNT_FORBIDDEN") return "DEMO_ACCOUNT_FORBIDDEN";
  const code = apiErrorMachineCode(error);
  return code && KNOWN.includes(code) ? (code as Refusal) : "other";
}

/**
 * "Konto löschen": at once and for good. The download comes first, then the
 * password (and the authenticator code where the account has one), then the
 * confirmation block with the typed word. Nothing is simulated: the server
 * deletes the account and every file, and this page then signs out.
 */
export default function DeleteAccountSection(): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  const navigate = useNavigate();
  const isDemo = useIsDemoAccount();
  const username = useAuthStore((s) => s.user?.username ?? "");
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [hasTwoFactor, setHasTwoFactor] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [method, setMethod] = useState<"password" | "passkey">("password");
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    twoFactorApi
      .getTwoFactorStatus()
      .then((status) => alive && setHasTwoFactor(status.enabled))
      .catch((error: unknown) => logger.warn("Failed to read two-factor status", error));
    // An account that signs in with a passkey may not know its password at all.
    passkeyApi
      .list()
      .then((keys) => alive && setHasPasskey(keys.length > 0))
      .catch((error: unknown) => logger.warn("Failed to read passkeys", error));
    return () => {
      alive = false;
    };
  }, [open]);

  const lang = i18n?.language ?? "de";
  const word = lang.startsWith("en") ? "DELETE" : "LÖSCHEN";
  const usePasskey = method === "passkey" && hasPasskey;
  const ready = usePasskey || (password !== "" && (!hasTwoFactor || code.trim() !== ""));

  const run = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try {
      if (usePasskey) {
        // The ceremony runs now, not when "Weiter" was pressed: a challenge
        // lives two minutes, and the typed word can take longer than that.
        const assertion = await startAuthentication({
          optionsJSON: await passkeyApi.reauthOptions(),
        });
        await authApi.deleteAccount({ passkeyResponse: assertion, confirmation: word });
      } else {
        await authApi.deleteAccount({
          password,
          confirmation: word,
          ...(hasTwoFactor ? secondFactorField(code) : {}),
        });
      }
      setAsking(false);
      await useAuthStore.getState().logout();
      navigate("/login", { replace: true });
    } catch (error) {
      logger.warn("Failed to delete the account", error);
      setAsking(false);
      const why = isUserCancellation(error) ? "passkeyCancelled" : refusalOf(error);
      setRefusal(why);
      if (why === "DELETE_SECOND_FACTOR_REQUIRED") setHasTwoFactor(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:deleteAccount.name")}
          sub={t("settings:deleteAccount.sub")}
          help={t("settings:deleteAccount.help")}
          locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
          control={
            <ActionControl
              label={t("settings:deleteAccount.open")}
              danger
              onClick={() => setOpen((v) => !v)}
            />
          }
        >
          {open && !isDemo && (
            <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
              <MeExportRow />
              {usePasskey ? (
                <p className="t-caption" style={{ margin: 0 }}>
                  {t("settings:deleteAccount.passkeyHint")}
                </p>
              ) : (
                <label className="flex flex-col" style={{ gap: 4 }}>
                  <span className="t-caption">{t("settings:deleteAccount.password")}</span>
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
                      ? t("settings:deleteAccount.usePassword")
                      : t("settings:deleteAccount.usePasskey")}
                  </LinkButton>
                </span>
              )}
              {hasTwoFactor && !usePasskey && (
                <label className="flex flex-col" style={{ gap: 4 }}>
                  <span className="t-caption">{t("settings:deleteAccount.code")}</span>
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
              {refusal && <ErrorLine>{t(`settings:deleteAccount.refused.${refusal}`)}</ErrorLine>}
              <span>
                <ActionControl
                  label={t("settings:deleteAccount.continue")}
                  danger
                  busy={busy}
                  onClick={() => ready && setAsking(true)}
                />
              </span>
            </div>
          )}
        </SettingItem>
      </SettingRows>
      <ConfirmDialog
        open={asking}
        title={t("settings:deleteAccount.dialog.title")}
        affects={t("settings:deleteAccount.dialog.affects", { username })}
        amount={t("settings:deleteAccount.dialog.amount")}
        after={t("settings:deleteAccount.dialog.after")}
        confirmLabel={t("settings:deleteAccount.dialog.confirm")}
        word={word}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setAsking(false)}
      />
    </SectionCard>
  );
}
