import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { CruiseSettings } from "../../store/settingsStore";
import { Switch } from "../ui/Field";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";

/** A radio value cannot be null; this stands for "no default cabin". */
const NO_CABIN = "none";

interface CruisePreferencesSectionProps {
  cruise: CruiseSettings;
  onSetCruise: (partial: Partial<CruiseSettings>) => void;
}

const CABIN_TYPES: Array<CruiseSettings["defaultCabinType"]> = [
  null,
  "inside",
  "oceanview",
  "balcony",
  "suite",
];

/**
 * Cruise-domain preferences section. Small but real — sets the defaults
 * that "Neue Kreuzfahrt → Manuell" prefills (line + cabin type) and the
 * map-layer toggle. Lives in the cruise tab scaffolded in commit
 * fbbcd13; future cruise-specific sections (route preferences, cruise
 * API keys, …) can be added alongside this one.
 */
export default function CruisePreferencesSection({
  cruise,
  onSetCruise,
}: CruisePreferencesSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "cruise"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:cruisePreferences.title")}
        description={t("settings:cruisePreferences.description")}
      />

      <SettingRows>
        <SettingRow
          title={t("settings:cruisePreferences.defaultLine")}
          sub={t("settings:cruisePreferences.defaultLineHint")}
          htmlFor="cruise-default-line"
          control={
            <input
              id="cruise-default-line"
              type="text"
              className="input"
              style={{ minWidth: 240 }}
              value={cruise.defaultLine}
              onChange={(e): void => onSetCruise({ defaultLine: e.target.value })}
              placeholder={t("settings:cruisePreferences.defaultLinePlaceholder")}
            />
          }
        />
        <SettingRow
          title={t("settings:cruisePreferences.defaultCabin")}
          control={
            <Segmented
              label={t("settings:cruisePreferences.defaultCabin")}
              value={cruise.defaultCabinType ?? NO_CABIN}
              options={CABIN_TYPES.map((cabin) =>
                cabin === null
                  ? {
                      value: NO_CABIN,
                      label: t("settings:defaults.options.noneShort"),
                      name: t("settings:cruisePreferences.defaultCabinNone"),
                    }
                  : { value: cabin, label: t(`cruise:cabinType.${cabin}`) }
              )}
              onChange={(value): void =>
                onSetCruise({
                  defaultCabinType:
                    value === NO_CABIN
                      ? null
                      : (value as NonNullable<CruiseSettings["defaultCabinType"]>),
                })
              }
            />
          }
        />
        <Switch
          id="cruise-show-arcs"
          checked={cruise.showCruiseArcs}
          onChange={(on): void => onSetCruise({ showCruiseArcs: on })}
          label={t("settings:cruisePreferences.showArcs")}
          sub={t("settings:cruisePreferences.showArcsHint")}
        />
      </SettingRows>
    </SectionCard>
  );
}
