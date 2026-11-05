import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SwitchControl, useGuardedNavigate, useSettingWrite } from "../ui/settings";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { saveSwitch } from "../../store/confirmedSettings";
import { useDependency, useRowCopy } from "./rowCopy";
import { useServiceReadiness } from "./useServiceReadiness";

type Field = "trips" | "stays" | "stayImmichEvidence" | "stayLlmPlaceClassification";

/**
 * "Vorschläge im Eingang" (forgejo#306, design §4 A5): whether the Posteingang
 * offers trip and stay suggestions at all, and the two refinements of a stay.
 *
 * Each switch writes at once and shows its save state; the stores that the
 * navigation badge and the inbox read take the value only once the server
 * confirmed it. The refinements only act while stay suggestions are on, and
 * "Ortsart per KI" also needs a text model and "Immich-Fotos" an Immich — the
 * row says which is missing and, where the reader can lift it, offers the jump.
 */
export default function InboxSuggestionsSection(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("trips");
  const dependency = useDependency();
  const go = useGuardedNavigate();
  const ready = useServiceReadiness();
  const store = useSuggestionSwitchesStore();

  const useSwitch = (key: Field): ReturnType<typeof useSettingWrite<boolean>> =>
    useSettingWrite<boolean>(`trips.suggestions.${key}`, store[key], (on, o) =>
      saveSwitch(key, on, o)
    );

  const trips = useSwitch("trips");
  const stays = useSwitch("stays");
  const immich = useSwitch("stayImmichEvidence");
  const ai = useSwitch("stayLlmPlaceClassification");

  const stayOff = (): ReturnType<typeof dependency> | undefined =>
    stays.value ? undefined : dependency("stayOff", () => stays.choose(true));

  const item = (
    id: string,
    write: typeof trips,
    dep?: ReturnType<typeof dependency>
  ): JSX.Element => {
    const copy = row(id);
    return (
      <SettingItem
        title={copy.title}
        sub={copy.sub}
        help={copy.help}
        save={write}
        dependency={dep}
        control={<SwitchControl checked={write.value} onChange={write.choose} />}
      />
    );
  };

  const services = () => go("/settings/services");
  return (
    <SectionCard>
      <SectionTitle title={t("settingsRows:trips.sections.suggestions")} />
      <SettingRows>
        {item("rvor", trips)}
        {item(
          "avor",
          stays,
          ready.locationSource === false
            ? dependency("noLocSource", () => go("/settings/travtrack#ttRecording"))
            : undefined
        )}
        {item(
          "immichbeleg",
          immich,
          stayOff() ?? (ready.immich === false ? dependency("noImmich", services) : undefined)
        )}
        {item(
          "kiort",
          ai,
          stayOff() ?? (ready.ai === false ? dependency("aiNotAllowed") : undefined)
        )}
      </SettingRows>
    </SectionCard>
  );
}
