import type { JSX } from "react";
import SuggestionChips from "../common/SuggestionChips";
import type { BusTerminalSuggestion } from "../../types/bus";
import type { BusStationDraft } from "./BusStationField";

interface Props {
  terminals: readonly BusTerminalSuggestion[];
  value: BusStationDraft;
  /** Names the field in each chip's accessible label. */
  fieldLabel: string;
  onPick: (next: BusStationDraft) => void;
  /** Lets a test (or a screen reader landmark) tell the two rows apart. */
  testId: string;
}

/** Terminals the typed name could continue; a name already filled in is not offered again. */
function offered(
  terminals: readonly BusTerminalSuggestion[],
  value: BusStationDraft
): BusTerminalSuggestion[] {
  const typed = value.name.trim().toUpperCase();
  const seen = new Set<string>();
  return terminals.filter((terminal) => {
    if (seen.has(terminal.name)) return false;
    seen.add(terminal.name);
    // A chip that would change nothing is noise — but only once the terminal
    // is also PLACED. A typed name that matches a terminal exactly is exactly
    // the case where the chip is the only way to give it a position.
    const same =
      terminal.name === value.name && terminal.lat === value.lat && terminal.lon === value.lon;
    return !same && terminal.name.toUpperCase().startsWith(typed);
  });
}

/**
 * One-click terminals from the user's own rides under a terminal field. A pick
 * carries the whole terminal — name, address, position AND country — so a
 * chip alone makes the field submittable without a geocoder search.
 */
export function BusTerminalChips({
  terminals,
  value,
  fieldLabel,
  onPick,
  testId,
}: Props): JSX.Element {
  const candidates = offered(terminals, value);
  const pick = (name: string): void => {
    const terminal = candidates.find((candidate) => candidate.name === name);
    if (!terminal) return;
    onPick({
      name: terminal.name,
      address: terminal.address ?? "",
      lat: terminal.lat,
      lon: terminal.lon,
      country: terminal.country,
    });
  };
  // `value=""` on purpose: the narrowing is done above, and SuggestionChips
  // would hide the very chip that equals the typed name.
  return (
    <div data-testid={testId}>
      <SuggestionChips
        value=""
        suggestions={candidates.map((terminal) => terminal.name)}
        onPick={pick}
        fieldLabel={fieldLabel}
      />
    </div>
  );
}
