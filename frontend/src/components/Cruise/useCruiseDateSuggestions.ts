import { useEffect } from "react";
import type { CruiseStopInput } from "../../types";
import { withDerivedStopDates } from "./cruiseDayNumbers";

interface Options {
  /** The cruise start date as the date input holds it ("YYYY-MM-DD" or ""). */
  startDate: string;
  stops: CruiseStopInput[];
  setStops: (stops: CruiseStopInput[]) => void;
}

/**
 * Keeps the dates the edit form can derive from data already in it in step
 * with that data: each stop's date follows the start date and its day of the
 * cruise. Only empty or previously derived values are written — see
 * `withDerivedStopDates` for why a typed date is never overwritten.
 */
export function useCruiseDateSuggestions({ startDate, stops, setStops }: Options): void {
  useEffect(() => {
    const next = withDerivedStopDates(stops, startDate);
    if (next !== stops) setStops(next);
  }, [startDate, stops, setStops]);
}
