import type { JSX } from "react";
import type { Trip } from "../../types";
import { useTripPreselection } from "../../hooks/useTripPreselection";
import { StayEditorSection } from "./StayEditorSection";

interface StayEditorTripSectionProps {
  trips: readonly Trip[];
  tripId: string;
  onTripChange: (tripId: string) => void;
  /** A NEW stay preselects the trip covering its check-in; an existing one
   *  keeps the trip it was saved with. */
  preselect: boolean;
  checkIn: string;
  inputClassName: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/**
 * Its own section. This select used to sit unlabelled at the bottom of
 * "Loyalty programme", between membership numbers — the word "trip" existed
 * only as an aria-label, so the sole thing on screen was the option text "Not
 * linked to a trip". Nobody looking for how to attach a stay to a trip searches
 * under loyalty, and they would be right not to.
 *
 * Moved out of `StayEditor`, which sits at the 800-line limit, when the trip
 * preselection gave it a hook of its own.
 */
export function StayEditorTripSection({
  trips,
  tripId,
  onTripChange,
  preselect,
  checkIn,
  inputClassName,
  t,
}: StayEditorTripSectionProps): JSX.Element {
  const pick = useTripPreselection({
    enabled: preselect,
    trips,
    date: checkIn,
    value: tripId,
    onChange: onTripChange,
  });

  return (
    <StayEditorSection title={t("lodging:stayEditor.tripSection")}>
      <label htmlFor="stay-editor-trip" className="mb-1 block text-xs text-[var(--text-muted)]">
        {t("lodging:field.trip")}
      </label>
      <select
        id="stay-editor-trip"
        aria-label={t("lodging:field.trip")}
        className={inputClassName}
        value={tripId}
        onChange={(e): void => pick(e.target.value)}
      >
        <option value="">{t("lodging:field.noTrip")}</option>
        {trips.map((trip) => (
          <option key={trip.id} value={trip.id}>
            {trip.name}
          </option>
        ))}
      </select>
    </StayEditorSection>
  );
}
