import { SectionCard, SectionTitle } from "./SettingsShared";
import { useSettingsStore } from "../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { useSectionVisibility } from "../../hooks/useSectionVisibility";
import { useTranslation } from "../../hooks/useTranslation";
import { useExpertRows } from "./frame/useExpertRows";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";

/** The statistics section the seat switch shows or hides (`useStatsPageSections`). */
const SEAT_SECTION = "seats";

export default function FeaturesSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { features, setFeatures } = useSettingsStore();
  // Live tracking is the server's switch: it refuses the app's flight
  // recording while it is off (forgejo#321), so it saves at once.
  const liveTracking = useSuggestionSwitchesStore((s) => s.liveTracking);
  const setLiveTracking = useSuggestionSwitchesStore((s) => s.setLiveTracking);
  // The seat block is the flight statistics tab's own "Abschnitte" choice —
  // one stored answer, synced per account, so the switch here and the menu
  // there can never disagree.
  const flightSections = useSectionVisibility("flight");
  const expert = useExpertRows(1);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:features.title")}
        description={t("settings:features.description")}
      />
      <SettingRows>
        <Switch
          id="feature-live-tracking"
          checked={liveTracking}
          onChange={setLiveTracking}
          label={t("settings:features.liveTracking")}
          sub={t("settings:features.liveTrackingDesc")}
        />
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
        {expert && (
          <Switch
            id="feature-seat-statistics"
            expert
            checked={flightSections.isVisible(SEAT_SECTION)}
            onChange={(on) => {
              if (on !== flightSections.isVisible(SEAT_SECTION))
                flightSections.toggle(SEAT_SECTION);
            }}
            label={t("settings:features.seatStatistics")}
            sub={t("settings:features.seatStatisticsDesc")}
          />
        )}
      </SettingRows>
    </SectionCard>
  );
}
