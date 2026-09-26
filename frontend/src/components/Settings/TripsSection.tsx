import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * Settings that belong to trips rather than to any one domain (owner,
 * 2026-08-23). Trips are no domain (`DOMAIN_KEYS` is flight|cruise|lodging|
 * poi), so this section is always visible — no domain gate applies.
 *
 * The automatic-trip switch moved here from the list importer: it decides
 * what an import DOES with flights that share a booking reference, which is a
 * question about trips, and a setting lives in exactly one place (owner
 * decision, against "show it in both").
 */
export default function TripsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const autoCreateTrips = useSettingsStore((s) => s.autoCreateTrips);
  const setAutoCreateTrips = useSettingsStore((s) => s.setAutoCreateTrips);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:trips.title")}
        description={t("settings:trips.description")}
      />
      {/* Persists immediately via the store's setter (like the base currency). */}
      <SettingRows>
        <Switch
          id="trips-auto-create-trips"
          checked={autoCreateTrips}
          onChange={setAutoCreateTrips}
          label={t("settings:trips.autoCreateTrips.label")}
          sub={t("settings:trips.autoCreateTrips.description")}
        />
      </SettingRows>
    </SectionCard>
  );
}
