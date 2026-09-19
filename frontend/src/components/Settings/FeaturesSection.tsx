import { SectionCard, SectionTitle } from "./SettingsShared";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";

export default function FeaturesSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { features, setFeatures } = useSettingsStore();

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:features.title")}
        description={t("settings:features.description")}
      />
      <SettingRows>
        <Switch
          id="feature-cost-tracking"
          checked={features.enableCostTracking}
          onChange={(on) => setFeatures({ enableCostTracking: on })}
          label={t("settings:features.costTracking")}
          sub={t("settings:features.costTrackingDesc")}
        />
        <Switch
          id="feature-track-aircraft"
          checked={features.trackAircraftRegistration}
          onChange={(on) => setFeatures({ trackAircraftRegistration: on })}
          label={t("settings:features.trackAircraft")}
          sub={t("settings:features.trackAircraftDesc")}
        />
      </SettingRows>
    </SectionCard>
  );
}
