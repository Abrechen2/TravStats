import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import CatalogueCombobox, { searchAircraftOptions } from "../fields/CatalogueCombobox";
import SuggestionChips from "../../common/SuggestionChips";

interface AircraftSectionProps {
  aircraft: string;
  terminal: string;
  gate: string;
  setAircraft: (v: string) => void;
  setTerminal: (v: string) => void;
  setGate: (v: string) => void;
  labelClassName: string;
  inputClassName: string;
  /** Terminals the user departed this airport from before. */
  terminalSuggestions?: readonly string[];
}

/**
 * The machine and the door it left from — the second folded group of the
 * manual flight form (forgejo#88, point 9).
 *
 * All three are things a logbook is glad to have and no flight needs: an
 * aircraft type that the lookup usually fills, and a terminal and gate that
 * only matter to somebody re-reading a boarding pass. That is why the group is
 * closed by default, and why its summary names whichever of the three is set.
 */
export default function AircraftSection({
  aircraft,
  terminal,
  gate,
  setAircraft,
  setTerminal,
  setGate,
  labelClassName,
  inputClassName,
  terminalSuggestions = [],
}: AircraftSectionProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className={`label ${labelClassName}`}>{t("flights:form.aircraft")}</label>
        <CatalogueCombobox
          value={aircraft}
          onChange={setAircraft}
          search={searchAircraftOptions}
          placeholder={t("flights:form.placeholders.aircraft")}
          inputClassName={inputClassName}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={`label ${labelClassName}`}>{t("flights:form.terminal")}</label>
          <input
            type="text"
            value={terminal}
            onChange={(e) => setTerminal(e.target.value)}
            className={`input ${inputClassName}`}
            placeholder={t("flights:form.placeholders.terminal")}
          />
          <SuggestionChips
            value={terminal}
            suggestions={terminalSuggestions}
            onPick={setTerminal}
            fieldLabel={t("flights:form.terminal")}
          />
        </div>
        <div>
          <label className={`label ${labelClassName}`}>{t("flights:form.gate")}</label>
          <input
            type="text"
            value={gate}
            onChange={(e) => setGate(e.target.value)}
            className={`input ${inputClassName}`}
            placeholder={t("flights:form.placeholders.gate")}
          />
        </div>
      </div>
    </div>
  );
}
