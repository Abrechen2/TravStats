import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SwitchControl, useSettingWrite } from "../ui/settings";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { saveSwitch } from "../../store/confirmedSettings";

/**
 * Whether this server stores the positions the TravStats app records during a
 * trip (forgejo#316). Off refuses new uploads; what is stored stays, and is
 * deleted on the trip's map. A refusal keeps the choice and offers a retry.
 */
export default function TripRecordingSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const saved = useSuggestionSwitchesStore((s) => s.tripRecording);
  const write = useSettingWrite<boolean>("location.tripRecording", saved, (on) =>
    saveSwitch("tripRecording", on)
  );

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:tripRecording.label")}
          sub={t("settings:tripRecording.description")}
          help={t("settings:tripRecording.more")}
          save={write}
          locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
          control={
            <SwitchControl
              checked={write.value}
              onChange={write.choose}
              label={t("settings:tripRecording.label")}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
