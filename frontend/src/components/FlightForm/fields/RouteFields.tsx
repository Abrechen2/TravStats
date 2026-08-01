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
 *  user re-picks an airport they never actually needed to touch. */
export default function RouteFields({
  departure,
  arrival,
  onDepartureChange,
  onArrivalChange,
}: RouteFieldsProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="label">{t("flights:form.from")}</label>
        <AirportAutocomplete
          value={departure}
          onChange={onDepartureChange}
          label=""
          placeholder={t("flights:form.placeholders.departureAirport")}
        />
      </div>
      <div>
        <label className="label">{t("flights:form.to")}</label>
        <AirportAutocomplete
          value={arrival}
          onChange={onArrivalChange}
          label=""
          placeholder={t("flights:form.placeholders.arrivalAirport")}
        />
      </div>
    </div>
  );
}
