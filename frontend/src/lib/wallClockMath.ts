/**
 * Arithmetic on a typed wall clock (`YYYY-MM-DD` + `HH:mm`) — no zone at all.
 *
 * A form that says "boarding is 30 minutes before the departure you typed" or
 * "assume the flight takes two hours" is shifting the numbers on a ticket, not
 * an instant: which instant they name is the server's question (ADR 0002 D3).
 * Parsing them with `new Date("…T…")` read them in the BROWSER's zone, and a
 * shift across that zone's own clock change moved the result an hour; the
 * fallback estimate even mixed the UTC date with the local clock. The
 * components are placed on a UTC instant here and read back with UTC getters,
 * so nothing but the numbers takes part.
 */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{2}):(\d{2})$/;
const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export interface WallClock {
  date: string;
  time: string;
}

/** `date` + `time` shifted by `minutes`, or null for input that is not a wall clock. */
export function shiftWallClock(date: string, time: string, minutes: number): WallClock | null {
  const d = DAY.exec(date);
  const t = CLOCK.exec(time);
  if (!d || !t) return null;
  const at = new Date(
    Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]) + minutes)
  );
  if (Number.isNaN(at.getTime())) return null;
  return {
    date: `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`,
    time: `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`,
  };
}

/**
 * The `YYYY-MM-DDTHH:mm` a `datetime-local` input takes, on the value's own
 * clock (`local` — the airport's or station's, ADR 0002); "" for none. Seeding
 * an edit form from the BROWSER's clock brought a flight back shifted by the
 * reader's offset, and saved it that way.
 */
export function datetimeLocalOf(value: { local: string } | null | undefined): string {
  return value ? value.local.slice(0, 16) : "";
}
