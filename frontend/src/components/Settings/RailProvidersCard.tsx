import { useEffect, useState } from "react";
import type { JSX } from "react";

import RailRoutingUrlSetting from "./RailRoutingUrlSetting";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useDomainOffered } from "../../hooks/useDomainVisible";
import { useExpertRows } from "./frame/useExpertRows";
import { ExpertPill } from "../ui/ExpertPill";

type Switches = { railTransitousEnabled: boolean; railDbRestEnabled: boolean };

/** What the card last read or saved — for the services accordion's badges and header. */
export interface RailProvidersStatus extends Switches {
  railRoutingUrl: string | null;
}

/**
 * Which timetable services the rail train lookup may ask (spec
 * 2026-09-25-rail-domain, phase 2). Admin-only, and only where the rail
 * domain is offered at all: every lookup sends a train number, a station and
 * a day from this self-hosted instance to a volunteer-run third party.
 *
 * A failed load shows the failure and no switches — never switches in a
 * guessed position whose click would write that guess back.
 */
export default function RailProvidersCard({
  isAdmin,
  onStatus,
}: {
  isAdmin: boolean;
  onStatus?: (status: RailProvidersStatus) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const offered = useDomainOffered("rail");
  const [switches, setSwitches] = useState<Switches | null>(null);
  const [routingUrl, setRoutingUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Which services may be asked is a standard decision; where a self-hosted
  // routing engine lives is plumbing. Nothing is hidden when the card is not
  // drawn at all.
  const expert = useExpertRows(isAdmin && offered ? 1 : 0);

  useEffect(() => {
    if (switches) onStatus?.({ ...switches, railRoutingUrl: routingUrl });
  }, [switches, routingUrl, onStatus]);

  useEffect(() => {
    if (!isAdmin || !offered) return;
    let cancelled = false;
    adminApi
      .getInstanceSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setSwitches({
          railTransitousEnabled: settings.railTransitousEnabled,
          railDbRestEnabled: settings.railDbRestEnabled,
        });
        setRoutingUrl(settings.railRoutingUrl ?? null);
      })
      .catch((err: unknown) => {
        logger.warn("Loading the rail lookup switches failed", err);
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, offered]);

  if (!isAdmin || !offered) return null;

  const toggle = async (key: keyof Switches, on: boolean): Promise<void> => {
    setSaving(true);
    setSaveFailed(false);
    try {
      const { settings } = await adminApi.updateInstanceSettings({ [key]: on });
      // The value the server CONFIRMED, not the one the switch asked for.
      setSwitches({
        railTransitousEnabled: settings.railTransitousEnabled,
        railDbRestEnabled: settings.railDbRestEnabled,
      });
    } catch (err) {
      logger.warn("Saving a rail lookup switch failed", err);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:railProviders.title")}
        description={t("settings:railProviders.description")}
        whenUnreachable={t("settings:unreachable.rail")}
      />
      <SettingRows>
        {loadFailed && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t("settings:railProviders.loadError")}
          </p>
        )}
        {switches && (
          <>
            <Switch
              id="rail-transitous-enabled"
              checked={switches.railTransitousEnabled}
              disabled={saving}
              onChange={(on) => void toggle("railTransitousEnabled", on)}
              label={t("settings:railProviders.transitous")}
              sub={t("settings:railProviders.transitousHint")}
            />
            <Switch
              id="rail-db-rest-enabled"
              checked={switches.railDbRestEnabled}
              disabled={saving}
              onChange={(on) => void toggle("railDbRestEnabled", on)}
              label={t("settings:railProviders.dbRest")}
              sub={t("settings:railProviders.dbRestHint")}
            />
            {expert && (
              <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
                <ExpertPill />
                <RailRoutingUrlSetting savedUrl={routingUrl} onSaved={setRoutingUrl} />
              </div>
            )}
          </>
        )}
        {saveFailed && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t("settings:railProviders.saveError")}
          </p>
        )}
      </SettingRows>
    </SectionCard>
  );
}
