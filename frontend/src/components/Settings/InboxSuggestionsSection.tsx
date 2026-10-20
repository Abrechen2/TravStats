import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { useExpertRows } from "./frame/useExpertRows";

/**
 * Whether the Posteingang offers trip and stay suggestions at all (forgejo#306).
 * Beside the trip settings because both kinds are about trips: what an absence
 * from home becomes, and where the user was on one.
 *
 * Each switch persists at once through its store, which the navigation badge
 * and the inbox read too — a flip shows there without a reload. The two stay
 * refinements (forgejo#305) — Immich photos as evidence and the model's place
 * type — only act while stay suggestions are on, so they are drawn disabled
 * otherwise rather than as switches that seem to do something.
 */
export default function InboxSuggestionsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const trips = useSuggestionSwitchesStore((s) => s.trips);
  const stays = useSuggestionSwitchesStore((s) => s.stays);
  const setTrips = useSuggestionSwitchesStore((s) => s.setTrips);
  const setStays = useSuggestionSwitchesStore((s) => s.setStays);
  const immichEvidence = useSuggestionSwitchesStore((s) => s.stayImmichEvidence);
  const placeClassification = useSuggestionSwitchesStore((s) => s.stayLlmPlaceClassification);
  const setImmichEvidence = useSuggestionSwitchesStore((s) => s.setStayImmichEvidence);
  const setPlaceClassification = useSuggestionSwitchesStore((s) => s.setStayLlmPlaceClassification);
  const key = "settings:inboxSuggestions";
  // The two stay refinements are fine-tuning (forgejo#321): expert.
  const expert = useExpertRows(2);

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
        {expert && (
          <>
            <Switch
              id="inbox-suggestions-stays-immich"
              checked={immichEvidence}
              disabled={!stays}
              onChange={setImmichEvidence}
              label={t(`${key}.immichEvidence.label`)}
              sub={t(`${key}.immichEvidence.description`)}
            />
            <Switch
              id="inbox-suggestions-stays-llm"
              checked={placeClassification}
              disabled={!stays}
              onChange={setPlaceClassification}
              label={t(`${key}.llmPlaceClassification.label`)}
              sub={t(`${key}.llmPlaceClassification.description`)}
            />
          </>
        )}
      </SettingRows>
    </SectionCard>
  );
}
