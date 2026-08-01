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
  /** Rendered under the departure/arrival field when supplied. RouteFields
   *  doesn't decide WHEN a hint is warranted — the caller does, by only
   *  passing one when its own airport state is null (see FlightEditModal:
   *  its airports always start non-null, so a null there only ever means
   *  an abandoned typed edit, never "nothing chosen yet"). */
  departureHint?: string;
  arrivalHint?: string;
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

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="label">{t("flights:edit.routeFrom")}</label>
        <AirportAutocomplete
          value={departure}
          onChange={onDepartureChange}
          label=""
          placeholder={t("flights:form.placeholders.departureAirport")}
        />
        {departureHint && (
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
        />
        {arrivalHint && (
          <p className="text-xs mt-1" style={{ color: "var(--warning)" }}>
            {arrivalHint}
          </p>
        )}
      </div>
    </div>
  );
}
