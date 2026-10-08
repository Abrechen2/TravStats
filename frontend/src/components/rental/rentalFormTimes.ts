import { classifyWallClock, storedFold, type TimeValue } from "../../shared/time";

/**
 * The four wall clocks of a rental form — booked pickup and return, and the
 * actual hand-overs — each with the two facts a bare string cannot carry:
 * whether it is only a day (precision `day`, ADR 0002) and which occurrence
 * of a repeated autumn hour it names (the fold). The rules are rail's
 * (`railFormModel.ts`), per end: a stored end opens with its precision and
 * its stored occurrence; typing a new clock forgets the occurrence, typing the
 * opened clock back at the same station gives it back.
 */

export type RentalTimeEnd = "pickup" | "return" | "actualPickup" | "actualReturn";
export type RentalFold = "earlier" | "later";

export const RENTAL_TIME_ENDS: readonly RentalTimeEnd[] = [
  "pickup",
  "return",
  "actualPickup",
  "actualReturn",
];

/** Booked ends are required; an actual end is optional (nobody may have recorded it). */
export const REQUIRED_TIME_ENDS: readonly RentalTimeEnd[] = ["pickup", "return"];

export type RentalTimeFlags<T> = Record<RentalTimeEnd, T>;

export const NO_DAY_ONLY: RentalTimeFlags<boolean> = {
  pickup: false,
  return: false,
  actualPickup: false,
  actualReturn: false,
};

export const NO_FOLDS: RentalTimeFlags<RentalFold | null> = {
  pickup: null,
  return: null,
  actualPickup: null,
  actualReturn: null,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** `YYYY-MM-DD` of a typed time, the part a day-only end keeps. */
export const dayPart = (local: string): string => local.slice(0, 10);

/** A day given a clock, so a `datetime-local` input can show it; a clock stays as it is. */
export const withClock = (local: string): string =>
  local === "" ? "" : local.length === 10 ? `${local}T00:00` : local;

/** What the form holds for a stored end: the station's wall clock, or only its day. */
export function wallOf(value: TimeValue | null): string {
  if (!value) return "";
  return value.precision === "day" ? dayPart(value.local) : value.local.slice(0, 16);
}

/**
 * Which occurrence of a repeated hour a stored end is. The wall clock alone
 * cannot say: 02:30 on the autumn night is two instants an hour apart, and
 * the server reads an unqualified one as the earlier.
 */
export function foldOf(value: TimeValue | null): RentalFold | null {
  if (!value?.zone || value.precision === "day") return null;
  const local = value.local.slice(0, 16);
  if (classifyWallClock(local, value.zone) !== "repeated") return null;
  return storedFold(local, value.zone, value.utc) === "later" ? "later" : "earlier";
}

/**
 * Whether a typed value has the shape its end needs: empty only where the end
 * is optional; a day when the end is day-only; a full clock otherwise.
 */
export function timeShapeOk(local: string, dayOnly: boolean, required: boolean): boolean {
  if (local === "") return !required;
  return dayOnly ? DAY.test(local) : CLOCK.test(local);
}

/** The fold as the write body carries it: none for a day or an empty end. */
export const wireFold = (local: string, dayOnly: boolean, fold: RentalFold | null) =>
  local === "" || dayOnly ? null : fold;
