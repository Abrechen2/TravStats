import { useEffect, useState } from "react";
import AirportAutocomplete from "../../AirportAutocomplete";
import { useTranslation } from "../../../hooks/useTranslation";
import type { Airport } from "../../../lib/api";

/** The departure/arrival airport pair for a flight leg. Both fields land in
 *  the same onChange call shape as TimesFields — the caller decides how to
 *  fold a single side's change into its own state. */
export interface RouteFieldsValue {
  departure: Airport | null;
  arrival: Airport | null;
}

interface RouteFieldsProps {
  departure: Airport | null;
  arrival: Airport | null;
  onDepartureChange: (airport: Airport | null) => void;
  onArrivalChange: (airport: Airport | null) => void;
  /** Text to show under the departure/arrival field once RouteFields decides
   *  that side has SETTLED unresolved (see useSettledUnresolved below) — the
   *  caller supplies the copy, RouteFields decides the timing. Pass the same
   *  string unconditionally; it is never displayed just because the value is
   *  null (that happens on every keystroke of ANY edit, not just an
   *  abandoned one — see AirportAutocomplete's handleInputChange). */
  departureHint?: string;
  arrivalHint?: string;
}

/** True only once the field has been LEFT (blurred) while still unresolved.
 *  AirportAutocomplete nulls its value on the very first keystroke that
 *  diverges from the current selection — that happens for a perfectly good
 *  in-progress edit just as much as an abandoned one, so raw `!value` is not
 *  a usable signal on its own (round 2 review finding: gating on it made the
 *  hint fire mid-search for edits that were about to succeed). Resolves
 *  immediately, in the same render, the moment `value` becomes non-null
 *  again — a hint about a now-fixed problem must not linger. */
function useSettledUnresolved(value: Airport | null): {
  settledUnresolved: boolean;
  handleFocus: () => void;
  handleBlur: () => void;
} {
  const [settledUnresolved, setSettledUnresolved] = useState(false);

  useEffect(() => {
    if (value) setSettledUnresolved(false);
  }, [value]);

  return {
    settledUnresolved,
    handleFocus: () => setSettledUnresolved(false),
    handleBlur: () => setSettledUnresolved(!value),
  };
}

/** Departure + arrival airport pickers, shared between the create and edit
 *  flight forms. Wraps the same `AirportAutocomplete` the create form's
 *  `FlightCompleteStep` already uses — this is not a second airport picker,
 *  just its first reuse outside that step.
 *
 *  Deliberately NOT `required`, unlike the create form's own pickers: a
 *  flight being edited always already has valid coordinates (Flight.depLat/
 *  depLon are non-optional), even when it has no cached IATA/ICAO/name to
 *  display — e.g. a historical or private-airfield entry. A native `required`
 *  text input with nothing to show is empty from the browser's point of
 *  view, which would block saving any OTHER field on that flight until the
 *  user re-picks an airport they never actually needed to touch.
 *
 *  Labels use the edit-only `flights:edit.routeFrom`/`routeTo` keys, NOT the
 *  create form's `flights:form.from`/`form.to` — those bake a "*"
 *  required-marker into the translated string, which would be a false claim
 *  here now that `required` is gone. See RouteFields.i18n.test.ts. */
export default function RouteFields({
  departure,
  arrival,
  onDepartureChange,
  onArrivalChange,
  departureHint,
  arrivalHint,
}: RouteFieldsProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const dep = useSettledUnresolved(departure);
  const arr = useSettledUnresolved(arrival);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="label">{t("flights:edit.routeFrom")}</label>
        <AirportAutocomplete
          value={departure}
          onChange={onDepartureChange}
          label=""
          placeholder={t("flights:form.placeholders.departureAirport")}
          onFocus={dep.handleFocus}
          onBlur={dep.handleBlur}
        />
        {dep.settledUnresolved && departureHint && (
          <p className="text-xs mt-1" style={{ color: "var(--warning)" }}>
            {departureHint}
          </p>
        )}
      </div>
      <div>
        <label className="label">{t("flights:edit.routeTo")}</label>
        <AirportAutocomplete
          value={arrival}
          onChange={onArrivalChange}
          label=""
          placeholder={t("flights:form.placeholders.arrivalAirport")}
          onFocus={arr.handleFocus}
          onBlur={arr.handleBlur}
        />
        {arr.settledUnresolved && arrivalHint && (
          <p className="text-xs mt-1" style={{ color: "var(--warning)" }}>
            {arrivalHint}
          </p>
        )}
      </div>
    </div>
  );
}
