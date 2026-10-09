import { z } from "./zod";

/**
 * The wall clock at a station or terminal, as a ticket prints it:
 * `YYYY-MM-DDTHH:mm`, seconds optional, NO offset. Whose clock it is comes
 * from the station's coordinates on the server; an offset here would be a
 * second answer to the same question. Shared by the domains whose two ends
 * are a departure and an arrival (rail wrote it first, bus imports it).
 */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
export const wallClock = z
  .string()
  .regex(WALL_CLOCK, "must be a local wall-clock time YYYY-MM-DDTHH:mm without an offset")
  .refine((v) => !Number.isNaN(new Date(`${v}Z`).getTime()), "is not a real date and time");

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A wall clock, or — for a ticket that prints none — the calendar day alone,
 * `YYYY-MM-DD` (forgejo#132 item 17). The day is stored with precision `day`,
 * and every reader that needs a clock abstains on it (`shared/railClock.ts`).
 */
export const wallClockOrDay = z.union([
  wallClock,
  z
    .string()
    .regex(LOCAL_DAY, "must be a local wall-clock time YYYY-MM-DDTHH:mm or a day YYYY-MM-DD")
    // Zod runs a refinement even after the regex failed, so this must not
    // throw on a non-day string ("…T08:15+02:00" used to answer 500).
    .refine((v) => {
      const day = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === v;
    }, "is not a real date"),
]);

/** True for a day-only value of `departureLocal` / `arrivalLocal`. */
export function isLocalDayInput(value: string | null | undefined): value is string {
  return typeof value === "string" && LOCAL_DAY.test(value);
}

/** "" and null both clear a text field; undefined leaves it alone. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

export const foldField = z.enum(["earlier", "later"]).nullable().optional();
