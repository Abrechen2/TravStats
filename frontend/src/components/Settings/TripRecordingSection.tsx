import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";

/**
 * Whether this server stores the positions the TravStats app records during a
 * trip (forgejo#316). Off refuses new uploads; what is stored stays, and is
 * deleted on the trip's map. Persists at once through its store.
 */
export default function TripRecordingSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const enabled = useSuggestionSwitchesStore((s) => s.tripRecording);
  const setEnabled = useSuggestionSwitchesStore((s) => s.setTripRecording);

  return (
    <SectionCard>
      <SectionTitle title={t("settings:tripRecording.title")} />
      <SettingRows>
        <Switch
          id="trip-recording-enabled"
          checked={enabled}
          onChange={setEnabled}
          label={t("settings:tripRecording.label")}
          sub={t("settings:tripRecording.description")}
        />
      </SettingRows>
    </SectionCard>
  );
}
