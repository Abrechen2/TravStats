import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Select, Switch } from "../ui/Field";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { useSettingsStore } from "../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { TRIP_COLORS } from "../../lib/tripColors";

/** A select value cannot be null; this stands for "automatic". */
const AUTOMATIC = "auto";

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
  // The server's preference (forgejo#321): every new trip that names no colour
  // — an import, a suggestion, the "new trip" form — starts with it.
  const tripColor = useSuggestionSwitchesStore((s) => s.tripDefaultColor);
  const setTripColor = useSuggestionSwitchesStore((s) => s.setTripDefaultColor);

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
        <SettingRow
          title={t("settings:trips.defaultColor.label")}
          sub={t("settings:trips.defaultColor.description")}
          htmlFor="trips-default-color"
          control={
            <>
              <span
                aria-hidden
                data-testid="trips-default-color-swatch"
                className="inline-block rounded-full"
                style={{
                  width: 20,
                  height: 20,
                  background: tripColor ?? "transparent",
                  border: tripColor ? "none" : "1px dashed var(--ts-border-input)",
                }}
              />
              <Select
                id="trips-default-color"
                value={tripColor ?? AUTOMATIC}
                onChange={(e) => setTripColor(e.target.value === AUTOMATIC ? null : e.target.value)}
              >
                <option value={AUTOMATIC}>{t("settings:trips.defaultColor.automatic")}</option>
                {TRIP_COLORS.map((color) => (
                  <option key={color} value={color}>
                    {t(`settings:trips.defaultColor.colors.${color.slice(1)}`)}
                  </option>
                ))}
              </Select>
            </>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
