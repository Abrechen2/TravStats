/**
 * Anmeldung: password, second factor, backup codes and passkeys, one row each.
 *
 * Once-revealed UX: the backup codes exist in plaintext exactly once, in
 * component state, and are gone on refresh. Regenerating is the way back —
 * recovering the old sheet is not. Every failure is a line under its own row,
 * in the design's first person; a status that could not be read is said, not
 * assumed to be "off".
 */

import { useEffect, useState, type JSX } from "react";
import { QRCodeSVG } from "qrcode.react";

import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import Button from "../ui/Button";
import { Input } from "../ui/Field";
import {
  ActionControl,
  ErrorLine,
  LinkButton,
  SettingItem,
  StatusValue,
  SwitchControl,
} from "../ui/settings";
import PasskeySection from "./PasskeySection";
import { useBlockConfirm } from "./useBlockConfirm";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { twoFactorApi } from "../../lib/api";
import { logger } from "../../lib/logger";

/** `codes` is the one-shot reveal; it is reachable from setup and from a
 *  regeneration, so it is a stage rather than a flag on either. */
type Stage = "loading" | "unknown" | "off" | "setup" | "codes" | "on";

/** Which password-gated action the prompt is currently collecting for. */
type PasswordIntent = "disable" | "regenerate" | null;

interface SecuritySectionProps {
  /** Opens the password dialog the settings page owns. */
  onChangePassword?: () => void;
}

export default function SecuritySection({ onChangePassword }: SecuritySectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const isDemo = useIsDemoAccount();
  const { confirm: askConfirm, dialog: confirmDialog } = useBlockConfirm();
  const [stage, setStage] = useState<Stage>("loading");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesLeft, setCodesLeft] = useState(0);
  const [intent, setIntent] = useState<PasswordIntent>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ row: "factor" | "codes"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = (): void => {
    setStage("loading");
    twoFactorApi
      .getTwoFactorStatus()
      .then((status) => {
        setCodesLeft(status.recoveryCodesLeft);
        setStage(status.enabled ? "on" : "off");
      })
      .catch((err) => {
        // Never guess "off": an account that has the factor on would be shown
        // an enable switch, and switching it on again is not harmless.
        logger.error("Failed to read two-factor status", err);
        setStage("unknown");
      });
  };

  // Empty dep array on purpose: the project's useTranslation wrapper does not
  // give a stable `t`.
  useEffect(loadStatus, []);

  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

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
      setError({ row: "factor", text: t("settings:security.setupFailed") });
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
      setError({ row: "factor", text: t("settings:security.wrongCode") });
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
    if (intent === "regenerate") {
      const go = await askConfirm({
        title: t("settings:security.regenerateDialog.title"),
        affects: t("settings:security.regenerateDialog.affects"),
        amount: t("settings:security.regenerateDialog.amount", { count: codesLeft }),
        after: t("settings:security.regenerateDialog.after"),
        confirmLabel: t("settings:security.regenerateDialog.confirm"),
      });
      if (!go) return;
    }
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
      setError({
        row: intent === "disable" ? "factor" : "codes",
        text: t("settings:security.wrongPassword"),
      });
    } finally {
      setBusy(false);
    }
  };

  const on = stage === "on" || (stage === "codes" && recoveryCodes.length > 0);
  const promptFor = (which: Exclude<PasswordIntent, null>): JSX.Element | null =>
    intent === which ? (
      <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("settings:security.passwordLabel")}</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
          <Button
            variant="primary"
            disabled={busy || password === ""}
            onClick={() => void submitPassword()}
          >
            {which === "disable"
              ? t("settings:security.confirmDisable")
              : t("settings:security.confirmRegenerate")}
          </Button>
          <Button variant="secondary" onClick={() => setIntent(null)}>
            {t("common:buttons.cancel")}
          </Button>
        </span>
      </div>
    ) : null;

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.password.name")}
          locked={locked}
          control={
            onChangePassword ? (
              <ActionControl
                label={t("settings:security.passwordChange")}
                onClick={onChangePassword}
              />
            ) : undefined
          }
        />

        <SettingItem
          title={t("settings:rows.twoFactor.name")}
          sub={t("settings:rows.twoFactor.sub")}
          help={t("settings:rows.twoFactor.help")}
          locked={locked}
          error={error?.row === "factor" ? error.text : undefined}
          control={
            stage === "loading" ? (
              <StatusValue>…</StatusValue>
            ) : stage === "unknown" ? undefined : (
              <SwitchControl
                checked={on || stage === "setup"}
                label={t("settings:rows.twoFactor.name")}
                onChange={(next) => {
                  if (busy || stage === "setup") return;
                  if (next) void startSetup();
                  else openPrompt("disable");
                }}
              />
            )
          }
        >
          {stage === "unknown" && (
            <p
              className="t-caption flex flex-wrap items-center"
              style={{ gap: "var(--ts-space-sm)", margin: 0 }}
            >
              <ErrorLine>{t("settings:security.statusFailed")}</ErrorLine>
              <LinkButton onClick={loadStatus}>{t("settings:blocks.save.retry")}</LinkButton>
            </p>
          )}
          {stage === "setup" && (
            <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
              <p className="text-sm" style={{ margin: 0 }}>
                {t("settings:security.scanHint")}
              </p>
              <QRCodeSVG value={otpauthUrl} size={168} />
              <p className="t-caption" style={{ margin: 0 }}>
                {t("settings:security.manualHint")}
              </p>
              <p className="text-xs font-mono" style={{ margin: 0 }}>
                {secret}
              </p>
              <label className="flex flex-col" style={{ gap: 4 }}>
                <span className="t-caption">{t("settings:security.codeLabel")}</span>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </label>
              <span className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                <Button variant="primary" disabled={busy} onClick={() => void activate()}>
                  {t("settings:security.activate")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setError(null);
                    setStage("off");
                  }}
                >
                  {t("common:buttons.cancel")}
                </Button>
              </span>
            </div>
          )}
          {promptFor("disable")}
        </SettingItem>

        <SettingItem
          title={t("settings:rows.backupCodes.name")}
          sub={t("settings:rows.backupCodes.sub")}
          help={t("settings:rows.backupCodes.help")}
          locked={locked}
          dependency={
            on || stage === "loading" || stage === "setup" || stage === "unknown"
              ? undefined
              : { reason: t("settings:security.needsTwoFactor") }
          }
          error={error?.row === "codes" ? error.text : undefined}
          control={
            on ? (
              <ActionControl
                label={t("settings:security.regenerate")}
                onClick={() => openPrompt("regenerate")}
              />
            ) : (
              <ActionControl label={t("settings:security.regenerate")} onClick={() => undefined} />
            )
          }
        >
          {on && stage !== "codes" && (
            <p className="t-caption" style={{ margin: 0 }}>
              {t("settings:security.enabled", { count: codesLeft })}
            </p>
          )}
          {stage === "codes" && (
            <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
              <p className="text-sm" style={{ margin: 0 }}>
                {t("settings:security.saveCodes")}
              </p>
              <ul className="font-mono text-sm">
                {recoveryCodes.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
              <span>
                <Button variant="secondary" onClick={() => setStage("on")}>
                  {t("common:buttons.done")}
                </Button>
              </span>
            </div>
          )}
          {promptFor("regenerate")}
        </SettingItem>

        {/* A passkey replaces the password rather than adding to it, so neither
            switch above depends on it. */}
        <PasskeySection />
      </SettingRows>
      {confirmDialog}
    </SectionCard>
  );
}
