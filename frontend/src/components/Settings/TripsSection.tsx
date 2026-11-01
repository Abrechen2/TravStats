import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { ChoiceControl, SettingItem, SwitchControl, useSettingWrite } from "../ui/settings";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useSettingsStore } from "../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { TRIP_COLORS } from "../../lib/tripColors";
import { saveAutoCreateTrips, saveSwitch } from "../../store/confirmedSettings";
import { useRowCopy } from "./rowCopy";

/** A select value cannot be null; this stands for "automatic". */
const AUTOMATIC = "auto";

/**
 * "Reisen" (settings rebuild, design §4 A5): the settings that belong to trips
 * rather than to any one domain. Both rows write at once and keep the user's
 * choice when the server refuses (B6); the stores take a value only after the
 * server confirmed it, so no later save of the document carries a refused one.
 *
 * The automatic-trip switch decides what an import DOES with flights that
 * share a booking reference — a question about trips, and a setting lives in
 * exactly one place (owner, 2026-08-23).
 */
export default function TripsSection(): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const row = useRowCopy("trips");
  const isDemo = useIsDemoAccount();
  const savedAuto = useSettingsStore((s) => s.autoCreateTrips);
  const savedColor = useSuggestionSwitchesStore((s) => s.tripDefaultColor);

  const auto = useSettingWrite<boolean>("trips.autoCreateTrips", savedAuto, (on, o) =>
    saveAutoCreateTrips(on, o)
  );
  // The server's preference (forgejo#321): every new trip that names no colour
  // — an import, a suggestion, the "new trip" form — starts with it.
  const color = useSettingWrite<string>("trips.defaultColor", savedColor ?? AUTOMATIC, (v, o) =>
    saveSwitch("tripDefaultColor", v === AUTOMATIC ? null : v, o)
  );
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const autoCopy = row("autoreise");
  const colorCopy = row("reisefarbe");
  const swatch = color.value === AUTOMATIC ? null : color.value;

  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:trips.sections.trips")} />
      <SettingRows>
        <SettingItem
          title={autoCopy.title}
          sub={autoCopy.sub}
          help={autoCopy.help}
          save={auto}
          locked={locked}
          control={<SwitchControl checked={auto.value} onChange={auto.choose} />}
        />
        <SettingItem
          title={colorCopy.title}
          sub={colorCopy.sub}
          save={color}
          locked={locked}
          control={
            // Swatch and select stay on one line; the swatch alone must not
            // wrap above the select on a narrower row (iPad, forgejo#321).
            <span className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
              <span
                aria-hidden
                data-testid="trips-default-color-swatch"
                className="inline-block shrink-0 rounded-full"
                style={{
                  width: 20,
                  height: 20,
                  background: swatch ?? "transparent",
                  border: swatch ? "none" : "1px dashed var(--ts-border-input)",
                }}
              />
              <ChoiceControl<string>
                label={colorCopy.title}
                value={color.value}
                onChange={color.choose}
                options={[
                  { value: AUTOMATIC, label: t("settings:trips.defaultColor.automatic") },
                  ...TRIP_COLORS.map((c) => ({
                    value: c as string,
                    label: t(`settings:trips.defaultColor.colors.${c.slice(1)}`),
                  })),
                ]}
              />
            </span>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
