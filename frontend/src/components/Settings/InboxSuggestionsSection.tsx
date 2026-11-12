import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SwitchControl, useSettingWrite } from "../ui/settings";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { saveSwitch } from "../../store/confirmedSettings";
import { useRowCopy } from "./rowCopy";
import OpenSuggestionsRow from "./OpenSuggestionsRow";

/**
 * "Vorschläge im Eingang" (forgejo#306, design §4 A5): whether the Posteingang
 * offers trip suggestions at all, and how many are open. The stay suggestions
 * and their refinements moved to TravTrack → Erkennung & Vorschläge
 * (`StaySuggestionRows`, settings v3 S4): they read the location history.
 *
 * The switch writes at once and shows its save state; the store that the
 * navigation badge and the inbox read takes the value only once the server
 * confirmed it.
 */
export default function InboxSuggestionsSection(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("trips");
  const saved = useSuggestionSwitchesStore((s) => s.trips);
  const trips = useSettingWrite<boolean>("trips.suggestions.trips", saved, (on, o) =>
    saveSwitch("trips", on, o)
  );
  const copy = row("rvor");
  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:trips.sections.suggestions")} />
      <SettingRows>
        <SettingItem
          title={copy.title}
          sub={copy.sub}
          help={copy.help}
          save={trips}
          control={<SwitchControl checked={trips.value} onChange={trips.choose} />}
        />
        <OpenSuggestionsRow />
      </SettingRows>
    </SectionCard>
  );
}
