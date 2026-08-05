import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { CruiseSettings } from "../../store/settingsStore";

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="cruise-default-line">
            {t("settings:cruisePreferences.defaultLine")}
          </label>
          <input
            id="cruise-default-line"
            type="text"
            className="input"
            value={cruise.defaultLine}
            onChange={(e): void => onSetCruise({ defaultLine: e.target.value })}
            placeholder={t("settings:cruisePreferences.defaultLinePlaceholder")}
          />
          <p className="mt-1 text-xs text-(--text-muted)">
            {t("settings:cruisePreferences.defaultLineHint")}
          </p>
        </div>

        <div>
          <label className="label" htmlFor="cruise-default-cabin">
            {t("settings:cruisePreferences.defaultCabin")}
          </label>
          <select
            id="cruise-default-cabin"
            className="input"
            value={cruise.defaultCabinType ?? ""}
            onChange={(e): void =>
              onSetCruise({
                defaultCabinType:
                  e.target.value === ""
                    ? null
                    : (e.target.value as NonNullable<CruiseSettings["defaultCabinType"]>),
              })
            }
          >
            {CABIN_TYPES.map((cabin) => (
              <option key={cabin ?? "none"} value={cabin ?? ""}>
                {cabin === null
                  ? t("settings:cruisePreferences.defaultCabinNone")
                  : t(`cruise:cabinType.${cabin}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cruise.showCruiseArcs}
            onChange={(e): void => onSetCruise({ showCruiseArcs: e.target.checked })}
            className="accent-(--accent)"
          />
          <span className="text-sm text-(--text-primary)">
            {t("settings:cruisePreferences.showArcs")}
          </span>
        </label>
        <p className="mt-1 ml-6 text-xs text-(--text-muted)">
          {t("settings:cruisePreferences.showArcsHint")}
        </p>
      </div>
    </SectionCard>
  );
}
