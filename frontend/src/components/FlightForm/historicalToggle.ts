import { historicalDateShape } from "./fields/HistoricalDateFields";

/** The slice of the edit modal's form state the historical checkbox touches. */
export interface HistoricalToggleFields {
  status: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
}

/** Enter or leave "historical" on the edit form — the state transition
 *  behind the checkbox the create form already has (2.6.1: a historical
 *  flight had no way out, so a flight imported without its clock could
 *  never be given one).
 *
 *  Leaving keeps the date only when the day was real (a "YYYY-MM-DD"
 *  shape); a year or year+month shape becomes an empty date rather than the
 *  January 1st / day 01 that buildLocalString would expand it to, because
 *  the user is about to type a real clock and must not inherit a fabricated
 *  day beneath it. The clocks start empty either way — the submit guard
 *  refuses the save until both are typed, which is the point: no midday is
 *  invented on the way out. The status set is only a HINT (flown vs
 *  scheduled by the date, as the create form decides it); the server
 *  re-derives it from the final times, exactly as after the cancelled
 *  checkbox. */
export function applyHistoricalToggle<T extends HistoricalToggleFields>(
  prev: T,
  checked: boolean,
  now: Date = new Date()
): T {
  if (checked) {
    return {
      ...prev,
      status: "historical",
      arrivalDate: prev.departureDate,
      departureTime: "",
      arrivalTime: "",
    };
  }
  const fullDay =
    historicalDateShape(prev.departureDate) === "year_month_day" ? prev.departureDate : "";
  const inPast = fullDay !== "" && new Date(fullDay) < now;
  return {
    ...prev,
    status: inPast ? "flown" : "scheduled",
    departureDate: fullDay,
    arrivalDate: fullDay,
    departureTime: "",
    arrivalTime: "",
  };
}
