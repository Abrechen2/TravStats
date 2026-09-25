import { useCallback, useEffect, useRef } from "react";
import { tripIdForDate, type DatedTrip } from "../lib/tripForDate";

interface TripPreselectionOptions {
  /** Only a NEW entry is preselected; an existing one keeps its recorded trip. */
  enabled: boolean;
  trips: readonly DatedTrip[];
  /** The entry's day: a flight's departure, a cruise's start, a stay's check-in. */
  date: string;
  value: string;
  onChange: (tripId: string) => void;
}

/**
 * Preselects the trip whose date range contains the entry's date, while the
 * user has not touched the select.
 *
 * It follows the date: a changed departure day moves the suggestion, or clears
 * it when the new day is ambiguous. It never overwrites a trip it did not set
 * itself — one arriving from an import, say — and the first pick by hand ends
 * it for good, even a pick of the very trip it suggested.
 *
 * Returns the handler the select's onChange must go through, so the hook can
 * tell a hand pick from its own.
 */
export function useTripPreselection({
  enabled,
  trips,
  date,
  value,
  onChange,
}: TripPreselectionOptions): (tripId: string) => void {
  const touched = useRef(false);
  const suggested = useRef("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || touched.current) return;
    if (value !== "" && value !== suggested.current) return;
    const next = tripIdForDate(trips, date) ?? "";
    suggested.current = next;
    if (next !== value) onChangeRef.current(next);
  }, [enabled, trips, date, value]);

  return useCallback((tripId: string): void => {
    touched.current = true;
    onChangeRef.current(tripId);
  }, []);
}
