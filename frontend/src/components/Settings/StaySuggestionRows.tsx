import type { JSX } from "react";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { saveSwitch } from "../../store/confirmedSettings";
import { SettingItem, SwitchControl, useGuardedNavigate, useSettingWrite } from "../ui/settings";
import { useDependency, useRowCopy } from "./rowCopy";
import { useServiceReadiness } from "./useServiceReadiness";

export type StayRowId = "avor" | "immichbeleg" | "kiort";
type Field = "stays" | "stayImmichEvidence" | "stayLlmPlaceClassification";

const FIELD: Record<Exclude<StayRowId, "avor">, Field> = {
  immichbeleg: "stayImmichEvidence",
  kiort: "stayLlmPlaceClassification",
};

/** Where an account without a location source picks one (TravTrack → Aufzeichnung). */
const SOURCE_PATH = "/settings/tt-aufz";

function useStaySwitch(key: Field): ReturnType<typeof useSettingWrite<boolean>> {
  const saved = useSuggestionSwitchesStore((s) => s[key]);
  return useSettingWrite<boolean>(`trips.suggestions.${key}`, saved, (on, o) =>
    saveSwitch(key, on, o)
  );
}

/**
 * One of the three stay-suggestion switches (forgejo#306), a row of its own so
 * the TravTrack pages can place it where the design puts it: "Aufenthalte
 * vorschlagen" under Aufenthalte, the Immich photos under Belege, the AI place
 * type under Feinabstimmung.
 *
 * Each switch writes at once and shows its save state; the stores the
 * navigation badge and the inbox read take the value only once the server
 * confirmed it. The two refinements only act while stay suggestions are on,
 * "Ortsart per KI" also needs a text model and the photos an Immich — the row
 * says which is missing and, where the reader can lift it, offers the jump.
 */
export default function StaySuggestionRow({ id }: { id: StayRowId }): JSX.Element {
  return id === "avor" ? <StaysRow /> : <RefinementRow id={id} />;
}

function StaysRow(): JSX.Element {
  const row = useRowCopy("trips");
  const dependency = useDependency();
  const go = useGuardedNavigate();
  const ready = useServiceReadiness();
  const write = useStaySwitch("stays");
  const copy = row("avor");
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      save={write}
      dependency={
        ready.locationSource === false
          ? dependency("noLocSource", () => go(SOURCE_PATH))
          : undefined
      }
      control={<SwitchControl checked={write.value} onChange={write.choose} label={copy.title} />}
    />
  );
}

function RefinementRow({ id }: { id: Exclude<StayRowId, "avor"> }): JSX.Element {
  const row = useRowCopy("trips");
  const dependency = useDependency();
  const go = useGuardedNavigate();
  const ready = useServiceReadiness();
  const stays = useStaySwitch("stays");
  const own = useStaySwitch(FIELD[id]);
  const copy = row(id);
  const stayOff = stays.value ? undefined : dependency("stayOff", () => stays.choose(true));
  const dep =
    stayOff ??
    (id === "immichbeleg"
      ? ready.immich === false
        ? dependency("noImmich", () => go("/settings/services"))
        : undefined
      : ready.ai === false
        ? dependency("aiNotAllowed")
        : undefined);
  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      help={copy.help}
      save={own}
      dependency={dep}
      control={<SwitchControl checked={own.value} onChange={own.choose} label={copy.title} />}
    />
  );
}
