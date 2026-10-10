import { useCallback, useEffect, useState, type JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { failureKey, isImmichFailureKind } from "../../lib/api/immich";
import { photoJourneysApi, type PhotoJourneyNightlySettings } from "../../lib/api/photoJourneys";
import Button from "../ui/Button";
import { Switch } from "../ui/Field";
import Toggletip from "../ui/Toggletip";
import { token } from "../ui/tokens";

import DemoLockedNotice from "./DemoLockedNotice";
import { SectionCard, SectionTitle } from "./SettingsShared";

/**
 * The account's opt-in to the nightly photo scan (forgejo#94, point 1 — the
 * last one: the opt-in existed on the server and nothing on the web reached
 * it, so the scan was off for everybody).
 *
 * It says what the switch does before it is touched: when it runs, how far
 * back it reads, what leaves the house (positions to the place-name service,
 * never pictures), what it needs (an Immich connection — the shared demo
 * account has none, by design), and how the LAST run for this account ended,
 * because an opt-in failing every night behind a switch reading "on" is the
 * silent failure this card exists to end.
 *
 * Until the setting has loaded the switch is not drawn: showing "off" for a
 * value nobody read would be a claim this side has not established.
 */
export default function PhotoJourneyNightlyScanCard(): JSX.Element {
  const { t } = useTranslation(["immich", "settings"]);
  const format = useDisplayFormat();
  const isDemo = useIsDemoAccount();
  const [settings, setSettings] = useState<PhotoJourneyNightlySettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      setSettings(await photoJourneysApi.getNightlySettings());
    } catch (error) {
      logger.warn("Loading the nightly photo-scan setting failed:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (next: boolean): Promise<void> => {
    setSaving(true);
    setSaveFailed(false);
    try {
      setSettings(await photoJourneysApi.setNightlyScan(next));
    } catch (error) {
      logger.warn("Saving the nightly photo-scan setting failed:", error);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("immich:nightlyScan.title")}
        description={t("immich:nightlyScan.subtitle")}
        whenUnreachable={t("settings:unreachable.photoJourneyScan")}
      />
      {loadFailed ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <p role="alert" className="text-sm" style={{ color: token("bad") }}>
            {t("immich:nightlyScan.loadFailed")}
          </p>
          <Button onClick={() => void load()}>{t("immich:nightlyScan.retry")}</Button>
        </div>
      ) : !settings ? (
        <p className="t-caption">{t("immich:nightlyScan.loading")}</p>
      ) : (
        <NightlyScanBody
          settings={settings}
          isDemo={isDemo}
          saving={saving}
          saveFailed={saveFailed}
          onToggle={(next) => void handleToggle(next)}
          format={format}
        />
      )}
    </SectionCard>
  );
}

function NightlyScanBody({
  settings,
  isDemo,
  saving,
  saveFailed,
  onToggle,
  format,
}: {
  settings: PhotoJourneyNightlySettings;
  isDemo: boolean;
  saving: boolean;
  saveFailed: boolean;
  onToggle: (next: boolean) => void;
  format: ReturnType<typeof useDisplayFormat>;
}): JSX.Element {
  const { t } = useTranslation(["immich"]);
  const k = (key: string) => `immich:nightlyScan.${key}`;
  return (
    <>
      {isDemo ? (
        <DemoLockedNotice />
      ) : (
        <Switch
          id="photo-journey-nightly-scan"
          checked={settings.nightlyScan}
          disabled={saving}
          onChange={onToggle}
          label={t(k("switch"))}
          sub={t(k("what"), {
            days: settings.windowDays,
            next: format.dateTime(settings.nextRunAt),
          })}
        />
      )}
      <p className="t-caption flex items-center" style={{ gap: "var(--ts-space-xs)" }}>
        <span>{t(k("privacy"))}</span>
        <Toggletip
          subject={t(k("switch"))}
          content={t(k("privacyHelp"))}
          expandedContent={t(k("privacyHelpMore"))}
        />
      </p>
      {/* The demo account is a different case, not a missing step: there is
          no connection to set up, so it is not told to set one up. */}
      {!settings.immichConnected && (
        <p role="note" className="text-sm" style={{ color: token("warn") }}>
          {t(k(isDemo ? "notConnectedDemo" : "notConnected"))}
        </p>
      )}
      <p className="text-sm" role="status">
        {lastRunText(settings, t, format)}
      </p>
      {/* Only the NIGHTLY run is recorded: the card answers "is my opt-in
          working", and a manual scan's success would hide a nightly failure.
          A manual scan reports its own outcome where it is started. */}
      <p className="t-caption">{t(k("manualNote"))}</p>
      {saveFailed && (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t(k(settings.nightlyScan ? "saveFailedOn" : "saveFailedOff"))}
        </p>
      )}
    </>
  );
}

function lastRunText(
  settings: PhotoJourneyNightlySettings,
  t: (key: string, options?: Record<string, unknown>) => string,
  format: ReturnType<typeof useDisplayFormat>
): string {
  const run = settings.lastRun;
  if (!run) return t("immich:nightlyScan.lastRun.never");
  const when = format.dateTime(run.ranAt);
  if (run.result === "scanned") {
    return t("immich:nightlyScan.lastRun.scanned", { when, count: run.created ?? 0 });
  }
  if (run.result === "noImmich") return t("immich:nightlyScan.lastRun.noImmich", { when });
  const reason =
    run.failure && isImmichFailureKind(run.failure)
      ? t(`immich:${failureKey(run.failure)}`)
      : t("immich:nightlyScan.lastRun.internal");
  return t("immich:nightlyScan.lastRun.failed", { when, reason });
}
