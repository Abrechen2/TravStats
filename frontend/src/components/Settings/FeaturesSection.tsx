import type { JSX } from "react";
import { SectionCard } from "./SettingsShared";
import { useSettingsStore, type FeaturesSettings } from "../../store/settingsStore";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SwitchControl, useSettingWrite } from "../ui/settings";
import { saveSwitch } from "../../store/confirmedSettings";
import { useDocumentSetting } from "./useDocumentSetting";

const setFeatures = (partial: Partial<FeaturesSettings>): void =>
  useSettingsStore.getState().setFeatures(partial);

/**
 * "Was festgehalten wird": three switches. The seat statistics switch is gone
 * (design 2026-11-01); its section stays reachable from the flight statistics
 * themselves. Live tracking has its own store that puts the switch back and
 * keeps the choice and offers a retry on its row when the server refuses it.
 */
export default function FeaturesSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const features = useSettingsStore((s) => s.features);
  const liveTracking = useSuggestionSwitchesStore((s) => s.liveTracking);
  const liveTrackingWrite = useSettingWrite<boolean>("features.liveTracking", liveTracking, (on) =>
    saveSwitch("liveTracking", on)
  );

  const cost = useDocumentSetting<boolean>(
    "features.costTracking",
    features.enableCostTracking,
    (enableCostTracking) => setFeatures({ enableCostTracking })
  );
  const aircraft = useDocumentSetting<boolean>(
    "features.trackAircraft",
    features.trackAircraftRegistration,
    (trackAircraftRegistration) => setFeatures({ trackAircraftRegistration })
  );

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.costTracking.name")}
          sub={t("settings:rows.costTracking.sub")}
          help={t("settings:rows.costTracking.help")}
          save={cost}
          locked={locked}
          control={
            <SwitchControl
              checked={cost.value}
              onChange={cost.choose}
              label={t("settings:rows.costTracking.name")}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.trackAircraft.name")}
          help={t("settings:rows.trackAircraft.help")}
          save={aircraft}
          locked={locked}
          control={
            <SwitchControl
              checked={aircraft.value}
              onChange={aircraft.choose}
              label={t("settings:rows.trackAircraft.name")}
            />
          }
        />
        <SettingItem
          title={t("settings:rows.liveTracking.name")}
          sub={t("settings:rows.liveTracking.sub")}
          help={t("settings:rows.liveTracking.help")}
          save={liveTrackingWrite}
          locked={locked}
          control={
            <SwitchControl
              checked={liveTrackingWrite.value}
              onChange={liveTrackingWrite.choose}
              label={t("settings:rows.liveTracking.name")}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
