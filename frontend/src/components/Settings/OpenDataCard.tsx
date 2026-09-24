import { useState } from "react";
import type { JSX } from "react";

import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";

/**
 * The instance's open data switch (2026-09-24): Open-Meteo, Wikipedia and
 * OpenStreetMap. Off until an admin turns it on, because every use sends a
 * place and a date to a third party and the sign-in page promises that nothing
 * leaves the instance unless it is set up.
 *
 * Everyone sees the state; only an admin can flip it. The store takes the
 * value the server CONFIRMED, never the one the switch asked for.
 */
export default function OpenDataCard({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useTranslation(["openData"]);
  const enabled = useSettingsStore((s) => s.openDataEnabled) === true;
  const syncOpenDataEnabled = useSettingsStore((s) => s.syncOpenDataEnabled);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async (on: boolean): Promise<void> => {
    setSaving(true);
    setFailed(false);
    try {
      const { settings } = await adminApi.updateInstanceSettings({ openDataEnabled: on });
      syncOpenDataEnabled(settings.openDataEnabled);
    } catch (err) {
      logger.warn("Saving the open data switch failed", err);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("openData:settings.title")}
        description={t("openData:settings.description")}
      />
      <SettingRows>
        {isAdmin ? (
          <Switch
            id="open-data-enabled"
            checked={enabled}
            disabled={saving}
            onChange={(on) => void toggle(on)}
            label={t("openData:settings.switch")}
            sub={t("openData:settings.switchSub")}
          />
        ) : (
          <p className="t-caption">
            {enabled ? t("openData:settings.stateOn") : t("openData:settings.stateOff")} ·{" "}
            {t("openData:settings.adminOnly")}
          </p>
        )}
        {failed && (
          <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t("openData:settings.saveFailed")}
          </p>
        )}
      </SettingRows>
    </SectionCard>
  );
}
