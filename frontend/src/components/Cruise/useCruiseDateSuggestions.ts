import { useEffect, useState } from "react";
import type { CruiseStopInput } from "../../types";
import { suggestedCruiseEndDate, withDerivedStopDates } from "./cruiseDayNumbers";

interface Options {
  /** The cruise start date as the date input holds it ("YYYY-MM-DD" or ""). */
  startDate: string;
  stops: CruiseStopInput[];
  setStops: (stops: CruiseStopInput[]) => void;
  endDate: string;
  setEndDate: (endDate: string) => void;
}

/**
 * Keeps the dates the edit form can derive from data already in it in step
 * with that data: each stop's date follows the start date and its day of the
 * cruise, and an empty end date follows the last day of the cruise. Only empty
 * or previously derived values are written — see `withDerivedStopDates` for
 * why a typed date is never overwritten.
 *
 * Returns the end date's change handler: the first edit hands the field to the
 * user for good, including an edit that clears it.
 */
export function useCruiseDateSuggestions({
  startDate,
  stops,
  setStops,
  endDate,
  setEndDate,
}: Options): (endDate: string) => void {
  useEffect(() => {
    const next = withDerivedStopDates(stops, startDate);
    if (next !== stops) setStops(next);
  }, [startDate, stops, setStops]);

  // Decided once, from the value the form opened with: a loaded end date is
  // the user's, an empty one is ours to suggest until they touch it.
  const [endDateFollows, setEndDateFollows] = useState(() => endDate === "");
  const suggestion = suggestedCruiseEndDate(startDate, stops);
  useEffect(() => {
    if (endDateFollows && endDate !== suggestion) setEndDate(suggestion);
  }, [endDateFollows, endDate, suggestion, setEndDate]);

  return (value: string): void => {
    setEndDateFollows(false);
    setEndDate(value);
  };
}
