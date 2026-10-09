import type { RentalDraft, RentalStationDraft } from "./rentalFormModel";
import type { RentalFold, RentalTimeEnd } from "./rentalFormTimes";

/**
 * The edits of the rental draft that touch a clock's occurrence — rail's
 * per-end rules (`RailFormModal`), pure so they are tested without a browser.
 * A fold belongs to ONE wall clock at ONE station: a new clock or a new
 * station forgets it, and typing the clock the form opened with, at the
 * station it opened with, gives the stored occurrence back.
 */

const PICKUP_ENDS: readonly RentalTimeEnd[] = ["pickup", "actualPickup"];
const RETURN_ENDS: readonly RentalTimeEnd[] = ["return", "actualReturn"];

const samePlace = (a: RentalStationDraft, b: RentalStationDraft): boolean =>
  a.lat === b.lat && a.lon === b.lon && a.airportId === b.airportId;

/** The station whose clock an end is read on. */
function stationOf(d: RentalDraft, end: RentalTimeEnd): RentalStationDraft {
  if (PICKUP_ENDS.includes(end) || d.sameStation) return d.pickup;
  return d.ret;
}

/** The zone an end is read in, when the form knows it (a pick or the stored rental). */
export function zoneOfEnd(d: RentalDraft, end: RentalTimeEnd): string | null {
  return stationOf(d, end).timezone ?? null;
}

export function withTime(
  prev: RentalDraft,
  opened: RentalDraft,
  end: RentalTimeEnd,
  value: string
): RentalDraft {
  const sameClock = value === opened[`${end}Local`] && prev.dayOnly[end] === opened.dayOnly[end];
  const sameStation = samePlace(stationOf(prev, end), stationOf(opened, end));
  return {
    ...prev,
    [`${end}Local`]: value,
    folds: { ...prev.folds, [end]: sameClock && sameStation ? opened.folds[end] : null },
  };
}

/** "Nur Datum" on or off: the value is re-shaped by the caller; no occurrence survives it. */
export function withDayOnly(
  prev: RentalDraft,
  end: RentalTimeEnd,
  dayOnly: boolean,
  value: string
): RentalDraft {
  return {
    ...prev,
    [`${end}Local`]: value,
    dayOnly: { ...prev.dayOnly, [end]: dayOnly },
    folds: { ...prev.folds, [end]: null },
  };
}

export function withFold(prev: RentalDraft, end: RentalTimeEnd, fold: RentalFold): RentalDraft {
  return { ...prev, folds: { ...prev.folds, [end]: fold } };
}

function forgetFolds(d: RentalDraft, ends: readonly RentalTimeEnd[]): RentalDraft["folds"] {
  return ends.reduce((folds, end) => ({ ...folds, [end]: null }), d.folds);
}

/**
 * Another station is another zone, where the old occurrence means nothing; a
 * rename of the same place keeps it. The pickup station also carries the
 * return ends while the car goes back where it came from.
 */
export function withStation(
  prev: RentalDraft,
  which: "pickup" | "ret",
  next: RentalStationDraft
): RentalDraft {
  const moved = !samePlace(prev[which], next);
  const ends =
    which === "pickup" ? [...PICKUP_ENDS, ...(prev.sameStation ? RETURN_ENDS : [])] : RETURN_ENDS;
  return { ...prev, [which]: next, folds: moved ? forgetFolds(prev, ends) : prev.folds };
}

/** Ticking "same station" moves the return ends onto the pickup's clock, or off it. */
export function withSameStation(prev: RentalDraft, sameStation: boolean): RentalDraft {
  if (sameStation === prev.sameStation) return prev;
  const moved = !samePlace(prev.pickup, prev.ret);
  return {
    ...prev,
    sameStation,
    folds: moved ? forgetFolds(prev, RETURN_ENDS) : prev.folds,
  };
}
