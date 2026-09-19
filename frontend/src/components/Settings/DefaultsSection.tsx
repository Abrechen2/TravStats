import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { DefaultsSettings } from "../../store/settingsStore";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";

interface DefaultsSectionProps {
  defaults: DefaultsSettings;
  onSetDefaults: (partial: Partial<DefaultsSettings>) => void;
}

const STATUSES = ["scheduled", "flown"] as const;
const SEAT_CLASSES = ["", "economy", "premium_economy", "business", "first"] as const;
const CATEGORIES = ["", "business", "private", "vacation"] as const;

export default function DefaultsSection({
  defaults,
  onSetDefaults,
}: DefaultsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  /** "" is "no default" — a short pill label, the long sentence spoken. */
  const option = <T extends string>(value: T): { value: T; label: string; name?: string } =>
    value === ""
      ? {
          value,
          label: t("settings:defaults.options.noneShort"),
          name: t("settings:defaults.options.none"),
        }
      : { value, label: t(`settings:defaults.options.${value}`) };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:defaults.title")}
        description={t("settings:defaults.description")}
      />
      <SettingRows>
        <SettingRow
          title={t("settings:defaults.flightStatus")}
          sub={t("settings:defaults.help.status")}
          control={
            <Segmented
              label={t("settings:defaults.flightStatus")}
              value={defaults.flightStatus}
              options={STATUSES.map(option)}
              onChange={(flightStatus) => onSetDefaults({ flightStatus })}
            />
          }
        />
        <SettingRow
          title={t("settings:defaults.seatClass")}
          control={
            <Segmented
              label={t("settings:defaults.seatClass")}
              value={defaults.seatClass}
              options={SEAT_CLASSES.map(option)}
              onChange={(seatClass) => onSetDefaults({ seatClass })}
            />
          }
        />
        <SettingRow
          title={t("settings:defaults.flightCategory")}
          sub={t("settings:defaults.help.category")}
          control={
            <Segmented
              label={t("settings:defaults.flightCategory")}
              value={defaults.flightCategory}
              options={CATEGORIES.map(option)}
              onChange={(flightCategory) => onSetDefaults({ flightCategory })}
            />
          }
        />
        <SettingRow
          title={t("settings:defaults.favoriteAirline")}
          htmlFor="defaults-favorite-airline"
          control={
            <input
              id="defaults-favorite-airline"
              type="text"
              value={defaults.favoriteAirline}
              onChange={(e) => onSetDefaults({ favoriteAirline: e.target.value })}
              className="input"
              style={{ minWidth: 240 }}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
