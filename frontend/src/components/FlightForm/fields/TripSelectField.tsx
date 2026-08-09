import { useState, useEffect } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { tripsApi } from "../../../lib/api/trips";
import { logger } from "../../../lib/logger";
import type { Trip } from "../../../types";

interface TripSelectFieldProps {
  value: string;
  onChange: (tripId: string) => void;
  /** Translated helper line under the select; the edit modal explains its
   *  save-then-assign timing here. */
  hint?: string;
  labelClassName?: string;
  inputClassName?: string;
}

/** The trip picker, shared between the create and edit flight forms (#199).
 *  Owns its own trip-list loading — non-fatal on purpose: with no list the
 *  field just offers "no trip". The ASSIGNMENT is deliberately not in here:
 *  Flight.tripId is owned by the Trip relation, so each caller applies the
 *  choice through tripsApi.assignFlights strictly AFTER its save succeeds
 *  (see FlightEditModal's submit and useFlightForm.maybeAssignTrip). */
export default function TripSelectField({
  value,
  onChange,
  hint,
  labelClassName = "",
  inputClassName = "",
}: TripSelectFieldProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err) => {
        logger.warn("Failed to load trips for TripSelectField:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <label className={`label ${labelClassName}`.trim()}>{t("flights:edit.tripLabel")}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input ${inputClassName}`.trim()}
      >
        <option value="">{t("flights:edit.tripNone")}</option>
        {trips.map((trip) => (
          <option key={trip.id} value={trip.id}>
            {trip.name}
          </option>
        ))}
      </select>
      {hint && (
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
