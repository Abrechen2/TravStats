import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";

/**
 * Whether the Posteingang offers trip and stay suggestions at all (forgejo#306).
 * Beside the trip settings because both kinds are about trips: what an absence
 * from home becomes, and where the user was on one.
 *
 * Each switch persists at once through its store, which the navigation badge
 * and the inbox read too — a flip shows there without a reload. The two
 * further stay switches (Immich evidence, LLM place classification) exist in
 * the API but are not drawn here until forgejo#305 gives them something to do:
 * a switch that changes nothing is a control that lies.
 */
export default function InboxSuggestionsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const trips = useSuggestionSwitchesStore((s) => s.trips);
  const stays = useSuggestionSwitchesStore((s) => s.stays);
  const setTrips = useSuggestionSwitchesStore((s) => s.setTrips);
  const setStays = useSuggestionSwitchesStore((s) => s.setStays);
  const key = "settings:inboxSuggestions";

  return (
    <SectionCard>
      <SectionTitle title={t(`${key}.title`)} description={t(`${key}.description`)} />
      <SettingRows>
        <Switch
          id="inbox-suggestions-trips"
          checked={trips}
          onChange={setTrips}
          label={t(`${key}.trips.label`)}
          sub={t(`${key}.trips.description`)}
        />
        <Switch
          id="inbox-suggestions-stays"
          checked={stays}
          onChange={setStays}
          label={t(`${key}.stays.label`)}
          sub={t(`${key}.stays.description`)}
        />
      </SettingRows>
    </SectionCard>
  );
}
