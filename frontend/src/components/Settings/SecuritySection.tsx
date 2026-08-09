/**
 * Two-factor authentication, under Settings → Security.
 *
 * Once-revealed UX, same contract as the API tokens section: the recovery
 * codes exist in plaintext exactly once, in component state, and are gone on
 * refresh. Regenerating is the way back — recovering the old sheet is not.
 */

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { SectionCard, SectionTitle } from "./SettingsShared";
import PasskeySection from "./PasskeySection";
import { useTranslation } from "../../hooks/useTranslation";
import { twoFactorApi } from "../../lib/api";
import { logger } from "../../lib/logger";

/** `codes` is the one-shot reveal; it is reachable from setup and from a
 *  regeneration, so it is a stage rather than a flag on either. */
type Stage = "loading" | "off" | "setup" | "codes" | "on";

/** Which password-gated action the prompt is currently collecting for. */
type PasswordIntent = "disable" | "regenerate" | null;

export default function SecuritySection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [stage, setStage] = useState<Stage>("loading");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesLeft, setCodesLeft] = useState(0);
  const [intent, setIntent] = useState<PasswordIntent>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Empty dep array on purpose — see the note in ApiTokensSection: the
  // project's useTranslation wrapper does not give a stable `t`.
  useEffect(() => {
    void twoFactorApi
      .getTwoFactorStatus()
      .then((status) => {
        setCodesLeft(status.recoveryCodesLeft);
        setStage(status.enabled ? "on" : "off");
      })
      .catch((err) => {
        logger.error("Failed to read two-factor status", err);
        setStage("off");
      });
  }, []);

  const startSetup = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const result = await twoFactorApi.setupTwoFactor();
      setSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      setCode("");
      setStage("setup");
    } catch (err) {
      logger.error("Failed to start two-factor setup", err);
      setError(t("settings:security.setupFailed"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const result = await twoFactorApi.activateTwoFactor(code);
      setRecoveryCodes(result.recoveryCodes);
      setCodesLeft(result.recoveryCodes.length);
      setStage("codes");
    } catch {
      // Deliberately stays on "setup": the QR code must remain on screen so a
      // mistyped digit does not mean starting over with a new secret.
      setError(t("settings:security.wrongCode"));
    } finally {
      setBusy(false);
    }
  };

  const openPrompt = (next: PasswordIntent): void => {
    setIntent(next);
    setPassword("");
    setError(null);
  };

  const submitPassword = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (intent === "disable") {
        await twoFactorApi.disableTwoFactor(password);
        setSecret("");
        setOtpauthUrl("");
        setRecoveryCodes([]);
        setCodesLeft(0);
        setStage("off");
      } else {
        const result = await twoFactorApi.regenerateRecoveryCodes(password);
        setRecoveryCodes(result.recoveryCodes);
        setCodesLeft(result.recoveryCodes.length);
        setStage("codes");
      }
      setIntent(null);
      setPassword("");
    } catch {
      setError(t("settings:security.wrongPassword"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:security.title")}
        description={t("settings:security.description")}
      />

      {stage === "on" && (
        <div className="space-y-3">
          <p className="text-sm">{t("settings:security.enabled", { count: codesLeft })}</p>
          {/* Stated plainly rather than hidden: a token bypasses this entirely. */}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("settings:security.tokenWarning")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openPrompt("regenerate")}
            >
              {t("settings:security.regenerate")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => openPrompt("disable")}>
              {t("settings:security.disable")}
            </button>
          </div>
        </div>
      )}

      {stage === "off" && (
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void startSetup()}
        >
          {t("settings:security.enable")}
        </button>
      )}

      {stage === "setup" && (
        <div className="space-y-3">
          <p className="text-sm">{t("settings:security.scanHint")}</p>
          <QRCodeSVG value={otpauthUrl} size={168} />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("settings:security.manualHint")}
          </p>
          <p className="text-xs font-mono">{secret}</p>

          <label
            className="block text-sm font-medium mb-1.5"
            style={{ color: "var(--text-secondary)" }}
            htmlFor="activate-code"
          >
            {t("settings:security.codeLabel")}
          </label>
          <input
            id="activate-code"
            className="input w-full"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
          />

          {error && (
            <div role="alert" className="text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void activate()}
            >
              {t("settings:security.activate")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStage("off")}>
              {t("common:buttons.cancel")}
            </button>
          </div>
        </div>
      )}

      {stage === "codes" && (
        <div className="space-y-2">
          <p className="text-sm">{t("settings:security.saveCodes")}</p>
          <ul className="font-mono text-sm">
            {recoveryCodes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <button type="button" className="btn-secondary" onClick={() => setStage("on")}>
            {t("common:buttons.done")}
          </button>
        </div>
      )}

      {intent !== null && (
        <div className="mt-4 space-y-2">
          <label
            className="block text-sm font-medium mb-1.5"
            style={{ color: "var(--text-secondary)" }}
            htmlFor="twofa-password"
          >
            {t("settings:security.passwordLabel")}
          </label>
          <input
            id="twofa-password"
            type="password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          {error && (
            <div role="alert" className="text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void submitPassword()}
            >
              {intent === "disable"
                ? t("settings:security.confirmDisable")
                : t("settings:security.confirmRegenerate")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setIntent(null)}>
              {t("common:buttons.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Passkeys sit under the TOTP block: same section, independent feature.
          A passkey replaces the password rather than adding to it, so neither
          switch depends on the other. */}
      <PasskeySection />
    </SectionCard>
  );
}
