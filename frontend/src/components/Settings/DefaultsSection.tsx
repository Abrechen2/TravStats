import { FieldLabel, SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { DefaultsSettings } from "../../store/settingsStore";

interface DefaultsSectionProps {
  defaults: DefaultsSettings;
  onSetDefaults: (partial: Partial<DefaultsSettings>) => void;
}

export default function DefaultsSection({
  defaults,
  onSetDefaults,
}: DefaultsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:defaults.title")}
        description={t("settings:defaults.description")}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel help={t("settings:defaults.help.status")}>{t("settings:defaults.flightStatus")}</FieldLabel>
          <select
            value={defaults.flightStatus}
            onChange={(e) =>
              onSetDefaults({ flightStatus: e.target.value as typeof defaults.flightStatus })
            }
            className="input"
          >
            <option value="scheduled">{t("settings:defaults.options.scheduled")}</option>
            <option value="flown">{t("settings:defaults.options.flown")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("settings:defaults.seatClass")}</label>
          <select
            value={defaults.seatClass}
            onChange={(e) =>
              onSetDefaults({ seatClass: e.target.value as typeof defaults.seatClass })
            }
            className="input"
          >
            <option value="">{t("settings:defaults.options.none")}</option>
            <option value="economy">{t("settings:defaults.options.economy")}</option>
            <option value="premium_economy">
              {t("settings:defaults.options.premium_economy")}
            </option>
            <option value="business">{t("settings:defaults.options.business")}</option>
            <option value="first">{t("settings:defaults.options.first")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("settings:defaults.favoriteAirline")}</label>
          <input
            type="text"
            value={defaults.favoriteAirline}
            onChange={(e) => onSetDefaults({ favoriteAirline: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <FieldLabel help={t("settings:defaults.help.category")}>{t("settings:defaults.flightCategory")}</FieldLabel>
          <select
            value={defaults.flightCategory}
            onChange={(e) =>
              onSetDefaults({ flightCategory: e.target.value as typeof defaults.flightCategory })
            }
            className="input"
          >
            <option value="">{t("settings:defaults.options.none")}</option>
            <option value="business">{t("settings:defaults.options.business")}</option>
            <option value="private">{t("settings:defaults.options.private")}</option>
            <option value="vacation">{t("settings:defaults.options.vacation")}</option>
          </select>
        </div>
      </div>
    </SectionCard>
  );
}
